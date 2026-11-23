// One card and the writes on it against a real PostgreSQL, with MSW standing in for OpenAI: the
// card's details; replacing it with an explanation of the same meaning while its progress stays
// and only the time DUPLICATE_WORD gave is taken; a new example in place of one; deleting one card
// or a batch, all or nothing; every write answering a repeated operationId with its first answer.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../../features/account/testing.ts';
import { openAiDouble, sentData, stubOpenAiEnv } from '../../../../features/lookup/testing.ts';
import { usageRecords } from '../../../../features/usage/index.ts';
import { vocabularyCards } from '../../../../features/vocabulary/index.ts';
import {
  cardRows,
  insertLookup,
  setProgress,
  vocabularyAnswers,
} from '../../../../features/vocabulary/testing.ts';
import {
  expectApiError,
  expectNotFound,
  jsonRequest,
  readSuccess,
} from '../../../../lib/api/testing.ts';
import { closeDatabase, getDatabase } from '../../../../lib/db/client.ts';
import { POST as bulkDelete } from '../bulk-delete/route.ts';
import { POST as save } from '../route.ts';
import { POST as refresh } from './examples/[exampleId]/refresh/route.ts';
import { POST as replace } from './replace/route.ts';
import { DELETE, GET } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../features/account/testing.ts')).nextServerStandIn(),
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

type Card = {
  id: string;
  lemma: string;
  meaningZh: string;
  updatedAt: string;
  progress: Record<string, { round: number; dueAt: string | null }>;
  examples: { id: string; position: number; text: string; targetRanges: [number, number][] }[];
};

let member: { id: string };

beforeEach(async () => {
  member = await signInAsMember();
});

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

async function newCard(lemma?: string): Promise<Card & { lookupId: string }> {
  const lookup = await insertLookup(member.id, { lemma });
  const response = await save(
    jsonRequest('/api/vocabulary', { operationId: randomUUID(), lookupId: lookup.lookupId }),
  );
  const card = ((await readSuccess(response, 201)) as { data: Card }).data;
  openai.reset();
  return { ...card, lookupId: lookup.lookupId };
}

function getCard(id: string) {
  return GET(new Request(`http://localhost:3000/api/vocabulary/${id}`), params({ id }));
}

function deleteCard(id: string, operationId: string = randomUUID()) {
  return DELETE(jsonRequest(`/api/vocabulary/${id}`, { operationId }, 'DELETE'), params({ id }));
}

function replaceCard(id: string, body: Record<string, unknown>) {
  return replace(
    jsonRequest(`/api/vocabulary/${id}/replace`, { operationId: randomUUID(), ...body }),
    params({ id }),
  );
}

function refreshExample(id: string, exampleId: string, operationId: string = randomUUID()) {
  return refresh(
    jsonRequest(`/api/vocabulary/${id}/examples/${exampleId}/refresh`, { operationId }),
    params({ id, exampleId }),
  );
}

function deleteBatch(ids: string[], operationId: string = randomUUID()) {
  return bulkDelete(jsonRequest('/api/vocabulary/bulk-delete', { operationId, ids }));
}

async function cardExists(id: string): Promise<boolean> {
  const rows = await db.select().from(vocabularyCards).where(eq(vocabularyCards.id, id));
  return rows.length === 1;
}

describe('GET /api/vocabulary/:id', () => {
  it('answers the card with its progress, examples and last change', async () => {
    const card = await newCard();

    const body = (await readSuccess(await getCard(card.id))) as { data: Card };

    expect(body.data).toEqual({
      id: card.id,
      lemma: card.lemma,
      pos: 'adjective',
      meaningZh: card.meaningZh,
      updatedAt: card.updatedAt,
      progress: card.progress,
      examples: card.examples,
    });
  });

  it('answers a card that does not exist, or a path that is no UUID, with 404', async () => {
    await expectNotFound(await getCard(randomUUID()));
    await expectNotFound(await getCard('not-a-card'));
  });
});

describe('POST /api/vocabulary/:id/replace', () => {
  async function sameMeaning(card: Card) {
    return insertLookup(member.id, {
      lemma: card.lemma,
      meaningZh: '经得起考验的',
      examples: [
        `Her ${card.lemma} spirit helped the whole team through a very hard year.`,
        `A ${card.lemma} economy recovers quickly after a sudden shock to prices.`,
      ],
    });
  }

  it('puts the new meaning, examples and options on the card and keeps its progress', async () => {
    const card = await newCard();
    const due = new Date(Date.now() + 86_400_000);
    await setProgress(member.id, card.id, 'spell', 3, due);
    const before = await cardRows(card.id);
    const lookup = await sameMeaning(card);

    const body = (await readSuccess(
      await replaceCard(card.id, { lookupId: lookup.lookupId, updatedAt: card.updatedAt }),
    )) as { data: Card };

    expect(body.data).toMatchObject({
      id: card.id,
      meaningZh: '经得起考验的',
      examples: lookup.examples.map((text, position) => ({ position, text })),
    });
    expect(Date.parse(body.data.updatedAt)).toBeGreaterThan(Date.parse(card.updatedAt));
    const after = await cardRows(card.id);
    expect(after.card.sourceLookupEntryId).toBe(lookup.lookupId);
    expect(after.progress).toEqual(before.progress);
    expect(after.options.correctOptionId).not.toBe(before.options.correctOptionId);
    expect(
      after.options.options.find((option) => option.id === after.options.correctOptionId),
    ).toMatchObject({ meaningZh: '经得起考验的' });
    const [usage] = await db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.resourceId, card.id));
    expect(usage).toMatchObject({ kind: 'translation', resourceType: 'card', status: 'succeeded' });
    expect(sentData(openai.requests[0])).toMatchObject({ meaningZh: '经得起考验的' });
  });

  it('refuses a stale card time with CONFLICT and changes nothing', async () => {
    const card = await newCard();
    const lookup = await sameMeaning(card);
    const stale = new Date(Date.parse(card.updatedAt) - 1000).toISOString();

    await expectApiError(
      await replaceCard(card.id, { lookupId: lookup.lookupId, updatedAt: stale }),
      'CONFLICT',
    );

    expect((await cardRows(card.id)).card.meaningZh).toBe(card.meaningZh);
    expect(openai.requests).toHaveLength(0);
  });

  it('takes the first of two replacements made with the same time', async () => {
    const card = await newCard();
    const first = await sameMeaning(card);
    const second = await sameMeaning(card);
    openai.answerNext({ delayMs: 100 }, { delayMs: 300 });

    const responses = await Promise.all([
      replaceCard(card.id, { lookupId: first.lookupId, updatedAt: card.updatedAt }),
      replaceCard(card.id, { lookupId: second.lookupId, updatedAt: card.updatedAt }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await expectApiError(
      responses.find((response) => response.status === 409)!,
      'CONFLICT',
    );
  });

  it('refuses an explanation of another word or part of speech', async () => {
    const card = await newCard();
    const other = await insertLookup(member.id);
    const noun = await insertLookup(member.id, { lemma: card.lemma, pos: 'noun' });

    for (const lookup of [other, noun]) {
      await expectApiError(
        await replaceCard(card.id, { lookupId: lookup.lookupId, updatedAt: card.updatedAt }),
        'INVALID_INPUT',
      );
    }
  });

  it('answers a deleted card with 404', async () => {
    const card = await newCard();
    const lookup = await sameMeaning(card);
    expect((await deleteCard(card.id)).status).toBe(204);

    await expectNotFound(
      await replaceCard(card.id, { lookupId: lookup.lookupId, updatedAt: card.updatedAt }),
    );
  });

  it('keeps the card as it was when the AI cannot give the options', async () => {
    const card = await newCard();
    const lookup = await sameMeaning(card);
    openai.answerNext({ status: 500 }, { status: 500 });

    await expectApiError(
      await replaceCard(card.id, { lookupId: lookup.lookupId, updatedAt: card.updatedAt }),
      'UNAVAILABLE',
    );

    expect((await cardRows(card.id)).card.meaningZh).toBe(card.meaningZh);
  });
});

describe('POST /api/vocabulary/:id/examples/:exampleId/refresh', () => {
  it('puts a new example in the old one’s place and records the call on the card', async () => {
    const card = await newCard();
    const [first, second] = card.examples;

    const body = (await readSuccess(await refreshExample(card.id, second.id))) as {
      data: Card['examples'][number];
    };

    expect(body.data).toMatchObject({ position: 1, targetRanges: [expect.any(Array)] });
    expect(body.data.id).not.toBe(second.id);
    const rows = await cardRows(card.id);
    expect(rows.examples.map((example) => example.text)).toEqual([first.text, body.data.text]);
    expect(rows.card.updatedAt.getTime()).toBeGreaterThan(Date.parse(card.updatedAt));
    expect(sentData(openai.requests[0])).toMatchObject({
      lemma: card.lemma,
      passage: second.text,
      existingExamples: [first.text, second.text],
    });
    const [usage] = await db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.resourceId, card.id));
    expect(usage).toMatchObject({ kind: 'example', resourceType: 'card' });
  });

  it('answers a replaced example with CONFLICT and a repeated refresh with its first answer', async () => {
    const card = await newCard();
    const operationId = randomUUID();
    const exampleId = card.examples[0].id;
    const first = await readSuccess(await refreshExample(card.id, exampleId, operationId));

    expect(await readSuccess(await refreshExample(card.id, exampleId, operationId))).toEqual(first);
    await expectApiError(await refreshExample(card.id, exampleId), 'CONFLICT');
  });

  it('answers a card or example path that names nothing with 404', async () => {
    const card = await newCard();
    await expectNotFound(await refreshExample(randomUUID(), card.examples[0].id));
    await expectNotFound(await refreshExample(card.id, 'nothing'));
  });
});

describe('DELETE /api/vocabulary/:id', () => {
  it('deletes the card with its examples, options and progress and keeps the lookup', async () => {
    const card = await newCard();

    expect((await deleteCard(card.id)).status).toBe(204);

    expect(await cardRows(card.id)).toEqual({
      card: undefined,
      examples: [],
      options: undefined,
      progress: [],
    });
  });

  it('answers a repeated delete with 204 and a card that is gone with 404', async () => {
    const card = await newCard();
    const operationId = randomUUID();

    expect((await deleteCard(card.id, operationId)).status).toBe(204);
    expect((await deleteCard(card.id, operationId)).status).toBe(204);
    await expectNotFound(await deleteCard(card.id));
  });
});

describe('POST /api/vocabulary/bulk-delete', () => {
  it('deletes every chosen card in one go', async () => {
    const cards = [await newCard(), await newCard(), await newCard()];

    const response = await deleteBatch(cards.slice(0, 2).map((card) => card.id));

    expect(response.status).toBe(204);
    expect(await Promise.all(cards.map((card) => cardExists(card.id)))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('deletes nothing and names the cards that are gone when any of them is', async () => {
    const card = await newCard();
    const gone = randomUUID();

    const response = await deleteBatch([card.id, gone]);

    await expectApiError(response.clone(), 'SELECTION_CHANGED');
    const body = (await response.json()) as { error: { details: { missingIds: string[] } } };
    expect(body.error.details.missingIds).toEqual([gone]);
    expect(await cardExists(card.id)).toBe(true);
  });

  it('answers a repeated batch with its first answer', async () => {
    const card = await newCard();
    const operationId = randomUUID();

    expect((await deleteBatch([card.id], operationId)).status).toBe(204);
    expect((await deleteBatch([card.id], operationId)).status).toBe(204);
  });

  it('refuses an empty batch, more than 100 cards and a card named twice', async () => {
    const card = await newCard();
    await expectApiError(await deleteBatch([]), 'INVALID_INPUT');
    await expectApiError(
      await deleteBatch(Array.from({ length: 101 }, () => randomUUID())),
      'INVALID_INPUT',
    );
    await expectApiError(await deleteBatch([card.id, card.id]), 'INVALID_INPUT');
  });
});
