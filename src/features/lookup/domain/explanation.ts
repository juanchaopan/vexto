// What makes the model's explanation acceptable (.docs/design/rules.md, 输出), once its shape has
// passed the server's schema: the lemma, the Chinese meaning, two new English examples in which
// the target can be found by one of the accepted forms, and forms a learner may spell. The model
// never gives positions: the target ranges are found here, by whole-word matches of the accepted
// forms that ignore case. Each check gives the reason in English, so an answer that fails can be
// sent back to the model to be done again.
import { lemmaKey, MEANING_MAX_LENGTH, type TargetRange } from './lookup-entry.ts';
import { countWords, SELECTION_MAX_CHARACTERS, SELECTION_MAX_WORDS } from './selection.ts';

export const EXAMPLE_COUNT = 2;
export const EXAMPLE_MIN_WORDS = 8;
export const EXAMPLE_MAX_WORDS = 20;

/** The longest lemma or accepted form, a little over what a selection may hold. */
const FORM_MAX_WORDS = SELECTION_MAX_WORDS + 2;
const FORM_MAX_CHARACTERS = SELECTION_MAX_CHARACTERS + 20;
const EXAMPLE_MAX_CHARACTERS = 300;

const HAN = /\p{Script=Han}/u;
/** English words: Latin letters and digits, with spaces, apostrophes, full stops and hyphens. */
const FORM_CHARACTERS = /^[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N} '’.-]*$/u;

/** The explanation as the model gave it, after its shape was checked. */
export type ExplanationDraft = {
  lemma: string;
  pos: string;
  meaningZh: string;
  examples: readonly string[];
  acceptedForms: readonly string[];
};

export type Example = { text: string; targetRanges: TargetRange[] };

/** The explanation the server keeps: tidied texts, the forms with the lemma, found targets. */
export type Explanation = {
  lemma: string;
  lemmaKey: string;
  pos: string;
  meaningZh: string;
  acceptedForms: string[];
  examples: Example[];
};

function tidy(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole-word, case-insensitive pattern of a form, with any space and either apostrophe. */
function formPattern(form: string): RegExp {
  const body = form
    .split(' ')
    .map((word) => escapeRegExp(word).replace(/['’]/gu, "['’]"))
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Where the forms appear in the text, as whole words in any case, in order. A longer form wins
 * over a shorter one at the same place, and the ranges never overlap.
 */
export function findTargetRanges(text: string, forms: readonly string[]): TargetRange[] {
  const ranges: TargetRange[] = [];
  const longestFirst = [...forms].sort((a, b) => b.length - a.length);
  for (const form of longestFirst) {
    for (const match of text.matchAll(formPattern(form))) {
      const range: TargetRange = [match.index, match.index + match[0].length];
      if (!ranges.some(([start, end]) => range[0] < end && start < range[1])) {
        ranges.push(range);
      }
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** The forms tidied, without repeats in any case, the lemma first. */
export function acceptedFormsWith(lemma: string, forms: readonly string[]): string[] {
  const kept: string[] = [];
  for (const form of [lemma, ...forms].map(tidy)) {
    if (form !== '' && !kept.some((other) => lemmaKey(other) === lemmaKey(form))) {
      kept.push(form);
    }
  }
  return kept;
}

function formProblem(form: string, lemmaWords: number): string | null {
  if (!FORM_CHARACTERS.test(form) || [...form].length > FORM_MAX_CHARACTERS) {
    return `"${form}" is not an English word form`;
  }
  const words = countWords(form);
  if (words === 0 || words > FORM_MAX_WORDS || Math.abs(words - lemmaWords) > 1) {
    return `"${form}" is not a form of the lemma`;
  }
  return null;
}

/** Reasons the lemma and its forms are not acceptable; empty when they are. */
export function formProblems(lemma: string, forms: readonly string[]): string[] {
  const tidied = tidy(lemma);
  const lemmaWords = countWords(tidied);
  if (lemmaWords === 0 || lemmaWords > FORM_MAX_WORDS || !FORM_CHARACTERS.test(tidied)) {
    return ['the lemma must be the English base form of the selection'];
  }
  return forms
    .map((form) => formProblem(form, lemmaWords))
    .filter((problem): problem is string => problem !== null);
}

/** Reasons the Chinese meaning is not acceptable; empty when it is. */
export function meaningProblems(meaningZh: string): string[] {
  const meaning = tidy(meaningZh);
  const problems: string[] = [];
  if (!HAN.test(meaning)) {
    problems.push('meaningZh must be written in Chinese');
  }
  if ([...meaning].length > MEANING_MAX_LENGTH) {
    problems.push(`meaningZh must have at most ${MEANING_MAX_LENGTH} characters`);
  }
  return problems;
}

/**
 * Reasons an example is not acceptable, given the accepted forms and the examples it must differ
 * from; empty when it is acceptable.
 */
export function exampleProblems(
  text: string,
  forms: readonly string[],
  others: readonly string[],
): string[] {
  const example = tidy(text);
  const problems: string[] = [];
  const words = countWords(example);
  if (words < EXAMPLE_MIN_WORDS || words > EXAMPLE_MAX_WORDS) {
    problems.push(
      `"${example}" must have ${EXAMPLE_MIN_WORDS} to ${EXAMPLE_MAX_WORDS} words, not ${words}`,
    );
  }
  if (HAN.test(example) || example.length > EXAMPLE_MAX_CHARACTERS) {
    problems.push(`"${example}" must be one English sentence without a translation`);
  }
  if (findTargetRanges(example, forms).length === 0) {
    problems.push(`"${example}" must contain the target word in one of the accepted forms`);
  }
  if (others.some((other) => tidy(other).toLowerCase() === example.toLowerCase())) {
    problems.push(`"${example}" repeats an example the word already has`);
  }
  return problems;
}

/** Reasons the whole explanation is not acceptable; empty when it is. */
export function explanationProblems(draft: ExplanationDraft): string[] {
  const forms = acceptedFormsWith(draft.lemma, draft.acceptedForms);
  const problems = [...formProblems(draft.lemma, forms), ...meaningProblems(draft.meaningZh)];
  if (draft.examples.length !== EXAMPLE_COUNT) {
    problems.push(`there must be exactly ${EXAMPLE_COUNT} examples`);
  }
  draft.examples.forEach((example, index) => {
    problems.push(...exampleProblems(example, forms, draft.examples.slice(0, index)));
  });
  return problems;
}

/** An acceptable example with its target ranges. */
export function exampleOf(text: string, forms: readonly string[]): Example {
  const example = tidy(text);
  return { text: example, targetRanges: findTargetRanges(example, forms) };
}

/** The explanation to keep, from a draft with no problems (see explanationProblems). */
export function explanationOf(draft: ExplanationDraft): Explanation {
  const lemma = tidy(draft.lemma);
  const acceptedForms = acceptedFormsWith(lemma, draft.acceptedForms);
  return {
    lemma,
    lemmaKey: lemmaKey(lemma),
    pos: draft.pos,
    meaningZh: tidy(draft.meaningZh),
    acceptedForms,
    examples: draft.examples.map((example) => exampleOf(example, acceptedForms)),
  };
}
