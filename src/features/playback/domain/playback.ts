// Playback addresses (.docs/design/rules.md, 朗读和存储上限): presigned, valid for ten minutes,
// requested again by the client once they expire.

/** How long a playback address works. */
export const PLAYBACK_URL_SECONDS = 600;

/** The kinds of usage record of word and example speech. */
export type SpeechUsageKind = 'word_tts' | 'example_tts';

/** An audio object that can be played, with its length. */
export type PlayableAudio = { objectKey: string; durationMs: number };

/** What the playback endpoint answers. */
export type Playback = { url: string; expiresAt: string; durationMs: number };

/** When an address signed at `signedAt` stops working, as the answer states it. */
export function playbackExpiry(signedAt: Date): string {
  return new Date(signedAt.getTime() + PLAYBACK_URL_SECONDS * 1000).toISOString();
}
