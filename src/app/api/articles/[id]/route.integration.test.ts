// GET /api/articles/:id against a real PostgreSQL: a ready article with its sentences in order,
// their paragraphs and timings, and the length of its audio; 404 for an article that is not
// ready, whose audio is not ready, or that does not exist.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../../features/account/testing.ts';
import { insertArticle } from '../../../../features/reading/testing.ts';
import { expectNotFound, readSuccess } from '../../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../../lib/db/client.ts';
import { GET } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../features/account/testing.ts')).nextServerStandIn(),
);

beforeAll(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

function read(id: string) {
  return GET(new Request(`http://localhost:3000/api/articles/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/articles/:id', () => {
  it('answers the article with its sentences, timings and audio length', async () => {
    await signInAsMember();
    const collectedAt = new Date('2026-11-22T09:04:00Z');
    const article = await insertArticle(getDatabase(), {
      title: 'Lunar dust shields',
      feedKey: 'loc-inside-adams',
      categoryKey: 'history',
      author: 'Dana Whitfield',
      collectedAt,
      paragraphs: [['Moon dust is sticky.', 'It clings.'], ['Engineers want shields.']],
    });

    const { data } = (await readSuccess(await read(article.id))) as { data: unknown };

    expect(data).toEqual({
      id: article.id,
      title: 'Lunar dust shields',
      feedKey: 'loc-inside-adams',
      categoryKey: 'history',
      author: 'Dana Whitfield',
      sourceUrl: `https://news.example.org/${article.audioId}`,
      collectedAt: collectedAt.toISOString(),
      durationMs: article.durationMs,
      sentences: [
        { index: 0, paragraphIndex: 0, text: 'Moon dust is sticky.', ...article.timings[0] },
        { index: 1, paragraphIndex: 0, text: 'It clings.', ...article.timings[1] },
        { index: 2, paragraphIndex: 1, text: 'Engineers want shields.', ...article.timings[2] },
      ],
    });
  });

  it('answers 404 for an article that is not ready or has no ready audio', async () => {
    await signInAsMember();
    const preparing = await insertArticle(getDatabase(), { state: 'preparing' });
    const failed = await insertArticle(getDatabase(), { state: 'failed' });
    const retiring = await insertArticle(getDatabase(), { audioState: 'retiring' });

    for (const article of [preparing, failed, retiring]) {
      await expectNotFound(await read(article.id));
    }
  });

  it('answers 404 for an ID that names no article', async () => {
    await signInAsMember();

    await expectNotFound(await read('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'));
    await expectNotFound(await read('not-an-id'));
  });
});
