// Test kit for code that plays word and example speech. Only test files import this module.
//
// - speechServiceDouble(): MSW in front of the network, answering `POST /synthesize` at
//   TEST_SPEECH_SERVICE_URL like vexto-tts does, failing or delaying as a test tells it, and
//   recording every request. Point the code at it with `vi.stubEnv('TTS_SERVICE_URL', ...)` before
//   the first request of the test file; the federation values stay unset, as on a development
//   machine, so no identity token is fetched.
// - stubSpeechService(): a SpeechServiceClient for tests that call the flow directly.
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { SpeechAnswer, SpeechRequest } from '../audio/index.ts';
import type { SpeechServiceClient } from './server/speech-service-client.ts';

export const TEST_SPEECH_SERVICE_URL = 'http://tts.test';

/** The answer vexto-tts would give: 40 ms of audio per character at 4 bytes a millisecond. */
export function speechAnswerFor(request: SpeechRequest): SpeechAnswer {
  const durationMs = request.text.length * 40;
  return { key: request.key, byteSize: durationMs * 4, durationMs, usage: { cpuMs: 75 } };
}

export type SpeechServiceMode = 'answer' | 'refuse' | 'slow';

export function speechServiceDouble() {
  const requests: { body: SpeechRequest; authorization: string | null }[] = [];
  let mode: SpeechServiceMode = 'answer';
  const server = setupServer(
    http.post(`${TEST_SPEECH_SERVICE_URL}/synthesize`, async ({ request }) => {
      const body = (await request.json()) as SpeechRequest;
      requests.push({ body, authorization: request.headers.get('authorization') });
      if (mode === 'refuse') {
        return HttpResponse.json(
          { error: { code: 'UNAVAILABLE', message: 'The test service failed.', retryable: true } },
          { status: 503 },
        );
      }
      if (mode === 'slow') {
        await delay(200);
      }
      return HttpResponse.json(speechAnswerFor(body));
    }),
  );
  return {
    server,
    requests,
    /** How the service answers from now on. */
    answerWith(next: SpeechServiceMode) {
      mode = next;
    },
  };
}

/** A client that answers every request as the speech service would, or throws `failure`. */
export function stubSpeechService(failure?: Error): SpeechServiceClient & {
  requests: SpeechRequest[];
} {
  const requests: SpeechRequest[] = [];
  return {
    requests,
    async synthesize(request) {
      requests.push(request);
      if (failure) {
        throw failure;
      }
      return speechAnswerFor(request);
    },
  };
}
