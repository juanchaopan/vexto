/** The fixed part-of-speech list a lookup result and a vocabulary card use. */
export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'interjection',
  'phrase',
  'phrasal verb',
  'idiom',
] as const;

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

/** Longest Chinese meaning, in characters including punctuation. */
export const MEANING_MAX_LENGTH = 30;

/** Where a target word sits in an example: a UTF-16 range [start, end). */
export type TargetRange = [start: number, end: number];
