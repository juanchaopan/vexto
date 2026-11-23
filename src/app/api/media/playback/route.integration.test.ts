// POST /api/media/playback against a real PostgreSQL, with MSW standing in for vexto-tts and the
// S3Mock bucket's settings for signing: article audio is signed at once, word and example audio
// is made once, recorded and shared, and a speech service that fails leaves the row to retry.
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signInAsMember } from '../../../../features/account/testing.ts';
import { audioAssets, speechCacheKey } from '../../../../features/audio/index.ts';
import { createArticle, createCard, createLookup } from '../../../../features/media/testing.ts';
import {
  playbackServices,
  readySpeechAudio,
  SpeechServiceError,
} from '../../../../features/playback/index.ts';
import {
  speechServiceDouble,
  stubSpeechService,
  TEST_SPEECH_SERVICE_URL,
} from '../../../../features/playback/testing.ts';
import { usageRecords } from '../../../../features/usage/index.ts';
import { expectApiError, jsonRequest, readSuccess } from '../../../../lib/api/testing.ts';
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
  speech.answerWith('answer');
  speech.requests.length = 0;
});

afterAll(async () => {
  speech.server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeDatabase();
});

type Answer = { data: { url: string; expiresAt: string; durationMs: number } };

function play(locator: unknown) {
  return POST(jsonRequest('/api/media/playback', locator));
}

async function played(locator: unknown) {
  return (await readSuccess(await play(locator))) as Answer;
}

function objectPath(url: string) {
  return new URL(url).pathname;
}

async function audioOf(text: string) {
  const rows = await getDatabase()
    .select()
    .from(audioAssets)
    .where(eq(audioAssets.cacheKey, speechCacheKey(text, speechVersionOf(speechConfig))));
  return rows;
}

async function usageOf(audioId: string) {
  return getDatabase().select().from(usageRecords).where(eq(usageRecords.resourceId, audioId));
}

describe('POST /api/media/playback', () => {
  it('signs a ten-minute address of a ready article audio without calling the speech service', async () => {
    await signInAsMember();
    const article = await createArticle();
    const before = Date.now();

    const { data } = await played({ kind: 'article', articleId: article.articleId });

    const url = new URL(data.url);
    expect(url.pathname).toBe(`/${process.env.S3_BUCKET}/${article.objectKey}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    const expiresAt = Date.parse(data.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(data.durationMs).toBe(article.durationMs);
    expect(speech.requests).toEqual([]);
  });

  it('answers 404 for an article that is not ready or does not exist', async () => {
    await signInAsMember();
    const preparing = await createArticle('preparing');

    await expectApiError(
      await play({ kind: 'article', articleId: preparing.articleId }),
      'NOT_FOUND',
    );
    await expectApiError(
      await play({ kind: 'article', articleId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }),
      'NOT_FOUND',
    );
  });

  it('makes a word audio once, records it and its usage, and signs its object', async () => {
    const member = await signInAsMember();
    const lookup = await createLookup(member.id);

    const { data } = await played({ kind: 'lookup-word', lookupId: lookup.lookupId });

    const [row] = await audioOf(lookup.lemma);
    expect(row).toMatchObject({
      state: 'ready',
      objectKey: `speech/${row.id}.mp3`,
      byteSize: lookup.lemma.length * 160,
      durationMs: lookup.lemma.length * 40,
      voice: speechConfig.voice,
      modelRevision: speechConfig.modelRevision,
      encoding: speechConfig.encoding.version,
    });
    expect(speech.requests).toEqual([
      {
        authorization: null,
        body: {
          key: row.objectKey,
          text: lookup.lemma,
          voice: speechConfig.voice,
          modelRevision: speechConfig.modelRevision,
          encodingVersion: speechConfig.encoding.version,
        },
      },
    ]);
    expect(objectPath(data.url)).toBe(`/${process.env.S3_BUCKET}/${row.objectKey}`);
    expect(data.url).not.toContain('take');
    expect(data.durationMs).toBe(row.durationMs);
    expect(await usageOf(row.id)).toEqual([
      expect.objectContaining({
        kind: 'word_tts',
        provider: speechConfig.provider,
        model: speechConfig.model,
        engineRevision: speechConfig.modelRevision,
        status: 'succeeded',
        ownerId: member.id,
        resourceType: 'audio',
        audioMs: row.durationMs,
        cpuMs: 75,
        byteCount: row.byteSize,
        finishedAt: expect.any(Date),
      }),
    ]);
  });

  it('reuses the ready audio of the same text for anyone, without calling again', async () => {
    const first = await signInAsMember();
    const lookup = await createLookup(first.id);
    await played({ kind: 'lookup-word', lookupId: lookup.lookupId });
    const second = await signInAsMember();
    const card = await createCard(second.id, { lemma: lookup.lemma });

    const { data } = await played({ kind: 'card-word', cardId: card.cardId });

    const [row] = await audioOf(lookup.lemma);
    expect(objectPath(data.url)).toBe(`/${process.env.S3_BUCKET}/${row.objectKey}`);
    expect(speech.requests).toHaveLength(1);
    expect(await usageOf(row.id)).toHaveLength(1);
  });

  it('reads examples from their normalized text and records them as example speech', async () => {
    const member = await signInAsMember();
    const lookup = await createLookup(member.id);
    const card = await createCard(member.id);

    await played({
      kind: 'lookup-example',
      lookupId: lookup.lookupId,
      exampleId: lookup.exampleId,
    });
    await played({ kind: 'card-example', cardId: card.cardId, exampleId: card.exampleId });

    const normalized = lookup.exampleText.replace(/\s+/g, ' ');
    expect(speech.requests.map((request) => request.body.text)).toEqual([
      normalized,
      card.exampleText,
    ]);
    const [audio] = await audioOf(normalized);
    expect(await usageOf(audio.id)).toEqual([
      expect.objectContaining({ kind: 'example_tts', status: 'succeeded' }),
    ]);
  });

  it('answers 503, keeps the row pending and records the failure when the service fails', async () => {
    const member = await signInAsMember();
    const card = await createCard(member.id);
    speech.answerWith('refuse');

    await expectApiError(await play({ kind: 'card-word', cardId: card.cardId }), 'UNAVAILABLE');

    const [pending] = await audioOf(card.lemma);
    expect(pending).toMatchObject({ state: 'pending', byteSize: null });
    expect(await usageOf(pending.id)).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'http_503' }),
    ]);

    speech.answerWith('answer');
    await played({ kind: 'card-word', cardId: card.cardId });

    const [ready] = await audioOf(card.lemma);
    expect(ready).toMatchObject({ id: pending.id, state: 'ready' });
    expect(speech.requests.map((request) => request.body.key)).toEqual([
      pending.objectKey,
      pending.objectKey,
    ]);
  });

  it('lets two requests that meet the same pending row both call, and keeps one row', async () => {
    const member = await signInAsMember();
    const card = await createCard(member.id);
    speech.answerWith('slow');

    const answers = await Promise.all([
      played({ kind: 'card-word', cardId: card.cardId }),
      played({ kind: 'card-word', cardId: card.cardId }),
    ]);

    const rows = await audioOf(card.lemma);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('ready');
    expect(new Set(answers.map((answer) => objectPath(answer.data.url))).size).toBe(1);
    expect(new Set(speech.requests.map((request) => request.body.key))).toEqual(
      new Set([rows[0].objectKey]),
    );
  });
});

describe('readySpeechAudio', () => {
  it('records a call that timed out as unknown usage', async () => {
    const member = await signInAsMember();
    const card = await createCard(member.id);
    const services = {
      ...playbackServices(),
      speechService: stubSpeechService(
        new SpeechServiceError('unknown', 'timeout', 'The speech service timed out.'),
      ),
    };

    await expect(
      readySpeechAudio(services, { text: card.lemma, usageKind: 'word_tts', ownerId: member.id }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    const [row] = await audioOf(card.lemma);
    expect(row.state).toBe('pending');
    expect(await usageOf(row.id)).toEqual([
      expect.objectContaining({
        status: 'unknown',
        errorCode: 'timeout',
        audioMs: null,
        cpuMs: null,
      }),
    ]);
  });
});
