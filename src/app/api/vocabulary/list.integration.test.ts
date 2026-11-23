// GET /api/vocabulary against a real PostgreSQL: the member's cards with their progress, the
// New, Ongoing and Archived tabs, the round filters, the search of lemmas, meanings, parts of
// speech and examples (with inflections, and with wildcards taken as text), the seven sorts in
// both directions, and batches of 20 with a cursor that only its own query takes.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMember, signInAsMember } from '../../../features/account/testing.ts';
import { openAiDouble, stubOpenAiEnv } from '../../../features/lookup/testing.ts';
import {
  insertLookup,
  setProgress,
  vocabularyAnswers,
  type LookupSeed,
} from '../../../features/vocabulary/testing.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../../lib/api/testing.ts';
import { closeDatabase } from '../../../lib/db/client.ts';
import { GET, POST } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

const openai = openAiDouble({ defaults: vocabularyAnswers });

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

type ListBody = {
  data: {
    id: string;
    lemma: string;
    pos: string;
    meaningZh: string;
    progress: Record<string, { round: number; dueAt: string | null }>;
  }[];
  meta: { nextCursor: string | null; totalCount: number };
};

let member: { id: string };

beforeEach(async () => {
  member = await signInAsMember();
});

async function addCard(lemma: string, seed: LookupSeed = {}): Promise<string> {
  const lookup = await insertLookup(member.id, { lemma, ...seed });
  const response = await POST(
    jsonRequest('/api/vocabulary', { operationId: randomUUID(), lookupId: lookup.lookupId }),
  );
  return ((await readSuccess(response, 201)) as { data: { id: string } }).data.id;
}

function list(params: Record<string, string | string[]> = {}) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of [value].flat()) {
      search.append(name, one);
    }
  }
  return GET(new Request(`http://localhost:3000/api/vocabulary?${search}`));
}

async function listed(params: Record<string, string | string[]> = {}): Promise<ListBody> {
  return (await readSuccess(await list(params))) as ListBody;
}

const lemmas = (body: ListBody) => body.data.map((card) => card.lemma);

const hours = (count: number) => new Date(Date.now() + count * 3_600_000);

describe('GET /api/vocabulary', () => {
  it('lists the member’s cards by word with their progress and the count', async () => {
    await addCard('sustain');
    await addCard('allocate');
    const other = await createMember();
    await insertLookup(other.id);

    const body = await listed();

    expect(lemmas(body)).toEqual(['allocate', 'sustain']);
    expect(body.meta).toEqual({ nextCursor: null, totalCount: 2 });
    expect(body.data[0]).toEqual({
      id: expect.any(String),
      lemma: 'allocate',
      pos: 'adjective',
      meaningZh: '有韧性的；经得起损耗的',
      progress: {
        speak: { round: 0, dueAt: null },
        spell: { round: 0, dueAt: null },
        translate: { round: 0, dueAt: null },
      },
    });
  });

  it('shows the cards of each tab', async () => {
    await addCard('fresh');
    const started = await addCard('started');
    const done = await addCard('done');
    await setProgress(member.id, started, 'spell', 2, hours(3));
    for (const mode of ['speak', 'spell', 'translate'] as const) {
      await setProgress(member.id, done, mode, 7, null);
    }

    expect(lemmas(await listed({ state: 'new' }))).toEqual(['fresh']);
    expect(lemmas(await listed({ state: 'ongoing' }))).toEqual(['started']);
    expect(lemmas(await listed({ state: 'archived' }))).toEqual(['done']);
    expect((await listed({ state: 'all' })).meta.totalCount).toBe(3);
  });

  it('filters by the round of the next answer, or within a mode and across modes', async () => {
    await addCard('alpha');
    const beta = await addCard('beta');
    const gamma = await addCard('gamma');
    await setProgress(member.id, beta, 'spell', 2, hours(1));
    await setProgress(member.id, gamma, 'spell', 7, null);
    await setProgress(member.id, gamma, 'translate', 3, hours(1));

    expect(lemmas(await listed({ 'rounds.spell': '1' }))).toEqual(['alpha']);
    expect(lemmas(await listed({ 'rounds.spell': ['3', 'complete'] }))).toEqual(['beta', 'gamma']);
    expect(lemmas(await listed({ 'rounds.spell': 'complete', 'rounds.translate': '4' }))).toEqual([
      'gamma',
    ]);
    expect(lemmas(await listed({ 'rounds.spell': 'complete', 'rounds.translate': '1' }))).toEqual(
      [],
    );
    const everyRound = ['1', '2', '3', '4', '5', '6', '7', 'complete'];
    expect((await listed({ 'rounds.speak': everyRound })).meta.totalCount).toBe(3);
  });

  it('searches lemmas, meanings, parts of speech and examples, inflections included', async () => {
    await addCard('perspective', { pos: 'noun', meaningZh: '观点；视角' });
    await addCard('underlying', {
      meaningZh: '潜在的；根本的',
      examples: [
        'The underlying problems were harder to see than anyone expected.',
        'Scientists studied the underlying causes of the long drought.',
      ],
    });

    expect(lemmas(await listed({ q: 'SPECT' }))).toEqual(['perspective']);
    expect(lemmas(await listed({ q: '视角' }))).toEqual(['perspective']);
    expect(lemmas(await listed({ q: 'noun' }))).toEqual(['perspective']);
    expect(lemmas(await listed({ q: 'harder to see' }))).toEqual(['underlying']);
    expect(lemmas(await listed({ q: 'drought' }))).toEqual(['underlying']);
    expect(lemmas(await listed({ q: 'expecting' }))).toEqual(['underlying']);
    expect(lemmas(await listed({ q: '  视角  ' }))).toEqual(['perspective']);
  });

  it('takes % and _ in a search as the characters themselves', async () => {
    await addCard('percent', {
      examples: [
        'Prices of percent bonds rose by 5% during the long hot summer.',
        'The percent sign follows the number in most written reports today.',
      ],
    });
    await addCard('plain');

    expect(lemmas(await listed({ q: '%' }))).toEqual(['percent']);
    expect(lemmas(await listed({ q: '_' }))).toEqual([]);
    expect(lemmas(await listed({ q: 'p_ain' }))).toEqual([]);
  });

  it('sorts by a mode’s round and next due time, new and completed words last', async () => {
    const soon = await addCard('soon');
    const later = await addCard('later');
    await addCard('fresh');
    const finished = await addCard('finished');
    await setProgress(member.id, soon, 'translate', 1, hours(1));
    await setProgress(member.id, later, 'translate', 4, hours(30));
    await setProgress(member.id, finished, 'translate', 7, null);

    expect(lemmas(await listed({ sort: 'translateNext' }))).toEqual([
      'soon',
      'later',
      'finished',
      'fresh',
    ]);
    expect(lemmas(await listed({ sort: 'translateNext', direction: 'desc' }))).toEqual([
      'later',
      'soon',
      'fresh',
      'finished',
    ]);
    expect(lemmas(await listed({ sort: 'translateRound' }))).toEqual([
      'fresh',
      'soon',
      'later',
      'finished',
    ]);
    expect(lemmas(await listed({ sort: 'word', direction: 'desc' }))).toEqual([
      'soon',
      'later',
      'fresh',
      'finished',
    ]);
  });

  it('sends batches of 20 that continue after the cursor', async () => {
    const all: string[] = [];
    for (let index = 0; index < 23; index += 1) {
      const lemma = `word${String(index).padStart(2, '0')}`;
      all.push(lemma);
      await addCard(lemma);
    }

    const first = await listed();
    expect(first.data).toHaveLength(20);
    expect(first.meta.totalCount).toBe(23);
    const second = await listed({ cursor: first.meta.nextCursor ?? '' });

    expect([...lemmas(first), ...lemmas(second)]).toEqual(all);
    expect(second.meta.nextCursor).toBeNull();
  });

  it('continues a Next sort through cards with and without due times', async () => {
    for (let index = 0; index < 22; index += 1) {
      const id = await addCard(`next${String(index).padStart(2, '0')}`);
      if (index % 2 === 0) {
        await setProgress(member.id, id, 'spell', 1, hours(index + 1));
      }
    }

    for (const direction of ['asc', 'desc']) {
      const first = await listed({ sort: 'spellNext', direction });
      const second = await listed({
        sort: 'spellNext',
        direction,
        cursor: first.meta.nextCursor ?? '',
      });
      const both = [...lemmas(first), ...lemmas(second)];
      expect(new Set(both).size).toBe(22);
      expect(second.meta.nextCursor).toBeNull();
    }
  });

  it('refuses a cursor made for another query', async () => {
    for (let index = 0; index < 21; index += 1) {
      await addCard(`c${index}`);
    }
    const first = await listed();

    await expectApiError(
      await list({ sort: 'spellRound', cursor: first.meta.nextCursor ?? '' }),
      'INVALID_INPUT',
    );
    await expectApiError(
      await list({ q: 'c1', cursor: first.meta.nextCursor ?? '' }),
      'INVALID_INPUT',
    );
  });

  it('refuses unknown parameters and values, a repeated single value and a long search', async () => {
    await expectApiError(await list({ tab: 'new' }), 'INVALID_INPUT');
    await expectApiError(await list({ state: 'old' }), 'INVALID_INPUT');
    await expectApiError(await list({ 'rounds.spell': '8' }), 'INVALID_INPUT');
    await expectApiError(await list({ sort: ['word', 'spellRound'] }), 'INVALID_INPUT');
    await expectApiError(await list({ q: 'x'.repeat(101) }), 'INVALID_INPUT');
    await expectApiError(await list({ direction: 'up' }), 'INVALID_INPUT');
  });
});
