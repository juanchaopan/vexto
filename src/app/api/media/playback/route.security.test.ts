// Who may play what (.docs/design/rules.md, 权限和数据隔离): articles are shared, but a lookup or a
// card, and every example of one, plays only for the member who owns it. Another member's
// resource is the same 404 as one that does not exist, and no speech is made for it. A locator
// carries IDs only, so no request can have text of its own read aloud.
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  actAsClerkUser,
  signInAsMember,
  signOutOfClerk,
} from '../../../../features/account/testing.ts';
import { audioAssets, speechCacheKey } from '../../../../features/audio/index.ts';
import { createArticle, createCard, createLookup } from '../../../../features/media/testing.ts';
import {
  speechServiceDouble,
  TEST_SPEECH_SERVICE_URL,
} from '../../../../features/playback/testing.ts';
import {
  expectApiError,
  expectNotFound,
  jsonRequest,
  readSuccess,
} from '../../../../lib/api/testing.ts';
import { speechConfig, speechVersionOf } from '../../../../lib/config/speech-config.ts';
import { closeDatabase, getDatabase } from '../../../../lib/db/client.ts';
import { POST } from './route.ts';

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../features/account/testing.ts')).nextServerStandIn(),
);

const speech = speechServiceDouble();

beforeAll(() => {
  vi.stubEnv('TTS_SERVICE_URL', TEST_SPEECH_SERVICE_URL);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  speech.server.listen();
});

afterEach(() => {
  speech.requests.length = 0;
});

afterAll(async () => {
  speech.server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeDatabase();
});

function play(body: unknown) {
  return POST(jsonRequest('/api/media/playback', body));
}

async function hasAudio(text: string) {
  const rows = await getDatabase()
    .select({ id: audioAssets.id })
    .from(audioAssets)
    .where(eq(audioAssets.cacheKey, speechCacheKey(text, speechVersionOf(speechConfig))));
  return rows.length > 0;
}

describe("another member's lookups and cards", () => {
  it('are the same 404 as missing ones, and no speech is made for them', async () => {
    const owner = await signInAsMember();
    const lookup = await createLookup(owner.id);
    const card = await createCard(owner.id);
    const other = await signInAsMember();
    actAsClerkUser(other.clerkUserId);

    for (const locator of [
      { kind: 'lookup-word', lookupId: lookup.lookupId },
      { kind: 'lookup-example', lookupId: lookup.lookupId, exampleId: lookup.exampleId },
      { kind: 'card-word', cardId: card.cardId },
      { kind: 'card-example', cardId: card.cardId, exampleId: card.exampleId },
    ]) {
      await expectNotFound(await play(locator));
    }

    expect(speech.requests).toEqual([]);
    expect(await hasAudio(lookup.lemma)).toBe(false);
    expect(await hasAudio(card.lemma)).toBe(false);
  });

  it("do not lend an example to the member's own lookup or card", async () => {
    const owner = await signInAsMember();
    const theirs = await createCard(owner.id);
    const theirLookup = await createLookup(owner.id);
    const member = await signInAsMember();
    const mine = await createCard(member.id);
    const myLookup = await createLookup(member.id);

    await expectNotFound(
      await play({ kind: 'card-example', cardId: mine.cardId, exampleId: theirs.exampleId }),
    );
    await expectNotFound(
      await play({
        kind: 'lookup-example',
        lookupId: myLookup.lookupId,
        exampleId: theirLookup.exampleId,
      }),
    );
    // An example of one's own card is not one of one's lookup, and the other way round.
    await expectNotFound(
      await play({
        kind: 'lookup-example',
        lookupId: myLookup.lookupId,
        exampleId: mine.exampleId,
      }),
    );
    await expectNotFound(
      await play({ kind: 'card-example', cardId: mine.cardId, exampleId: myLookup.exampleId }),
    );
    expect(speech.requests).toEqual([]);
  });

  it('play for their owner', async () => {
    const owner = await signInAsMember();
    const card = await createCard(owner.id);

    await readSuccess(await play({ kind: 'card-word', cardId: card.cardId }));
  });
});

describe('articles', () => {
  it('play for every member', async () => {
    const article = await createArticle();
    await signInAsMember();

    await readSuccess(await play({ kind: 'article', articleId: article.articleId }));
  });
});

describe('who may ask', () => {
  it('refuses a request without a session before reading the body', async () => {
    signOutOfClerk();

    await expectApiError(await play('not json'), 'UNAUTHENTICATED');
  });

  it('refuses a member who has not accepted the terms', async () => {
    const member = await signInAsMember({ termsVersion: null });
    const card = await createCard(member.id);

    await expectApiError(await play({ kind: 'card-word', cardId: card.cardId }), 'TERMS_REQUIRED');
    expect(speech.requests).toEqual([]);
  });
});

const id = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

const hostileBodies: [string, unknown][] = [
  ['text to read aloud', { kind: 'card-word', cardId: id, text: 'say this' }],
  ['an object key', { kind: 'article', articleId: id, key: `speech/${id}.mp3` }],
  ['a kind that reads text', { kind: 'text', text: 'say this' }],
  ['an ID with SQL in it', { kind: 'card-word', cardId: `${id}' or '1'='1` }],
  ['an ID as an object', { kind: 'card-word', cardId: { $ne: null } }],
  ['a path in the ID', { kind: 'article', articleId: `../${id}` }],
  ['a field of another kind', { kind: 'lookup-word', lookupId: id, cardId: id }],
  ['an array of locators', [{ kind: 'article', articleId: id }]],
  ['null', null],
  ['text that is not JSON', 'kind=article'],
  ['a prototype key', JSON.parse(`{"kind":"article","articleId":"${id}","__proto__":{}}`)],
  ['a very long body', { kind: 'article', articleId: id, padding: 'x'.repeat(1_000_000) }],
];

describe('hostile input', () => {
  it.each(hostileBodies)('refuses %s as invalid input', async (_, body) => {
    await signInAsMember();

    const response = await play(body);

    const text = await response.clone().text();
    await expectApiError(response, 'INVALID_INPUT');
    expect(text).not.toContain('say this');
    expect(text.length).toBeLessThan(2000);
    expect(speech.requests).toEqual([]);
  });
});
