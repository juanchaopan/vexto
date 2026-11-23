// PUT /api/articles/:id/visit against a real PostgreSQL (.docs/design/rules.md, 文章列表、搜索和
// 播放): one row per member and article with the database's time, which only moves forward; the
// list shows each member their own time; nothing is written for an article that is not ready.
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAsClerkUser, signInAsMember } from '../../../../../features/account/testing.ts';
import { visits } from '../../../../../features/articles/index.ts';
import { insertArticle, uniqueWord } from '../../../../../features/reading/testing.ts';
import { expectNotFound, readSuccess } from '../../../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../../../lib/db/client.ts';
import { GET as list } from '../../route.ts';
import { PUT } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../../features/account/testing.ts')).nextServerStandIn(),
);

beforeAll(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

function visit(id: string) {
  return PUT(new Request(`http://localhost:3000/api/articles/${id}/visit`, { method: 'PUT' }), {
    params: Promise.resolve({ id }),
  });
}

async function visitTime(id: string) {
  return ((await readSuccess(await visit(id))) as { data: { lastVisitedAt: string } }).data
    .lastVisitedAt;
}

async function visitRows(ownerId: string, articleId: string) {
  return getDatabase()
    .select()
    .from(visits)
    .where(and(eq(visits.ownerId, ownerId), eq(visits.articleId, articleId)));
}

/** An article whose body holds a word of its own, so a search finds it among other files' rows. */
async function findableArticle() {
  const word = uniqueWord();
  const article = await insertArticle(getDatabase(), { paragraphs: [[`The ${word} report.`]] });
  return { ...article, word };
}

async function listedVisit(article: { id: string; word: string }) {
  const response = await list(new Request(`http://localhost:3000/api/articles?q=${article.word}`));
  const { data } = (await readSuccess(response)) as {
    data: { id: string; lastVisitedAt: string | null }[];
  };
  expect(data.map((item) => item.id)).toEqual([article.id]);
  return data[0].lastVisitedAt;
}

describe('PUT /api/articles/:id/visit', () => {
  it('records the visit with the database time and moves it forward on the next one', async () => {
    const member = await signInAsMember();
    const article = await findableArticle();
    const before = Date.now();

    const first = await visitTime(article.id);
    const second = await visitTime(article.id);

    expect(Date.parse(first)).toBeGreaterThanOrEqual(before - 5_000);
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
    const rows = await visitRows(member.id, article.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastOpenedAt.toISOString()).toBe(second);
    expect(await listedVisit(article)).toBe(second);
  });

  it('never moves a visit back', async () => {
    const member = await signInAsMember();
    const article = await findableArticle();
    await visitTime(article.id);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await getDatabase().execute(
      sql`update visits set last_opened_at = ${future}::timestamptz where owner_id = ${member.id}`,
    );

    expect(await visitTime(article.id)).toBe(future);
  });

  it('keeps each member’s visit to themselves', async () => {
    const first = await signInAsMember();
    const article = await findableArticle();
    const firstTime = await visitTime(article.id);
    await signInAsMember();

    expect(await listedVisit(article)).toBeNull();

    actAsClerkUser(first.clerkUserId);
    expect(await listedVisit(article)).toBe(firstTime);
  });

  it('answers 404 and writes nothing for an article that is not ready or does not exist', async () => {
    const member = await signInAsMember();
    const preparing = await insertArticle(getDatabase(), { state: 'preparing' });

    await expectNotFound(await visit(preparing.id));
    await expectNotFound(await visit('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'));
    await expectNotFound(await visit('../articles'));

    expect(await visitRows(member.id, preparing.id)).toEqual([]);
  });
});
