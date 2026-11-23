// POST /api/lookups against a real PostgreSQL, with MSW standing in for OpenAI: an article lookup
// asks the AI once and keeps the explanation, a repeated selection is answered from the member's
// cache (also from another article with the same sentences), an answer that fails the checks is
// repaired once, temporary failures are tried once more, and every call has a usage record with
// its tokens and estimated cost.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../features/account/testing.ts';
import {
  examples,
  lookupEntries,
  lookupResult,
  modelServices,
} from '../../../features/lookup/index.ts';
import {
  fixedExplanation,
  openAiDouble,
  sentData,
  stubOpenAiEnv,
  TEST_USAGE,
} from '../../../features/lookup/testing.ts';
import { createCard } from '../../../features/media/testing.ts';
import { insertArticle } from '../../../features/reading/testing.ts';
import { usageRecords } from '../../../features/usage/index.ts';
import { cardSources, vocabularyCards } from '../../../features/vocabulary/index.ts';
import {
  expectApiError,
  expectNotFound,
  jsonRequest,
  readSuccess,
} from '../../../lib/api/testing.ts';
import { aiConfig } from '../../../lib/config/ai-config.ts';
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

const openai = openAiDouble();
const db = getDatabase();

const FIRST = 'Moon dust is fine, sharp and surprisingly sticky.';
const SECOND = 'Engineers want equipment that is resilient enough to keep working.';
const THIRD = 'They gradually increased the amount of dust.';

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

type LookupBody = {
  data: {
    id: string;
    selectedText: string;
    lemma: string;
    pos: string;
    meaningZh: string;
    examples: { id: string; position: number; text: string; targetRanges: [number, number][] }[];
    savedCardId: string | null;
  };
};

type LookupBodyInput = Parameters<typeof lookupResult>[1];

let member: { id: string };
let articleId: string;

beforeEach(async () => {
  member = await signInAsMember();
  articleId = (await insertArticle(db, { paragraphs: [[FIRST, SECOND], [THIRD]] })).id;
});

function lookUp(body: unknown) {
  return POST(jsonRequest('/api/lookups', body));
}

function inSentence(sentence: number, text: string, word: string) {
  const start = text.indexOf(word);
  return {
    operationId: randomUUID(),
    context: {
      kind: 'article' as const,
      articleId,
      firstSentence: sentence,
      lastSentence: sentence,
    },
    selection: { start, end: start + word.length },
  };
}

async function created(body: unknown): Promise<LookupBody> {
  return (await readSuccess(await lookUp(body), 201)) as LookupBody;
}

async function usageOf(ownerId: string) {
  return db
    .select()
    .from(usageRecords)
    .where(and(eq(usageRecords.ownerId, ownerId), eq(usageRecords.kind, 'lookup')))
    .orderBy(usageRecords.startedAt);
}

describe('POST /api/lookups', () => {
  it('explains a word of an article, keeps the explanation and records the call', async () => {
    const { data } = await created(inSentence(1, SECOND, 'resilient'));

    const expected = fixedExplanation('resilient');
    expect(data).toEqual({
      id: expect.any(String),
      selectedText: 'resilient',
      lemma: 'resilient',
      pos: 'adjective',
      meaningZh: expected.meaningZh,
      examples: [
        {
          id: expect.any(String),
          position: 0,
          text: expected.examples[0],
          targetRanges: [[33, 42]],
        },
        {
          id: expect.any(String),
          position: 1,
          text: expected.examples[1],
          targetRanges: [[21, 30]],
        },
      ],
      savedCardId: null,
    });
    const [entry] = await db.select().from(lookupEntries).where(eq(lookupEntries.id, data.id));
    expect(entry).toMatchObject({
      ownerId: member.id,
      contextText: SECOND,
      selectedText: 'resilient',
      lemmaKey: 'resilient',
      acceptedForms: ['resilient'],
    });
    expect(await usageOf(member.id)).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        provider: 'openai',
        model: aiConfig.model,
        requestId: expect.stringMatching(/^req_/),
        inputTokens: TEST_USAGE.inputTokens,
        outputTokens: TEST_USAGE.outputTokens,
        estimatedCost: '0.000129',
        priceVersion: priceConfig.version,
      }),
    ]);
  });

  it('asks the configured model for strict structured output without tools or storage', async () => {
    await lookUp(inSentence(1, SECOND, 'resilient'));

    const [request] = openai.requests;
    expect(request).toMatchObject({
      model: aiConfig.model,
      max_output_tokens: aiConfig.maxOutputTokens,
      reasoning: { effort: aiConfig.reasoningEffort },
      store: false,
      text: { format: { type: 'json_schema', name: 'word_explanation', strict: true } },
    });
    expect(request.tools).toBeUndefined();
    expect(sentData(request)).toEqual({
      passage: SECOND,
      selection: 'resilient',
      textBefore: 'Engineers want equipment that is ',
    });
  });

  it('answers a repeated selection from the member’s cache without calling the AI', async () => {
    const first = await created(inSentence(1, SECOND, 'resilient'));

    const again = (await readSuccess(
      await lookUp(inSentence(1, SECOND, 'resilient')),
    )) as LookupBody;

    expect(again.data).toEqual(first.data);
    expect(openai.requests).toHaveLength(1);
  });

  it('shares an explanation between articles with the same sentences, however they break lines', async () => {
    const start = SECOND.indexOf('working');
    const first = await created({
      operationId: randomUUID(),
      context: { kind: 'article', articleId, firstSentence: 1, lastSentence: 2 },
      selection: { start, end: SECOND.length + 2 + 'They'.length },
    });
    expect(first.data.selectedText).toBe('working. They');

    const other = await insertArticle(db, { paragraphs: [[SECOND, THIRD]] });
    const second = (await readSuccess(
      await lookUp({
        operationId: randomUUID(),
        context: { kind: 'article', articleId: other.id, firstSentence: 0, lastSentence: 1 },
        selection: { start, end: SECOND.length + 1 + 'They'.length },
      }),
    )) as LookupBody;

    expect(second.data.id).toBe(first.data.id);
    expect(openai.requests).toHaveLength(1);
  });

  it('gives the first answer again for a repeated operationId, and refuses it for another request', async () => {
    const body = inSentence(1, SECOND, 'resilient');
    const first = await readSuccess(await lookUp(body), 201);

    expect(await readSuccess(await lookUp(body), 201)).toEqual(first);
    await expectApiError(
      await lookUp({ ...inSentence(0, FIRST, 'sticky'), operationId: body.operationId }),
      'OPERATION_MISMATCH',
    );
    expect(openai.requests).toHaveLength(1);
  });

  it('grows a selection to whole words without the punctuation at its ends', async () => {
    const { data } = await created({
      ...inSentence(0, FIRST, 'sticky'),
      selection: { start: FIRST.indexOf('rprisingly'), end: FIRST.length },
    });

    expect(data.selectedText).toBe('surprisingly sticky');
  });

  it('refuses a selection of more than 8 words, or without a word', async () => {
    const nine = 'Engineers want equipment that is resilient enough to keep';
    await expectApiError(await lookUp(inSentence(1, SECOND, nine)), 'INVALID_INPUT');
    await expectApiError(
      await lookUp({ ...inSentence(0, FIRST, 'fine'), selection: { start: 17, end: 18 } }),
      'INVALID_INPUT',
    );
    expect(openai.requests).toHaveLength(0);
  });

  it('accepts eight words', async () => {
    const eight = 'Engineers want equipment that is resilient enough to';
    expect((await lookUp(inSentence(1, SECOND, eight))).status).toBe(201);
  });

  it('explains a word of one of its own examples', async () => {
    const parent = await created(inSentence(1, SECOND, 'resilient'));
    const example = parent.data.examples[0];
    const start = example.text.indexOf('coating');

    const nested = await created({
      operationId: randomUUID(),
      context: { kind: 'lookup-example', lookupId: parent.data.id, exampleId: example.id },
      selection: { start, end: start + 'coating'.length },
    });

    expect(nested.data.lemma).toBe('coating');
    expect(sentData(openai.requests[1]).passage).toBe(example.text);
  });

  it('explains a word of a card’s example and keeps clear of a Spell question’s hidden word', async () => {
    const card = await createCard(member.id);
    const start = card.exampleText.indexOf('sunrise');
    const ids = { cardId: card.cardId, exampleId: card.exampleId };
    const selection = { start, end: start + 'sunrise'.length };
    const inContext = (kind: string, range = selection) => ({
      operationId: randomUUID(),
      context: { kind, ...ids },
      selection: range,
    });

    expect((await lookUp(inContext('vocabulary-example'))).status).toBe(201);
    expect((await lookUp(inContext('spell-example'))).status).toBe(200);
    await expectApiError(
      await lookUp(inContext('spell-example', { start: 0, end: 4 })),
      'HIDDEN_RANGE',
    );
  });

  it('says which card was saved from the lookup', async () => {
    const body = inSentence(1, SECOND, 'resilient');
    const { data } = await created(body);
    const [card] = await db
      .insert(vocabularyCards)
      .values({
        ownerId: member.id,
        sourceLookupEntryId: data.id,
        lemma: 'resilient',
        lemmaKey: 'resilient',
        pos: 'adjective',
        meaningZh: '有韧性的',
        acceptedForms: ['resilient'],
      })
      .returning({ id: vocabularyCards.id });

    const again = (await readSuccess(
      await lookUp({ ...body, operationId: randomUUID() }),
    )) as LookupBody;

    expect(again.data.savedCardId).toBe(card.id);
  });

  it('finds no context in an article that is not ready or a sentence it does not have', async () => {
    const preparing = await insertArticle(db, { state: 'preparing', paragraphs: [[SECOND]] });
    const body = inSentence(0, SECOND, 'resilient');
    for (const context of [
      { kind: 'article', articleId: preparing.id, firstSentence: 0, lastSentence: 0 },
      { kind: 'article', articleId, firstSentence: 2, lastSentence: 3 },
      { kind: 'article', articleId: randomUUID(), firstSentence: 0, lastSentence: 0 },
    ]) {
      await expectNotFound(await lookUp({ ...body, context }));
    }
  });
});

describe('answers that fail the checks', () => {
  it('sends an unacceptable answer back once with the reasons and keeps the repaired one', async () => {
    openai.answerNext({ output: { ...fixedExplanation('resilient'), meaningZh: 'tough' } });

    const response = await lookUp(inSentence(1, SECOND, 'resilient'));

    expect(response.status).toBe(201);
    expect(openai.requests).toHaveLength(2);
    const repair = openai.requests[1].input;
    expect(repair).toHaveLength(3);
    expect(repair[1]).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('tough'),
    });
    expect(repair[2].content).toContain('meaningZh must be written in Chinese');
    expect((await usageOf(member.id)).map((row) => [row.status, row.errorCode])).toEqual([
      ['failed', 'invalid_output'],
      ['succeeded', null],
    ]);
  });

  it('fails as unavailable when the repaired answer still fails, and keeps nothing', async () => {
    const invalid = { output: { ...fixedExplanation('resilient'), examples: ['Too short.'] } };
    openai.answerNext(invalid, invalid);

    await expectApiError(await lookUp(inSentence(1, SECOND, 'resilient')), 'UNAVAILABLE');

    const kept = await db.select().from(lookupEntries).where(eq(lookupEntries.ownerId, member.id));
    expect(kept).toEqual([]);
    expect(await usageOf(member.id)).toHaveLength(2);
  });

  it('never keeps an example the target cannot be found in', async () => {
    const draft = fixedExplanation('resilient');
    const without = 'A camera kept working in the desert all summer long.';
    openai.answerNext(
      { output: { ...draft, examples: [draft.examples[0], without] } },
      { output: draft },
    );

    const { data } = await created(inSentence(1, SECOND, 'resilient'));

    const rows = await db.select().from(examples).where(eq(examples.lookupEntryId, data.id));
    expect(rows.map((row) => row.text)).not.toContain(without);
    expect(rows.every((row) => row.targetRanges.length > 0)).toBe(true);
  });
});

describe('failures of the AI', () => {
  it('tries a rate-limited call once more', async () => {
    openai.answerNext({ status: 429 });

    expect((await lookUp(inSentence(1, SECOND, 'resilient'))).status).toBe(201);
    expect((await usageOf(member.id)).map((row) => [row.status, row.errorCode])).toEqual([
      ['failed', 'http_429'],
      ['succeeded', null],
    ]);
  });

  it('fails as unavailable after two server errors', async () => {
    openai.answerNext({ status: 500 }, { status: 503 });

    await expectApiError(await lookUp(inSentence(1, SECOND, 'resilient')), 'UNAVAILABLE');
    expect(openai.requests).toHaveLength(2);
  });

  it('does not try a refused request again', async () => {
    openai.answerNext({ status: 400 });

    await expectApiError(await lookUp(inSentence(1, SECOND, 'resilient')), 'UNAVAILABLE');
    expect(openai.requests).toHaveLength(1);
  });

  it('leaves the usage of a call that timed out unknown and tries once more', async () => {
    const quick = () => ({ ...modelServices(), config: { ...aiConfig, requestTimeoutMs: 200 } });
    const requester = { ownerId: member.id, requestId: 'req_test' };
    const body: LookupBodyInput = inSentence(1, SECOND, 'resilient');
    openai.answerNext({ delayMs: 1000 }, { delayMs: 1000 });

    await expect(
      lookupResult(requester, body, { cards: cardSources, model: quick }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    expect(await usageOf(member.id)).toEqual([
      expect.objectContaining({
        status: 'unknown',
        errorCode: 'timeout',
        inputTokens: null,
        estimatedCost: null,
      }),
      expect.objectContaining({
        status: 'unknown',
        errorCode: 'timeout',
        outputTokens: null,
        priceVersion: null,
      }),
    ]);

    openai.answerNext({ delayMs: 1000 });
    const retried = await lookupResult(
      requester,
      { ...body, operationId: randomUUID() },
      { cards: cardSources, model: quick },
    );
    expect(retried.status).toBe(201);
  });
});
