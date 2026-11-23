// The four options of a Translate question (.docs/design/rules.md, 保存): the card's meaning and
// three wrong ones the AI writes. A wrong option has the card's part of speech, means something
// clearly different, is about as long as the right one and is neither the right meaning nor one of
// its renderings, so exactly one option is right. The order is fixed when the set is made.

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

/** How many wrong options the AI writes for a set. */
export const DISTRACTOR_COUNT = TRANSLATION_OPTION_COUNT - 1;

export type TranslationSet = {
  options: TranslationOption[];
  correctOptionId: string;
};

/** Where a set's randomness comes from: new option IDs and places in the order. */
export type TranslationRandom = {
  id(): string;
  /** A whole number from 0 up to, but not including, `below`. */
  index(below: number): number;
};

/** A meaning as compared: without spaces or punctuation, so `坚韧的。` and `坚韧的` are one. */
function meaningKey(meaning: string): string {
  return meaning.normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');
}

const length = (text: string) => [...text.trim()].length;

/** The renderings of a meaning: the whole of it and each part between semicolons or commas. */
function renderings(meaning: string): Set<string> {
  const parts = meaning.split(/[；;，,、]/u).map(meaningKey);
  return new Set([meaningKey(meaning), ...parts].filter((part) => part !== ''));
}

function aboutAsLong(distractor: string, correct: string): boolean {
  const wrong = length(distractor);
  const right = length(correct);
  return wrong * 3 >= right && wrong <= Math.max(right + 6, right * 2);
}

/**
 * Reasons the wrong options do not make a set with exactly one right option; empty when they do.
 * Each option's own meaning checks (Chinese, at most 30 characters) are the lookup feature's.
 */
export function distractorProblems(correct: string, distractors: readonly string[]): string[] {
  const problems: string[] = [];
  if (distractors.length !== DISTRACTOR_COUNT) {
    problems.push(`there must be exactly ${DISTRACTOR_COUNT} distractors`);
  }
  const right = renderings(correct);
  if (distractors.some((distractor) => right.has(meaningKey(distractor)))) {
    problems.push('a distractor must not be the correct meaning or one of its renderings');
  }
  const keys = distractors.map(meaningKey);
  if (new Set(keys).size !== keys.length) {
    problems.push('the distractors must all differ from each other');
  }
  if (distractors.some((distractor) => !aboutAsLong(distractor, correct))) {
    problems.push('each distractor must be about as long as the correct meaning');
  }
  return problems;
}

/** The set of the right meaning and the wrong ones, each with a new ID, in a random order. */
export function translationSet(
  correct: { pos: string; meaningZh: string },
  distractors: readonly string[],
  random: TranslationRandom,
): TranslationSet {
  const right: TranslationOption = {
    id: random.id(),
    pos: correct.pos,
    meaningZh: correct.meaningZh,
  };
  const options = [
    right,
    ...distractors.map((meaningZh) => ({
      id: random.id(),
      pos: correct.pos,
      meaningZh: meaningZh.trim(),
    })),
  ];
  for (let last = options.length - 1; last > 0; last -= 1) {
    const other = random.index(last + 1);
    [options[last], options[other]] = [options[other], options[last]];
  }
  return { options, correctOptionId: right.id };
}
