import { describe, expect, it } from 'vitest';
import {
  createSpeechServiceClient,
  speechServiceFromEnv,
  SpeechServiceError,
} from './speech-service-client.ts';

const request = {
  key: 'speech/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3',
  text: 'take off',
  voice: 'F1',
  modelRevision: 'a'.repeat(40),
  encodingVersion: 'mp3-mono-32k-v1',
};

const answer = { key: request.key, byteSize: 4000, durationMs: 900, usage: { cpuMs: 1200 } };

type Sent = { url: string; init: RequestInit };

function client(respond: (sent: Sent) => Promise<Response>, token: string | null = 'id-token') {
  const sent: Sent[] = [];
  const speech = createSpeechServiceClient({
    serviceUrl: 'https://tts.example.test',
    idToken: async () => token,
    timeoutMs: 50,
    fetch: async (input, init) => {
      const call = { url: String(input), init: init ?? {} };
      sent.push(call);
      return respond(call);
    },
  });
  return { speech, sent };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SpeechServiceError);
  return error as SpeechServiceError;
}

describe('createSpeechServiceClient', () => {
  it('posts the request with the identity token and reads the answer', async () => {
    const { speech, sent } = client(async () => Response.json(answer));

    expect(await speech.synthesize(request)).toEqual(answer);
    expect(sent[0].url).toBe('https://tts.example.test/synthesize');
    expect(sent[0].init.method).toBe('POST');
    expect(sent[0].init.headers).toMatchObject({ Authorization: 'Bearer id-token' });
    expect(JSON.parse(String(sent[0].init.body))).toEqual(request);
  });

  it('sends no Authorization header without a token', async () => {
    const { speech, sent } = client(async () => Response.json(answer), null);

    await speech.synthesize(request);

    expect(sent[0].init.headers).not.toHaveProperty('Authorization');
  });

  it('reports a timeout as an unknown outcome', async () => {
    const { speech } = client(
      ({ init }) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        ),
    );

    expect(await failure(speech.synthesize(request))).toMatchObject({
      outcome: 'unknown',
      code: 'timeout',
    });
  });

  it('reports a refusal of the service as failed with its status', async () => {
    const { speech } = client(async () => Response.json({ error: {} }, { status: 503 }));

    expect(await failure(speech.synthesize(request))).toMatchObject({
      outcome: 'failed',
      code: 'http_503',
    });
  });

  it('reports a service it cannot reach as failed', async () => {
    const { speech } = client(async () => {
      throw new TypeError('fetch failed');
    });

    expect(await failure(speech.synthesize(request))).toMatchObject({
      outcome: 'failed',
      code: 'unreachable',
    });
  });

  it('reports an answer for another key or of another shape as unknown', async () => {
    const other = client(async () => Response.json({ ...answer, key: 'smoke/check.mp3' }));
    const broken = client(async () => new Response('not json', { status: 200 }));

    expect(await failure(other.speech.synthesize(request))).toMatchObject({ code: 'bad_answer' });
    expect(await failure(broken.speech.synthesize(request))).toMatchObject({ outcome: 'unknown' });
  });

  it('fails without calling when no identity token can be had', async () => {
    const speech = createSpeechServiceClient({
      serviceUrl: 'https://tts.example.test',
      idToken: async () => {
        throw new Error('STS refused the token.');
      },
    });

    expect(await failure(speech.synthesize(request))).toMatchObject({ code: 'no_token' });
  });
});

describe('speechServiceFromEnv', () => {
  it('fails every call when TTS_SERVICE_URL is not set', async () => {
    expect(await failure(speechServiceFromEnv({}).synthesize(request))).toMatchObject({
      outcome: 'failed',
      code: 'not_configured',
    });
  });
});
