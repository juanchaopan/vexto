// The questions of the reviews (.docs/design/interfaces.md, 下一题, and .docs/design/rules.md,
// Spell and Translate). A Spell question holds the Chinese meaning, the part of speech and every
// example with the target cut out: the lemma, the accepted forms and the whole examples never
// leave the server, and the example audio is asked for by IDs only. Every form the card accepts
// is hidden wherever it stands in an example, also where the stored target ranges missed it; a
// lookup in the example refuses the same ranges. A Translate question holds the lemma, the part
// of speech, the examples as they are and the four options in their fixed order, without saying
// which one is right.
import type { Executor } from '../../../lib/db/client.ts';
import { spellHiddenRanges } from '../../lookup/index.ts';
import { cardExamples, type CardExampleView } from '../../vocabulary/index.ts';
import { clozeSegments, type ClozeSegment } from '../domain/cloze.ts';
import type { ReviewableMode } from '../domain/schedule.ts';
import {
  modeRound,
  questionCard,
  translationOptions,
  type QuestionCard,
} from './review-queries.ts';

type QuestionHead = { cardId: string; nextRound: number; pos: string };

export type SpellQuestion = QuestionHead & {
  mode: 'spell';
  meaningZh: string;
  examples: { id: string; segments: ClozeSegment[] }[];
};

export type TranslateQuestion = QuestionHead & {
  mode: 'translate';
  lemma: string;
  examples: { id: string; text: string }[];
  options: { id: string; pos: string; meaningZh: string }[];
};

export type Question = SpellQuestion | TranslateQuestion;

function hiddenExample(example: CardExampleView, acceptedForms: readonly string[]) {
  const hidden = spellHiddenRanges(example.text, example.targetRanges, acceptedForms);
  return { id: example.id, segments: clozeSegments(example.text, hidden) };
}

function spellQuestion(
  card: QuestionCard,
  round: number,
  examples: CardExampleView[],
): SpellQuestion {
  return {
    cardId: card.id,
    mode: 'spell',
    nextRound: round + 1,
    pos: card.pos,
    meaningZh: card.meaningZh,
    examples: examples.map((example) => hiddenExample(example, card.acceptedForms)),
  };
}

async function translateQuestion(
  executor: Executor,
  card: QuestionCard,
  round: number,
  examples: CardExampleView[],
): Promise<TranslateQuestion | undefined> {
  const set = await translationOptions(executor, card.id);
  if (!set) {
    return undefined;
  }
  return {
    cardId: card.id,
    mode: 'translate',
    nextRound: round + 1,
    lemma: card.lemma,
    pos: card.pos,
    examples: examples.map((example) => ({ id: example.id, text: example.text })),
    options: set.options.map((option) => ({
      id: option.id,
      pos: option.pos,
      meaningZh: option.meaningZh,
    })),
  };
}

/** The question of the member's card in the mode, or undefined when the card is not there. */
export async function questionOf(
  executor: Executor,
  ownerId: string,
  cardId: string,
  mode: ReviewableMode,
): Promise<Question | undefined> {
  const card = await questionCard(executor, ownerId, cardId);
  const round = await modeRound(executor, ownerId, cardId, mode);
  if (!card || round === undefined) {
    return undefined;
  }
  const examples = await cardExamples(executor, cardId);
  return mode === 'spell'
    ? spellQuestion(card, round, examples)
    : translateQuestion(executor, card, round, examples);
}
