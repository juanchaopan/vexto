/** Only `ready` articles appear in the list and the reader. */
export const ARTICLE_STATES = ['preparing', 'ready', 'failed'] as const;

export type ArticleState = (typeof ARTICLE_STATES)[number];

/**
 * Why the last synthesis of an article failed: the model failed (`tts_error`), lame failed
 * (`encode_error`), writing the bucket failed (`upload_error`), or the previous run stopped in
 * the middle of the synthesis (`interrupted`).
 */
export const SYNTHESIS_ERROR_CODES = [
  'tts_error',
  'encode_error',
  'upload_error',
  'interrupted',
] as const;

export type SynthesisErrorCode = (typeof SYNTHESIS_ERROR_CODES)[number];

/** Synthesis attempts an article gets before it is marked `failed`. */
export const MAX_SYNTHESIS_ATTEMPTS = 5;
