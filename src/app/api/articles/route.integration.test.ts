// GET /api/articles and GET /api/articles/ids through their routes, against the shared test
// database: the list's body and its meta, and the ID list of the same query in the same order.
// The sorts, filters and batches are tested in depth on a database of their own
// (src/features/reading/server/article-list.integration.test.ts); here each test finds its
// articles by a word only their bodies hold.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../features/account/testing.ts';
import { insertArticle, uniqueWord } from '../../../features/reading/testing.ts';
import { readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../lib/db/client.ts';
import { GET as ids } from './ids/route.ts';
import { GET as list } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

beforeAll(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

const url = (path: string) => new Request(`http://localhost:3000${path}`);

describe('GET /api/articles', () => {
  it('answers a batch with the cursor and the total count, and the IDs in the same order', async () => {
    await signInAsMember();
    const word = uniqueWord();
    const titles = ['Beta', 'alpha', 'Gamma'];
    const created = [];
    for (const title of titles) {
      created.push(await insertArticle(getDatabase(), { title, paragraphs: [[`A ${word}.`]] }));
    }

    const listed = (await readSuccess(
      await list(url(`/api/articles?q=${word}&sort=article&direction=asc`)),
    )) as { data: { title: string; excerpt: string }[]; meta: unknown };
    const ordered = (await readSuccess(
      await ids(url(`/api/articles/ids?q=${word}&sort=article&direction=asc`)),
    )) as { data: { ids: string[] } };

    expect(listed.data.map((item) => item.title)).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(listed.data[0].excerpt).toBe(`A ${word}.`);
    expect(listed.meta).toEqual({ nextCursor: null, totalCount: 3 });
    expect(ordered.data.ids).toEqual([created[1].id, created[0].id, created[2].id]);
  });
});
