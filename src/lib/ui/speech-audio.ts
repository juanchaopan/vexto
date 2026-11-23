// Word and example audio (.docs/design/screens.md, 读音): a tap on Play word or Play example asks
// `POST /api/media/playback` for the audio, which the server may first have to make, then plays
// it. While the request runs, the tapped button spins; when it fails, the failure shows with Retry
// when another try can help. The request goes through the query client, so a session that ended
// is handled like on every other request. One audio element plays every word and example; it
// takes the audio focus before it plays, which pauses the article, and gives the focus up when it
// ends, so the article stays paused (.docs/design/rules.md, 文章列表、搜索和播放).
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import {
  apiRequest,
  ApiRequestError,
  dataBody,
  offersRetry,
  type ClientErrorCode,
} from '../api/client.ts';
import { releaseAudioFocus, takeAudioFocus, type AudioHolder } from './audio-focus.ts';

/** What a word or example audio request names, as `POST /api/media/playback` takes it. */
export type SpeechLocator =
  | { kind: 'lookup-word'; lookupId: string }
  | { kind: 'lookup-example'; lookupId: string; exampleId: string }
  | { kind: 'card-word'; cardId: string }
  | { kind: 'card-example'; cardId: string; exampleId: string };

export type SpeechElement = Pick<
  HTMLAudioElement,
  'src' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'
>;

const playbackSchema = dataBody(z.object({ url: z.string() }));

let createElement: () => SpeechElement = () => new Audio();
let element: SpeechElement | null = null;
let unlocked = false;

const holder: AudioHolder = {
  pause() {
    element?.pause();
  },
};

function speechElement(): SpeechElement {
  if (!element) {
    element = createElement();
    element.addEventListener('ended', () => releaseAudioFocus(holder));
  }
  return element;
}

/**
 * Lets the browser play later what the tap asked for: some browsers start audio only from inside
 * the tap's own handler, so the element is started and paused there once, before anything waits.
 */
function unlock(): void {
  const target = speechElement();
  if (!unlocked) {
    unlocked = true;
    target.play().catch(() => undefined);
    target.pause();
  }
}

async function fetchAndPlay(queryClient: QueryClient, locator: SpeechLocator): Promise<void> {
  const { url } = await queryClient.fetchQuery({
    queryKey: ['playback', 'speech', locator],
    queryFn: async ({ signal }) =>
      (
        await apiRequest('/api/media/playback', playbackSchema, {
          method: 'POST',
          body: locator,
          signal,
        })
      ).data,
    staleTime: 0,
    gcTime: 0,
  });
  const target = speechElement();
  takeAudioFocus(holder);
  target.src = url;
  try {
    await target.play();
  } catch (error) {
    releaseAudioFocus(holder);
    throw error;
  }
}

/** Stops the word or example audio, as logging out does. */
export function stopSpeech(): void {
  element?.pause();
  releaseAudioFocus(holder);
}

/** Gives the audio a stand-in element, for tests; the next play makes it. */
export function setSpeechElementFactory(factory: () => SpeechElement): void {
  createElement = factory;
  element = null;
  unlocked = false;
}

export type SpeechFailure = {
  key: string;
  locator: SpeechLocator;
  /** The interface's error code, or null when the audio itself would not play. */
  code: ClientErrorCode | null;
  retryable: boolean;
};

export type Speech = {
  /** The key of the button whose audio is being fetched or made, or null. */
  pending: string | null;
  /** The last request that failed, or null. */
  failure: SpeechFailure | null;
  /** Plays the audio of a button; call it right in the tap's handler. */
  play(key: string, locator: SpeechLocator): void;
  /** Sends the failed request again. */
  retry(): void;
};

/** The audio state of a group of play buttons that share one failure row, such as a lookup's. */
export function useSpeech(): Speech {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<SpeechFailure | null>(null);

  const play = useCallback(
    (key: string, locator: SpeechLocator) => {
      unlock();
      setPending(key);
      setFailure(null);
      fetchAndPlay(queryClient, locator).then(
        () => setPending(null),
        (error: unknown) => {
          setPending(null);
          setFailure({
            key,
            locator,
            code: error instanceof ApiRequestError ? error.code : null,
            retryable: !(error instanceof ApiRequestError) || offersRetry(error),
          });
        },
      );
    },
    [queryClient],
  );

  const retry = useCallback(() => {
    if (failure) {
      play(failure.key, failure.locator);
    }
  }, [failure, play]);

  return { pending, failure, play, retry };
}
