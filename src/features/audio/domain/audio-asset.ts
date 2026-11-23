// Audio rows and their objects (.docs/design/rules.md, 朗读和存储上限; .docs/design/data.md, 音频).

/**
 * States of an audio row: `pending` waits for synthesis, `ready` can be played, and `retiring`
 * has its object being deleted from the bucket.
 */
export const AUDIO_STATES = ['pending', 'ready', 'retiring'] as const;

export type AudioState = (typeof AUDIO_STATES)[number];

/** MIME type of every audio object. */
export const AUDIO_CONTENT_TYPE = 'audio/mpeg';

/** Where the smoke test after a deployment has the speech service write; it has no row. */
export const SMOKE_OBJECT_KEY = 'smoke/check.mp3';

/** Longest word or example text the speech service reads, in UTF-16 code units. */
export const SPEECH_TEXT_MAX_LENGTH = 300;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SPEECH_OBJECT_KEY = new RegExp(`^speech/${UUID}\\.mp3$`);

/** The object of a word or example audio row: `speech/<audio ID>.mp3`. */
export function speechObjectKey(audioId: string): string {
  return `speech/${audioId}.mp3`;
}

/** The object of an article's audio row: `articles/<audio ID>.mp3`. */
export function articleAudioObjectKey(audioId: string): string {
  return `articles/${audioId}.mp3`;
}

/** The keys the speech service may write: a word or example object, or the smoke test's. */
export function isSpeechServiceKey(key: string): boolean {
  return key === SMOKE_OBJECT_KEY || SPEECH_OBJECT_KEY.test(key);
}

/**
 * The text a word or example is read from: NFC, without spaces at either end, every run of
 * white space made one space, letter case kept.
 */
export function normalizeSpeechText(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}
