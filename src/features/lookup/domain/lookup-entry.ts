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

/**
 * The key cards of the same lemma are found by (.docs/design/rules.md, 输出): the lemma in NFC,
 * lower case, without spaces at its ends, runs of white space made one space and curly
 * apostrophes made straight.
 */
export function lemmaKey(lemma: string): string {
  return lemma.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ').replace(/’/gu, "'");
}
