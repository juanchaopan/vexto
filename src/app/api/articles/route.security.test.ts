// Who may read articles, and hostile input to the article endpoints (.docs/design/rules.md,
// 成员和登录 and 权限和数据隔离): every endpoint refuses a request without a session, a Google
// account that is not a member and a member who has not accepted the terms. The search text is
// a bound parameter of plainto_tsquery, so SQL or tsquery syntax in it is only text; a cursor is
// opaque and refused unless it is one this query made; unknown parameters and keys are invalid.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  signInAsMember,
  signInToClerk,
  signOutOfClerk,
  uniqueEmail,
} from '../../../features/account/testing.ts';
import { insertArticle, uniqueWord } from '../../../features/reading/testing.ts';
import type { ErrorCode } from '../../../lib/api/errors.ts';
import { expectApiError, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../lib/db/client.ts';
import { GET as read } from './[id]/route.ts';
import { PUT as visit } from './[id]/visit/route.ts';
import { GET as ids } from './ids/route.ts';
import { GET as list } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

let articleId: string;

beforeAll(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  articleId = (await insertArticle(getDatabase())).id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

const url = (path: string) => new Request(`http://localhost:3000${path}`);
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const endpoints: [string, () => Promise<Response>][] = [
  ['the list', () => list(url('/api/articles'))],
  ['the ID list', () => ids(url('/api/articles/ids'))],
  ['one article', () => read(url(`/api/articles/${articleId}`), withId(articleId))],
  [
    'recording a visit',
    () =>
      visit(
        new Request(`http://localhost:3000/api/articles/${articleId}/visit`),
        withId(articleId),
      ),
  ],
];

describe.each(endpoints)('%s', (_, call) => {
  const refusals: [string, () => Promise<unknown>, ErrorCode][] = [
    ['without a session', async () => signOutOfClerk(), 'UNAUTHENTICATED'],
    [
      'for a Google account that is not a member',
      async () => signInToClerk([{ address: uniqueEmail('outsider') }]),
      'NOT_A_MEMBER',
    ],
    [
      'for a member who has not accepted the terms',
      () => signInAsMember({ termsVersion: null }),
      'TERMS_REQUIRED',
    ],
    ['for a revoked member', () => signInAsMember({ status: 'revoked' }), 'NOT_A_MEMBER'],
  ];

  it.each(refusals)('is refused %s', async (__, arrange, code) => {
    await arrange();

    await expectApiError(await call(), code);
  });
});

async function listWith(query: string) {
  return list(url(`/api/articles?${query}`));
}

describe('hostile search text', () => {
  const hostile = [
    "' or 1=1 --",
    "'); drop table articles; --",
    'moon & !dust | (sun:*)',
    '%_\\',
    '<script>alert(1)</script>',
  ];

  it.each(hostile)('is only text to search for: %j', async (text) => {
    await signInAsMember();

    const response = await listWith(`q=${encodeURIComponent(text)}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { meta: { totalCount: number } };
    expect(body.meta.totalCount).toBe(0);
  });

  it('finds a word next to tsquery operators as the word', async () => {
    await signInAsMember();
    const word = uniqueWord();
    await insertArticle(getDatabase(), { paragraphs: [[`The ${word} report.`]] });

    const { meta } = (await readSuccess(
      await listWith(`q=${encodeURIComponent(`${word} & !:* |`)}`),
    )) as { meta: { totalCount: number } };

    expect(meta.totalCount).toBe(1);
  });

  it('is refused above 200 characters or with a NUL character', async () => {
    await signInAsMember();

    await expectApiError(await listWith(`q=${'a'.repeat(201)}`), 'INVALID_INPUT');
    await expectApiError(await listWith('q=moon%00dust'), 'INVALID_INPUT');
  });
});

describe('parameters', () => {
  it.each([
    ['an unknown parameter', 'page=2'],
    ['an unknown feed key', 'feed=evil-feed'],
    ['an unknown category key', 'category=politics'],
    ['an unknown sort', 'sort=created_at'],
    ['SQL as the direction', 'direction=desc;drop table articles'],
    ['a search given twice', 'q=moon&q=dust'],
  ])('refuses %s', async (_, query) => {
    await signInAsMember();

    await expectApiError(await listWith(query), 'INVALID_INPUT');
    await expectApiError(await ids(url(`/api/articles/ids?${query}`)), 'INVALID_INPUT');
  });

  it('refuses a cursor on the ID list', async () => {
    await signInAsMember();

    await expectApiError(await ids(url('/api/articles/ids?cursor=abc')), 'INVALID_INPUT');
  });
});

function cursorOf(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

async function realCursor(query: string) {
  const word = uniqueWord();
  for (let index = 0; index < 21; index += 1) {
    await insertArticle(getDatabase(), { paragraphs: [[`A ${word} story.`]] });
  }
  const { meta } = (await readSuccess(await listWith(`q=${word}&${query}`))) as {
    meta: { nextCursor: string };
  };
  return { word, cursor: meta.nextCursor };
}

describe('cursor tampering', () => {
  it('refuses a cursor made for another query', async () => {
    await signInAsMember();
    const { word, cursor } = await realCursor('sort=collected');

    await expectApiError(
      await listWith(`q=${word}&sort=article&cursor=${cursor}`),
      'INVALID_INPUT',
    );
    await expectApiError(await listWith(`q=other&cursor=${cursor}`), 'INVALID_INPUT');
    await expectApiError(
      await listWith(`q=${word}&direction=asc&cursor=${cursor}`),
      'INVALID_INPUT',
    );
    await readSuccess(await listWith(`q=${word}&sort=collected&cursor=${cursor}`));
  });

  it('refuses a cursor whose values were changed', async () => {
    await signInAsMember();
    const { word, cursor } = await realCursor('sort=collected');
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      s: string;
      k: unknown[];
    };
    const forged = [
      { ...payload, k: ["2026-01-01'; drop table articles; --", payload.k[1]] },
      { ...payload, k: ['not a time', payload.k[1]] },
      { ...payload, k: [payload.k[0], "1' or '1'='1"] },
      { ...payload, k: [12, payload.k[1]] },
      { ...payload, k: [null, payload.k[1]] },
      { ...payload, k: [payload.k[0]] },
      { ...payload, k: [{ $gt: '' }, payload.k[1]] },
    ];

    for (const value of forged) {
      await expectApiError(
        await listWith(`q=${word}&sort=collected&cursor=${cursorOf(value)}`),
        'INVALID_INPUT',
      );
    }
  });

  it('refuses text that is not a cursor', async () => {
    await signInAsMember();

    for (const cursor of ['%00', 'not base64!', cursorOf('just text'), 'x'.repeat(3000)]) {
      await expectApiError(await listWith(`cursor=${encodeURIComponent(cursor)}`), 'INVALID_INPUT');
    }
  });
});
