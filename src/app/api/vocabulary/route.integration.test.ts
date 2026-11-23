// POST /api/vocabulary against a real PostgreSQL, with MSW standing in for OpenAI: a lookup
// becomes a card with a copy of its examples, four Translate options and three new progress
// rows; the same lookup, or one with the same meaning, is DUPLICATE_WORD with the saved card; a
// different meaning or part of speech is a card of its own; the AI calls are recorded and priced;
// a repeated operationId gets the first answer; saves at the same time make one card.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../features/account/testing.ts';
import { openAiDouble, sentData, stubOpenAiEnv } from '../../../features/lookup/testing.ts';
import { usageRecords } from '../../../features/usage/index.ts';
import { vocabularyCards } from '../../../features/vocabulary/index.ts';
import {
  cardRows,
  insertLookup,
  TEST_DISTRACTORS,
  vocabularyAnswers,
} from '../../../features/vocabulary/testing.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../../lib/api/testing.ts';
import { priceConfig } from '../../../lib/config/price-config.ts';
import { closeDatabase, getDatabase } from '../../../lib/db/client.ts';
import { POST } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../features/account/testing.ts')).nextServerStandIn(),
);

const openai = openAiDouble({ defaults: vocabularyAnswers });
const db = getDatabase();

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

type CardBody = {
  data: {
    id: string;
    lemma: string;
    pos: string;
    meaningZh: string;
    updatedAt: string;
    progress: Record<string, { round: number; dueAt: string | null }>;
    examples: { id: string; position: number; text: string; targetRanges: [number, number][] }[];
  };
};

type ErrorBody = { error: { code: string; details?: { savedCard: Record<string, unknown> } } };

let member: { id: string };

beforeEach(async () => {
  member = await signInAsMember();
});

function save(lookupId: string, operationId: string = randomUUID()) {
  return POST(jsonRequest('/api/vocabulary', { operationId, lookupId }));
}

async function saved(lookupId: string): Promise<CardBody['data']> {
  return ((await readSuccess(await save(lookupId), 201)) as CardBody).data;
}

const formats = () => openai.requests.map((request) => request.text.format.name);

function usageOf(kind: 'meaning_match' | 'translation') {
  return db
    .select()
    .from(usageRecords)
    .where(and(eq(usageRecords.ownerId, member.id), eq(usageRecords.kind, kind)));
}

async function cardCount(): Promise<number> {
  const cards = await db
    .select({ id: vocabularyCards.id })
    .from(vocabularyCards)
    .where(eq(vocabularyCards.ownerId, member.id));
  return cards.length;
}

/** A lookup of the same word and meaning as another, made in other sentences. */
function sameMeaningLookup(lemma: string) {
  return insertLookup(member.id, {
    lemma,
    examples: [
      `Her ${lemma} spirit helped the whole team through a very hard year.`,
      `A ${lemma} economy recovers quickly after a sudden shock to prices.`,
    ],
  });
}

describe('saving a lookup', () => {
  it('makes a card with copies of the examples, four options and new progress', async () => {
    const lookup = await insertLookup(member.id);

    const card = await saved(lookup.lookupId);

    expect(card).toEqual({
      id: expect.any(String),
      lemma: lookup.lemma,
      pos: 'adjective',
      meaningZh: lookup.meaningZh,
      updatedAt: expect.any(String),
      progress: {
        speak: { round: 0, dueAt: null },
        spell: { round: 0, dueAt: null },
        translate: { round: 0, dueAt: null },
      },
      examples: lookup.examples.map((text, position) => ({
        id: expect.any(String),
        position,
        text,
        targetRanges: [expect.any(Array)],
      })),
    });
    const rows = await cardRows(card.id);
    expect(rows.card).toMatchObject({ ownerId: member.id, sourceLookupEntryId: lookup.lookupId });
    expect(rows.progress.map((row) => [row.mode, row.round, row.dueAt])).toEqual([
      ['speak', 0, null],
      ['spell', 0, null],
      ['translate', 0, null],
    ]);
    const options = rows.options.options;
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.id)).size).toBe(4);
    expect(options.every((option) => option.pos === 'adjective')).toBe(true);
    expect(options.map((option) => option.meaningZh).sort()).toEqual(
      [lookup.meaningZh, ...TEST_DISTRACTORS].sort(),
    );
    expect(options.find((option) => option.id === rows.options.correctOptionId)?.meaningZh).toBe(
      lookup.meaningZh,
    );
    expect(formats()).toEqual(['translation_options']);
  });

  it('records the Translate options call with its cost and the lookup it was for', async () => {
    const lookup = await insertLookup(member.id);

    await saved(lookup.lookupId);

    expect(await usageOf('translation')).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        resourceType: 'lookup',
        resourceId: lookup.lookupId,
        estimatedCost: '0.000129',
        priceVersion: priceConfig.version,
      }),
    ]);
    expect(sentData(openai.requests[0])).toEqual({
      lemma: lookup.lemma,
      pos: 'adjective',
      meaningZh: lookup.meaningZh,
      examples: lookup.examples,
    });
  });

  it('answers a repeated operation with its first answer and calls nothing again', async () => {
    const lookup = await insertLookup(member.id);
    const operationId = randomUUID();

    const first = await readSuccess(await save(lookup.lookupId, operationId), 201);
    const again = await readSuccess(await save(lookup.lookupId, operationId), 201);

    expect(again).toEqual(first);
    expect(openai.requests).toHaveLength(1);
  });

  it('refuses an operationId used for another lookup', async () => {
    const operationId = randomUUID();
    await readSuccess(await save((await insertLookup(member.id)).lookupId, operationId), 201);

    await expectApiError(
      await save((await insertLookup(member.id)).lookupId, operationId),
      'OPERATION_MISMATCH',
    );
  });

  it('answers a lookup already saved with DUPLICATE_WORD and the card, without the AI', async () => {
    const lookup = await insertLookup(member.id);
    const card = await saved(lookup.lookupId);
    openai.reset();

    const response = await save(lookup.lookupId);

    await expectApiError(response.clone(), 'DUPLICATE_WORD');
    const body = (await response.json()) as ErrorBody;
    expect(body.error.details?.savedCard).toEqual({
      id: card.id,
      lemma: card.lemma,
      pos: card.pos,
      meaningZh: card.meaningZh,
      examples: card.examples,
      updatedAt: card.updatedAt,
    });
    expect(openai.requests).toHaveLength(0);
  });

  it('asks whether another lookup of a saved word has the same meaning, and finds it does', async () => {
    const first = await insertLookup(member.id);
    const card = await saved(first.lookupId);
    const second = await sameMeaningLookup(first.lemma);
    openai.reset();

    const response = await save(second.lookupId);

    await expectApiError(response.clone(), 'DUPLICATE_WORD');
    const body = (await response.json()) as ErrorBody;
    expect(body.error.details?.savedCard).toMatchObject({ id: card.id, updatedAt: card.updatedAt });
    expect(formats()).toEqual(['meaning_match']);
    expect(sentData(openai.requests[0])).toEqual({
      word: {
        lemma: first.lemma,
        pos: 'adjective',
        meaningZh: second.meaningZh,
        examples: second.examples,
      },
      savedMeanings: [{ number: 1, meaningZh: card.meaningZh, examples: first.examples }],
    });
    expect(await usageOf('meaning_match')).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        resourceType: 'lookup',
        resourceId: second.lookupId,
      }),
    ]);
  });

  it('makes a second card of a word when the AI finds the meaning different', async () => {
    const first = await insertLookup(member.id);
    await saved(first.lookupId);
    const second = await insertLookup(member.id, { lemma: first.lemma, meaningZh: '能迅速恢复的' });
    openai.reset();

    const card = await saved(second.lookupId);

    expect(card.meaningZh).toBe('能迅速恢复的');
    expect(formats()).toEqual(['meaning_match', 'translation_options']);
    expect(await cardCount()).toBe(2);
  });

  it('takes another part of speech for another meaning without asking', async () => {
    const first = await insertLookup(member.id);
    await saved(first.lookupId);
    const second = await insertLookup(member.id, { lemma: first.lemma, pos: 'noun' });
    openai.reset();

    await saved(second.lookupId);

    expect(formats()).toEqual(['translation_options']);
  });

  it('sends the answer back once when the options would make two right answers', async () => {
    const lookup = await insertLookup(member.id);
    openai.answerNext({ output: { distractors: [lookup.meaningZh, '令人厌烦的', '非常昂贵的'] } });

    await saved(lookup.lookupId);

    expect(formats()).toEqual(['translation_options', 'translation_options']);
    expect(openai.requests[1].input.at(-1)?.content).toContain(
      'a distractor must not be the correct meaning',
    );
  });

  it('fails as UNAVAILABLE and keeps nothing when the AI cannot give the options', async () => {
    const lookup = await insertLookup(member.id);
    openai.answerNext({ status: 500 }, { status: 503 });

    await expectApiError(await save(lookup.lookupId), 'UNAVAILABLE');

    expect(await cardCount()).toBe(0);
  });

  it('answers a lookup that does not exist with 404', async () => {
    await expectApiError(await save(randomUUID()), 'NOT_FOUND');
  });

  it('refuses a body with fields of its own or a lookup ID that is not a UUID', async () => {
    const lookup = await insertLookup(member.id);
    await expectApiError(
      await POST(
        jsonRequest('/api/vocabulary', {
          operationId: randomUUID(),
          lookupId: lookup.lookupId,
          meaningZh: '别的',
        }),
      ),
      'INVALID_INPUT',
    );
    await expectApiError(
      await POST(jsonRequest('/api/vocabulary', { operationId: randomUUID(), lookupId: 'x' })),
      'INVALID_INPUT',
    );
  });
});

describe('saves at the same time', () => {
  it('make one card of one lookup and answer the other save with DUPLICATE_WORD', async () => {
    const lookup = await insertLookup(member.id);
    openai.answerNext({ delayMs: 150 }, { delayMs: 150 });

    const responses = await Promise.all([save(lookup.lookupId), save(lookup.lookupId)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expectApiError(
      responses.find((response) => response.status === 409)!,
      'DUPLICATE_WORD',
    );
    expect(await cardCount()).toBe(1);
  });

  it('decide again when a card of the same word appears, and find the same meaning', async () => {
    const first = await insertLookup(member.id);
    const second = await sameMeaningLookup(first.lemma);
    openai.answerNext({ delayMs: 100 }, { delayMs: 400 });

    const responses = await Promise.all([save(first.lookupId), save(second.lookupId)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expectApiError(
      responses.find((response) => response.status === 409)!,
      'DUPLICATE_WORD',
    );
    expect(await cardCount()).toBe(1);
    expect(formats().sort()).toEqual([
      'meaning_match',
      'translation_options',
      'translation_options',
    ]);
  });

  it('replays the first answer to a request repeated while the first is still saving', async () => {
    const lookup = await insertLookup(member.id);
    const operationId = randomUUID();
    openai.answerNext({ delayMs: 150 }, { delayMs: 150 });

    const [one, two] = await Promise.all([
      save(lookup.lookupId, operationId),
      save(lookup.lookupId, operationId),
    ]);

    expect(await readSuccess(two, 201)).toEqual(await readSuccess(one, 201));
  });
});
