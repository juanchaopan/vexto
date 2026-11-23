// The web application's calls to the speech service vexto-tts (.docs/design/interfaces.md, 朗读
// 服务 vexto-tts): `POST /synthesize` at TTS_SERVICE_URL with the identity token, waiting at most
// 30 seconds, enough for a cold start that loads the model. A call that times out, or whose answer
// cannot be read, may still have made the audio, so its outcome is unknown; a call the service
// refused or never received failed.
import { speechAnswerSchema, type SpeechAnswer, type SpeechRequest } from '../../audio/index.ts';
import { idTokenSourceFromEnv, type IdTokenSource } from './google-identity.ts';

/** How long the web application waits for the speech service. */
export const SPEECH_SERVICE_TIMEOUT_MS = 30_000;

export type SpeechServiceOutcome = 'failed' | 'unknown';

/** A call to the speech service that did not give the audio; the code goes on the usage record. */
export class SpeechServiceError extends Error {
  readonly outcome: SpeechServiceOutcome;
  readonly code: string;

  constructor(
    outcome: SpeechServiceOutcome,
    code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SpeechServiceError';
    this.outcome = outcome;
    this.code = code;
  }
}

export type SpeechServiceClient = {
  synthesize(request: SpeechRequest): Promise<SpeechAnswer>;
};

export type SpeechServiceSettings = {
  serviceUrl: string;
  idToken: IdTokenSource;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

async function tokenFor(idToken: IdTokenSource) {
  try {
    return await idToken();
  } catch (error) {
    throw new SpeechServiceError(
      'failed',
      'no_token',
      'No identity token for the speech service.',
      {
        cause: error,
      },
    );
  }
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function answerOf(response: Response, request: SpeechRequest): Promise<SpeechAnswer> {
  if (!response.ok) {
    throw new SpeechServiceError(
      'failed',
      `http_${response.status}`,
      `The speech service answered ${response.status}.`,
    );
  }
  const parsed = speechAnswerSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.key !== request.key) {
    throw new SpeechServiceError(
      'unknown',
      'bad_answer',
      'The speech service answer is unreadable.',
    );
  }
  return parsed.data;
}

export function createSpeechServiceClient(settings: SpeechServiceSettings): SpeechServiceClient {
  const timeoutMs = settings.timeoutMs ?? SPEECH_SERVICE_TIMEOUT_MS;
  const send = settings.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    async synthesize(request) {
      const token = await tokenFor(settings.idToken);
      let response: Response;
      try {
        response = await send(new URL('/synthesize', settings.serviceUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw isTimeout(error)
          ? new SpeechServiceError('unknown', 'timeout', 'The speech service timed out.', {
              cause: error,
            })
          : new SpeechServiceError('failed', 'unreachable', 'The speech service is unreachable.', {
              cause: error,
            });
      }
      return answerOf(response, request);
    },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** The client of TTS_SERVICE_URL, with the token the runtime values call for. */
export function speechServiceFromEnv(env: Env = process.env): SpeechServiceClient {
  const serviceUrl = env.TTS_SERVICE_URL;
  if (!serviceUrl) {
    return {
      async synthesize() {
        throw new SpeechServiceError('failed', 'not_configured', 'TTS_SERVICE_URL is not set.');
      },
    };
  }
  return createSpeechServiceClient({ serviceUrl, idToken: idTokenSourceFromEnv(serviceUrl, env) });
}
