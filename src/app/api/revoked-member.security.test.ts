// Writes of a member revoked after the member check (.docs/design/rules.md, 取消资格): a request
// can pass the check just before `task member -- revoke` and reach its writes only after the
// revoke removed the member's data. Each case runs the real revoke at the last moment the request
// waits for after its check: while its AI call is under way, or while the handler reads its body
// or its path. The request is answered NOT_A_MEMBER, as the check answers a revoked member, and
// writes nothing, no operation receipt either, so nothing of the member is left behind.
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { http } from 'msw';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberDatabase } from '../../../scripts/lib/member-database.ts';
import { revokeMember } from '../../../scripts/lib/members.ts';
import { memberRow, signInAsMember } from '../../features/account/testing.ts';
import { examples } from '../../features/lookup/index.ts';
import {
  openAiDouble,
  stubOpenAiEnv,
  TEST_OPENAI_BASE_URL,
} from '../../features/lookup/testing.ts';
import { insertArticle } from '../../features/reading/testing.ts';
import { insertReviewCard } from '../../features/review/testing.ts';
import { insertLookup, vocabularyAnswers } from '../../features/vocabulary/testing.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../lib/db/client.ts';
import { PUT as visit } from './articles/[id]/visit/route.ts';
import { POST as refreshLookupExample } from './lookups/[id]/examples/[exampleId]/refresh/route.ts';
import { POST as lookUp } from './lookups/route.ts';
import { POST as submit } from './review/submit/route.ts';
import { spelling } from './review/testing.ts';
import { POST as refreshCardExample } from './vocabulary/[id]/examples/[exampleId]/refresh/route.ts';
import { POST as replace } from './vocabulary/[id]/replace/route.ts';
import { DELETE as deleteCard } from './vocabulary/[id]/route.ts';
import { POST as bulkDelete } from './vocabulary/bulk-delete/route.ts';
import { POST as save } from './vocabulary/route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../features/account/testing.ts')).nextServerStandIn(),
);

const openai = openAiDouble({ defaults: vocabularyAnswers });
const db = getDatabase();
const SENTENCE = 'Engineers want equipment that is resilient enough to keep working.';

let memberSql: postgres.Sql;
let member: { id: string; email: string };

beforeAll(() => {
  stubOpenAiEnv();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  openai.server.listen();
  memberSql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
});

beforeEach(async () => {
  member = await signInAsMember();
});

afterEach(() => {
  openai.server.resetHandlers();
  openai.reset();
});

afterAll(async () => {
  openai.server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await memberSql.end();
  await closeDatabase();
});

/** `task member -- revoke` for the signed-in member. */
async function revoke(): Promise<void> {
  expect(await revokeMember(memberDatabase(memberSql), member.email)).toBe('revoked');
}

/** Revokes the member when the AI is first called, before the call is answered. */
function revokeDuringTheAiCall(): void {
  let revoked = false;
  openai.server.use(
    http.post(`${TEST_OPENAI_BASE_URL}/responses`, async () => {
      if (!revoked) {
        revoked = true;
        await revoke();
      }
      // Answering nothing passes the call on to the double's own handler.
      return undefined;
    }),
  );
}

/**
 * A JSON request whose body is sent only when the handler reads it, which it does after the
 * member check; the member is revoked just before.
 */
function revokingRequest(path: string, body: unknown, method = 'POST'): Request {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await revoke();
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const init: RequestInit & { duplex: 'half' } = {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  };
  return new Request(`http://localhost:3000${path}`, init);
}

/** Path parameters the handler awaits after the member check; the member is revoked just before. */
function revokingParams<T>(value: T): { params: Promise<T> } {
  const params: PromiseLike<T> = {
    then(fulfilled, rejected) {
      return revoke()
        .then(() => value)
        .then(fulfilled, rejected);
    },
  };
  return { params: params as Promise<T> };
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

/** How many rows of the member's own data each table holds. */
async function memberData(memberId: string) {
  const [counts] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from lookup_entries where owner_id = ${memberId}) as lookups,
      (select count(*)::int from vocabulary_cards where owner_id = ${memberId}) as cards,
      (select count(*)::int from review_progress where owner_id = ${memberId}) as progress,
      (select count(*)::int from visits where owner_id = ${memberId}) as visits,
      (select count(*)::int from operation_receipts where owner_id = ${memberId}) as receipts`);
  return counts;
}

async function expectRefusedWithNothingLeft(response: Response): Promise<void> {
  await expectApiError(response, 'NOT_A_MEMBER');
  expect((await memberRow(member.id)).status).toBe('revoked');
  expect(await memberData(member.id)).toEqual({
    lookups: 0,
    cards: 0,
    progress: 0,
    visits: 0,
    receipts: 0,
  });
}

async function firstExampleId(lookupId: string): Promise<string> {
  const [first] = await db
    .select({ id: examples.id })
    .from(examples)
    .where(eq(examples.lookupEntryId, lookupId))
    .orderBy(asc(examples.position));
  return first.id;
}

describe('a member revoked during the AI call', () => {
  it('keeps no lookup', async () => {
    const article = await insertArticle(db, { paragraphs: [[SENTENCE]] });
    const start = SENTENCE.indexOf('resilient');
    revokeDuringTheAiCall();

    const response = await lookUp(
      jsonRequest('/api/lookups', {
        operationId: randomUUID(),
        context: { kind: 'article', articleId: article.id, firstSentence: 0, lastSentence: 0 },
        selection: { start, end: start + 'resilient'.length },
      }),
    );

    expect(openai.requests).toHaveLength(1);
    await expectRefusedWithNothingLeft(response);
  });

  it('keeps no new example of a lookup', async () => {
    const lookup = await insertLookup(member.id);
    const exampleId = await firstExampleId(lookup.lookupId);
    revokeDuringTheAiCall();

    const response = await refreshLookupExample(
      jsonRequest(`/api/lookups/${lookup.lookupId}/examples/${exampleId}/refresh`, {
        operationId: randomUUID(),
      }),
      params({ id: lookup.lookupId, exampleId }),
    );

    expect(openai.requests).toHaveLength(1);
    await expectRefusedWithNothingLeft(response);
  });

  it('saves no card', async () => {
    const lookup = await insertLookup(member.id);
    revokeDuringTheAiCall();

    const response = await save(
      jsonRequest('/api/vocabulary', { operationId: randomUUID(), lookupId: lookup.lookupId }),
    );

    expect(openai.requests).toHaveLength(1);
    await expectRefusedWithNothingLeft(response);
  });

  it('replaces no card', async () => {
    const lookup = await insertLookup(member.id);
    const saved = await save(
      jsonRequest('/api/vocabulary', { operationId: randomUUID(), lookupId: lookup.lookupId }),
    );
    const card = ((await readSuccess(saved, 201)) as { data: { id: string; updatedAt: string } })
      .data;
    const other = await insertLookup(member.id, { lemma: lookup.lemma });
    openai.reset();
    revokeDuringTheAiCall();

    const response = await replace(
      jsonRequest(`/api/vocabulary/${card.id}/replace`, {
        operationId: randomUUID(),
        lookupId: other.lookupId,
        updatedAt: card.updatedAt,
      }),
      params({ id: card.id }),
    );

    expect(openai.requests).toHaveLength(1);
    await expectRefusedWithNothingLeft(response);
  });

  it('keeps no new example of a card', async () => {
    const card = await insertReviewCard(member.id);
    const exampleId = card.examples[0].id;
    revokeDuringTheAiCall();

    const response = await refreshCardExample(
      jsonRequest(`/api/vocabulary/${card.id}/examples/${exampleId}/refresh`, {
        operationId: randomUUID(),
      }),
      params({ id: card.id, exampleId }),
    );

    expect(openai.requests).toHaveLength(1);
    await expectRefusedWithNothingLeft(response);
  });
});

describe('a member revoked while the handler reads the request', () => {
  it('deletes no card and stores no receipt', async () => {
    const card = await insertReviewCard(member.id);

    const response = await deleteCard(
      revokingRequest(`/api/vocabulary/${card.id}`, { operationId: randomUUID() }, 'DELETE'),
      params({ id: card.id }),
    );

    await expectRefusedWithNothingLeft(response);
  });

  it('deletes no batch and stores no receipt', async () => {
    const cards = [await insertReviewCard(member.id), await insertReviewCard(member.id)];

    const response = await bulkDelete(
      revokingRequest('/api/vocabulary/bulk-delete', {
        operationId: randomUUID(),
        ids: cards.map((card) => card.id),
      }),
    );

    await expectRefusedWithNothingLeft(response);
  });

  it('records no review answer', async () => {
    const card = await insertReviewCard(member.id);

    const response = await submit(
      revokingRequest('/api/review/submit', spelling(card.id, card.lemma)),
    );

    await expectRefusedWithNothingLeft(response);
  });

  it('records no visit', async () => {
    const article = await insertArticle(db);

    const response = await visit(
      new Request(`http://localhost:3000/api/articles/${article.id}/visit`, { method: 'PUT' }),
      revokingParams({ id: article.id }),
    );

    await expectRefusedWithNothingLeft(response);
  });
});
