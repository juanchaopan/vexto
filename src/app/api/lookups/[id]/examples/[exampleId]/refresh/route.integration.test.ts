// POST /api/lookups/:id/examples/:exampleId/refresh against a real PostgreSQL, with MSW standing
// in for OpenAI: the shown example is replaced at its position with a new ID, the other example
// and the meaning stay, a new example the lookup already has is written again at most once more,
// and an example that was replaced meanwhile is a conflict.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../../../../../features/account/testing.ts';
import { examples, lookupEntries } from '../../../../../../../features/lookup/index.ts';
import {
  fixedExplanation,
  openAiDouble,
  sentData,
  stubOpenAiEnv,
} from '../../../../../../../features/lookup/testing.ts';
import { insertArticle } from '../../../../../../../features/reading/testing.ts';
import { usageRecords } from '../../../../../../../features/usage/index.ts';
import {
  expectApiError,
  expectNotFound,
  jsonRequest,
  readSuccess,
} from '../../../../../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../../../../../lib/db/client.ts';
import { POST as lookUp } from '../../../../route.ts';
import { POST } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../../../../features/account/testing.ts')).nextServerStandIn(),
);

const openai = openAiDouble();
const db = getDatabase();
const SENTENCE = 'Engineers want equipment that is resilient enough to keep working.';

beforeAll(() => {
  stubOpenAiEnv();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  openai.server.listen();
});

afterEach(() => {
  openai.reset();
});

afterAll(async () => {
  openai.server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeDatabase();
});

type Example = { id: string; position: number; text: string; targetRanges: [number, number][] };
type Lookup = { id: string; examples: Example[] };

let member: { id: string };
let lookup: Lookup;

beforeEach(async () => {
  member = await signInAsMember();
  const article = await insertArticle(db, { paragraphs: [[SENTENCE]] });
  const start = SENTENCE.indexOf('resilient');
  const response = await lookUp(
    jsonRequest('/api/lookups', {
      operationId: randomUUID(),
      context: { kind: 'article', articleId: article.id, firstSentence: 0, lastSentence: 0 },
      selection: { start, end: start + 'resilient'.length },
    }),
  );
  lookup = ((await readSuccess(response, 201)) as { data: Lookup }).data;
  openai.reset();
});

function refresh(exampleId: string, operationId = randomUUID(), lookupId = lookup.id) {
  return POST(
    jsonRequest(`/api/lookups/${lookupId}/examples/${exampleId}/refresh`, { operationId }),
    { params: Promise.resolve({ id: lookupId, exampleId }) },
  );
}

async function storedExamples() {
  return db
    .select()
    .from(examples)
    .where(eq(examples.lookupEntryId, lookup.id))
    .orderBy(examples.position);
}

describe('POST /api/lookups/:id/examples/:exampleId/refresh', () => {
  it('replaces the example at its position with a new ID and keeps the other one', async () => {
    const [first, second] = lookup.examples;

    const { data } = (await readSuccess(await refresh(second.id))) as { data: Example };

    expect(data).toEqual({
      id: expect.any(String),
      position: 1,
      text: expect.stringContaining('resilient'),
      targetRanges: [[expect.any(Number), expect.any(Number)]],
    });
    expect(data.id).not.toBe(second.id);
    expect((await storedExamples()).map((row) => [row.id, row.text])).toEqual([
      [first.id, first.text],
      [data.id, data.text],
    ]);
    const [entry] = await db.select().from(lookupEntries).where(eq(lookupEntries.id, lookup.id));
    expect(entry.meaningZh).toBe(fixedExplanation('resilient').meaningZh);
    expect(sentData(openai.requests[0])).toMatchObject({
      lemma: 'resilient',
      passage: SENTENCE,
      existingExamples: [first.text, second.text],
    });
  });

  it('records the call against the lookup', async () => {
    await refresh(lookup.examples[0].id);

    const records = await db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.ownerId, member.id), eq(usageRecords.kind, 'example')));
    expect(records).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        resourceType: 'lookup',
        resourceId: lookup.id,
        estimatedCost: expect.any(String),
      }),
    ]);
  });

  it('gives the first answer again for a repeated operationId', async () => {
    const operationId = randomUUID();
    const first = await readSuccess(await refresh(lookup.examples[0].id, operationId));

    expect(await readSuccess(await refresh(lookup.examples[0].id, operationId))).toEqual(first);
    expect(openai.requests).toHaveLength(1);
  });

  it('is a conflict when the example was already replaced', async () => {
    const old = lookup.examples[0];
    await readSuccess(await refresh(old.id));

    await expectApiError(await refresh(old.id), 'CONFLICT');
    expect(openai.requests).toHaveLength(1);
  });

  it('writes a new example once more when the first repeats one the lookup has', async () => {
    openai.answerNext({ output: { example: lookup.examples[1].text } });

    const { data } = (await readSuccess(await refresh(lookup.examples[0].id))) as {
      data: Example;
    };

    expect(openai.requests).toHaveLength(2);
    expect(data.text).not.toBe(lookup.examples[1].text);
  });

  it('fails and keeps the old example when the AI repeats an example twice', async () => {
    const repeat = { output: { example: lookup.examples[0].text } };
    openai.answerNext(repeat, repeat);

    await expectApiError(await refresh(lookup.examples[0].id), 'UNAVAILABLE');

    expect((await storedExamples()).map((row) => row.id)).toEqual(
      lookup.examples.map((example) => example.id),
    );
  });

  it('finds nothing for a lookup that does not exist or an ID that is not a UUID', async () => {
    await expectNotFound(await refresh(lookup.examples[0].id, randomUUID(), randomUUID()));
    await expectNotFound(await refresh('not-a-uuid'));
  });
});
