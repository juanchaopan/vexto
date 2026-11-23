// The article list and the ID list against a real PostgreSQL of this file's own, so the test
// knows every article in it (.docs/design/rules.md, 文章列表、搜索和播放): the five sorts in both
// directions with ties broken by ID, unvisited articles last, the filters and the full-text
// search, keyset batches of 20 with the total count, and the IDs in the list's order.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_SIZE } from '../../../lib/api/cursor.ts';
import type { Database } from '../../../lib/db/client.ts';
import { isolatedDatabase, type IsolatedDatabase } from '../../collection/testing.ts';
import { insertArticle, insertMember, insertVisit, type ArticleSeed } from '../testing.ts';
import { articleIdsResult, articleListResult } from './articles-api.ts';

let isolated: IsolatedDatabase;
let db: Database;
let member: string;

beforeAll(async () => {
  isolated = await isolatedDatabase();
  db = isolated.database;
});

afterAll(async () => {
  await isolated.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate visits, article_sentences, articles, audio_assets cascade`);
  member = await insertMember(db);
});

type Item = {
  id: string;
  title: string;
  excerpt: string;
  feedKey: string;
  categoryKey: string;
  collectedAt: string;
  lastVisitedAt: string | null;
};
type Batch = { data: Item[]; meta: { nextCursor: string | null; totalCount: number } };

async function batch(params: Record<string, string | string[]>, ownerId = member) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of [value].flat()) {
      search.append(name, one);
    }
  }
  const result = await articleListResult(ownerId, search, db);
  expect(result.status).toBe(200);
  return result.body as Batch;
}

/** Every batch of a query, following the cursors. */
async function everything(params: Record<string, string | string[]>, ownerId = member) {
  const batches: Batch[] = [];
  let cursor: string | null = null;
  do {
    const next: Batch = await batch(cursor ? { ...params, cursor } : params, ownerId);
    batches.push(next);
    cursor = next.meta.nextCursor;
  } while (cursor);
  return batches;
}

async function idsOf(params: Record<string, string | string[]>, ownerId = member) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of [value].flat()) {
      search.append(name, one);
    }
  }
  const result = await articleIdsResult(ownerId, search, db);
  return (result.body as { data: { ids: string[] } }).data.ids;
}

const minute = 60_000;
const base = Date.parse('2026-11-22T09:00:00Z');
const at = (minutes: number) => new Date(base + minutes * minute);

async function seed(count: number, change: (index: number) => ArticleSeed = () => ({})) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push((await insertArticle(db, { collectedAt: at(index), ...change(index) })).id);
  }
  return ids;
}

const titles = (items: readonly Item[]) => items.map((item) => item.title);

describe('the list', () => {
  it('shows ready articles newest first with their first sentence and the member’s visit', async () => {
    const [older, newer] = await seed(2, (index) => ({
      title: `Article ${index}`,
      paragraphs: [[`First sentence ${index}.`, 'Second sentence.'], ['Next paragraph.']],
    }));
    await insertArticle(db, { state: 'preparing' });
    await insertArticle(db, { state: 'failed' });
    await insertVisit(db, member, older, at(30));

    const { data, meta } = await batch({});

    expect(data).toEqual([
      {
        id: newer,
        title: 'Article 1',
        excerpt: 'First sentence 1.',
        feedKey: 'nasa-technology',
        categoryKey: 'technology',
        collectedAt: at(1).toISOString(),
        lastVisitedAt: null,
      },
      expect.objectContaining({ id: older, lastVisitedAt: at(30).toISOString() }),
    ]);
    expect(meta).toEqual({ nextCursor: null, totalCount: 2 });
  });

  it('sends batches of 20 that follow each other, each with the total count', async () => {
    const ids = await seed(45);

    const batches = await everything({});

    expect(batches.map((one) => one.data.length)).toEqual([PAGE_SIZE, PAGE_SIZE, 5]);
    expect(batches.every((one) => one.meta.totalCount === 45)).toBe(true);
    expect(batches.flatMap((one) => one.data.map((item) => item.id))).toEqual(ids.reverse());
  });

  it('does not slip an article collected later into the batches already being read', async () => {
    await seed(25);
    const first = await batch({});
    await insertArticle(db, { title: 'Newcomer', collectedAt: at(100) });

    const second = await batch({ cursor: first.meta.nextCursor ?? '' });

    expect(titles(second.data)).not.toContain('Newcomer');
    expect(second.data).toHaveLength(5);
    expect(second.meta.totalCount).toBe(26);
  });

  it('keeps times apart that differ by a microsecond at a batch boundary', async () => {
    const ids = await seed(PAGE_SIZE + 1);
    // The last two articles of the order are a microsecond apart within one millisecond.
    await db.execute(sql`
      update articles set collected_at = '2026-11-21T08:00:00.123402Z' where id = ${ids[1]}`);
    await db.execute(sql`
      update articles set collected_at = '2026-11-21T08:00:00.123401Z' where id = ${ids[0]}`);

    const batches = await everything({});

    expect(batches.flatMap((one) => one.data.map((item) => item.id)).slice(-2)).toEqual([
      ids[1],
      ids[0],
    ]);
  });
});

describe('sorting', () => {
  it.each(['asc', 'desc'] as const)(
    'sorts by title without regard to case, %s',
    async (direction) => {
      await seed(3, (index) => ({ title: ['banana', 'Apple', 'cherry'][index] }));

      const { data } = await batch({ sort: 'article', direction });

      const expected = ['Apple', 'banana', 'cherry'];
      expect(titles(data)).toEqual(direction === 'asc' ? expected : expected.reverse());
    },
  );

  it('sorts by the display name of the source, not its key, and breaks ties by ID', async () => {
    const feeds = ['nist-news', 'loc-inside-adams', 'nasa-technology', 'nasa-technology'];
    const ids = await seed(4, (index) => ({ feedKey: feeds[index], title: feeds[index] }));

    const ascending = await batch({ sort: 'source', direction: 'asc' });
    const descending = await batch({ sort: 'source', direction: 'desc' });

    // Inside Adams, NASA Technology, NIST News; the two NASA articles by ID in the same direction.
    const nasa = [ids[2], ids[3]].sort();
    expect(ascending.data.map((item) => item.id)).toEqual([ids[1], ...nasa, ids[0]]);
    expect(descending.data.map((item) => item.id)).toEqual([ids[0], ...nasa.reverse(), ids[1]]);
  });

  it('sorts by the display name of the category', async () => {
    const categories = ['technology', 'health', 'science', 'history'];
    await seed(4, (index) => ({ categoryKey: categories[index], title: categories[index] }));

    const { data } = await batch({ sort: 'category', direction: 'asc' });

    expect(titles(data)).toEqual(['health', 'history', 'science', 'technology']);
  });

  it('sorts by collection time oldest first', async () => {
    const ids = await seed(3);

    const { data } = await batch({ direction: 'asc' });

    expect(data.map((item) => item.id)).toEqual(ids);
  });

  it.each(['asc', 'desc'] as const)(
    'puts articles the member never visited last when sorting by visit, %s',
    async (direction) => {
      const ids = await seed(4, (index) => ({ title: `A${index}` }));
      await insertVisit(db, member, ids[0], at(50));
      await insertVisit(db, member, ids[2], at(40));
      const other = await insertMember(db);
      await insertVisit(db, other, ids[3], at(60));

      const { data } = await batch({ sort: 'visited', direction });

      const visited = direction === 'asc' ? ['A2', 'A0'] : ['A0', 'A2'];
      const never = [ids[1], ids[3]].sort();
      const neverTitles = never.map((id) => `A${ids.indexOf(id)}`);
      expect(titles(data)).toEqual([
        ...visited,
        ...(direction === 'asc' ? neverTitles : neverTitles.reverse()),
      ]);
    },
  );

  it('crosses from visited to never visited articles between batches', async () => {
    const ids = await seed(30);
    for (const [index, id] of ids.slice(0, 15).entries()) {
      await insertVisit(db, member, id, at(100 + index));
    }

    const batches = await everything({ sort: 'visited', direction: 'desc' });
    const order = batches.flatMap((one) => one.data.map((item) => item.id));

    expect(order).toHaveLength(30);
    expect(new Set(order).size).toBe(30);
    expect(order.slice(0, 15)).toEqual(ids.slice(0, 15).reverse());
    expect(order.slice(15)).toEqual([...ids.slice(15)].sort().reverse());
    expect(await idsOf({ sort: 'visited', direction: 'desc' })).toEqual(order);
  });

  it('follows each sort across batches the same way the ID list orders it', async () => {
    const feeds = ['nist-news', 'nasa-aeronautics', 'loc-inside-adams'];
    await seed(25, (index) => ({
      title: `Title ${String(index % 7)}`,
      feedKey: feeds[index % 3],
      categoryKey: ['technology', 'science', 'history'][index % 3],
    }));

    for (const sort of ['collected', 'article', 'source', 'category']) {
      for (const direction of ['asc', 'desc']) {
        const order = (await everything({ sort, direction })).flatMap((one) =>
          one.data.map((item) => item.id),
        );
        expect(new Set(order).size, `${sort} ${direction}`).toBe(25);
        expect(await idsOf({ sort, direction }), `${sort} ${direction}`).toEqual(order);
      }
    }
  });
});

describe('filters', () => {
  async function seedSources() {
    await insertArticle(db, { title: 'NT', feedKey: 'nasa-technology', categoryKey: 'technology' });
    await insertArticle(db, { title: 'NS', feedKey: 'nist-news', categoryKey: 'technology' });
    await insertArticle(db, {
      title: 'NH',
      feedKey: 'nih-research-matters',
      categoryKey: 'health',
    });
    await insertArticle(db, { title: 'IA', feedKey: 'loc-inside-adams', categoryKey: 'history' });
  }

  it('matches any of the chosen sources', async () => {
    await seedSources();

    const { data, meta } = await batch({
      feed: ['nasa-technology', 'nist-news'],
      sort: 'article',
      direction: 'asc',
    });

    expect(titles(data)).toEqual(['NS', 'NT']);
    expect(meta.totalCount).toBe(2);
  });

  it('matches any of the chosen categories, and both filters together', async () => {
    await seedSources();

    const categories = await batch({ category: ['health', 'history'], sort: 'article' });
    const both = await batch({
      feed: ['nasa-technology', 'nih-research-matters'],
      category: 'health',
    });

    expect(titles(categories.data).sort()).toEqual(['IA', 'NH']);
    expect(titles(both.data)).toEqual(['NH']);
  });

  it('treats choosing every source as no filter', async () => {
    await seedSources();
    await insertArticle(db, { feedKey: 'retired-feed' });

    const { meta } = await batch({
      feed: [
        'nasa-technology',
        'nasa-aeronautics',
        'nih-research-matters',
        'nist-news',
        'loc-inside-adams',
      ],
    });

    expect(meta.totalCount).toBe(5);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await insertArticle(db, {
      title: 'Satellite title',
      paragraphs: [['Small satellites test a folding antenna in orbit.']],
    });
    await insertArticle(db, {
      title: 'Clock',
      feedKey: 'nist-news',
      paragraphs: [['A clock built around one charged atom kept time.']],
    });
    await insertArticle(db, {
      title: 'Orbit',
      paragraphs: [['The craft stayed in orbit for weeks.']],
    });
  });

  it('finds other forms of a word in the body, and needs every word', async () => {
    expect(titles((await batch({ q: 'satellite' })).data)).toEqual(['Satellite title']);
    expect(titles((await batch({ q: 'clocks' })).data)).toEqual(['Clock']);
    expect(titles((await batch({ q: 'orbit', sort: 'article', direction: 'asc' })).data)).toEqual([
      'Orbit',
      'Satellite title',
    ]);
    expect(titles((await batch({ q: 'orbit antennas' })).data)).toEqual(['Satellite title']);
  });

  it('searches only the body, not the title', async () => {
    expect((await batch({ q: 'title' })).meta.totalCount).toBe(0);
  });

  it('matches nothing for stop words only and everything for blank text', async () => {
    expect((await batch({ q: 'the and of' })).meta.totalCount).toBe(0);
    expect((await batch({ q: '   ' })).meta.totalCount).toBe(3);
  });

  it('combines with the filters and keeps the chosen sort', async () => {
    const filtered = await batch({ q: 'orbit', feed: 'nist-news' });
    const sorted = await batch({ q: 'orbit', sort: 'article', direction: 'desc' });

    expect(filtered.meta.totalCount).toBe(0);
    expect(titles(sorted.data)).toEqual(['Satellite title', 'Orbit']);
    expect(await idsOf({ q: 'orbit', sort: 'article', direction: 'desc' })).toEqual(
      sorted.data.map((item) => item.id),
    );
  });
});

describe('visit times', () => {
  it('are each member’s own', async () => {
    const [article] = await seed(1);
    const other = await insertMember(db);
    await insertVisit(db, other, article, at(5));

    expect((await batch({})).data[0].lastVisitedAt).toBeNull();
    expect((await batch({}, other)).data[0].lastVisitedAt).toBe(at(5).toISOString());
  });
});
