/**
 * One of the four Translate options; `id` is a random UUID made when the set is generated and
 * `pos` is one of the lookup feature's parts of speech.
 */
export type TranslationOption = {
  id: string;
  pos: string;
  meaningZh: string;
};

/** A Translate question always offers this many options, exactly one of them correct. */
export const TRANSLATION_OPTION_COUNT = 4;
