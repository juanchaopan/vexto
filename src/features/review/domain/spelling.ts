// Judging a Spell answer (.docs/design/rules.md, Spell): the answer and every accepted form are
// NFC-normalized, trimmed, their runs of white space made one space and their case ignored, and
// then compared exactly, with no edit distance. Phone keyboards type a curly apostrophe where a
// form has a straight one, so the two count as the same, as they do in the key of a lemma.

/** The longest answer the input and the endpoint take, in UTF-16 code units. */
export const SPELL_ANSWER_MAX_LENGTH = 80;

/** The form of a spelling that answers are compared in. */
export function spellingKey(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().replace(/[‘’ʼ]/gu, "'");
}

/** Whether the answer spells one of the accepted forms. */
export function isAcceptedSpelling(answer: string, acceptedForms: readonly string[]): boolean {
  const key = spellingKey(answer);
  return key !== '' && acceptedForms.some((form) => spellingKey(form) === key);
}
