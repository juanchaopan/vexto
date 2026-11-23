import { describe, expect, it } from 'vitest';
import { distractorProblems, translationSet, type TranslationRandom } from './translation-set.ts';

const CORRECT = '有韧性的；经得起损耗的';

describe('distractorProblems', () => {
  it('accepts three different wrong meanings of about the same length', () => {
    expect(distractorProblems(CORRECT, ['迅速消失的', '令人厌烦的', '非常昂贵的'])).toEqual([]);
  });

  it('wants exactly three', () => {
    expect(distractorProblems(CORRECT, ['迅速消失的', '令人厌烦的'])).toEqual([
      'there must be exactly 3 distractors',
    ]);
  });

  it('refuses the correct meaning or one of its renderings, punctuation and spaces aside', () => {
    const problem = 'a distractor must not be the correct meaning or one of its renderings';
    expect(distractorProblems(CORRECT, ['经得起损耗的。', '令人厌烦的', '非常昂贵的'])).toContain(
      problem,
    );
    expect(distractorProblems(CORRECT, ['有 韧性的', '令人厌烦的', '非常昂贵的'])).toContain(
      problem,
    );
  });

  it('refuses two options that are the same', () => {
    expect(distractorProblems(CORRECT, ['令人厌烦的', '令人厌烦的！', '非常昂贵的'])).toEqual([
      'the distractors must all differ from each other',
    ]);
  });

  it('refuses an option much shorter or much longer than the correct meaning', () => {
    const problem = 'each distractor must be about as long as the correct meaning';
    expect(distractorProblems(CORRECT, ['冷', '令人厌烦的', '非常昂贵的'])).toContain(problem);
    expect(distractorProblems('出发', ['在很远的地方慢慢地停下来', '回来', '离开'])).toContain(
      problem,
    );
  });
});

/** Randomness that numbers the IDs and always picks the given places. */
function fixedRandom(places: number[]): TranslationRandom {
  let next = 0;
  return { id: () => `id-${(next += 1)}`, index: () => places.shift() ?? 0 };
}

describe('translationSet', () => {
  it('gives every option a new ID and the card’s part of speech, and marks the right one', () => {
    const set = translationSet(
      { pos: 'adjective', meaningZh: CORRECT },
      [' 迅速消失的 ', '令人厌烦的', '非常昂贵的'],
      fixedRandom([3, 2, 1]),
    );

    expect(set.options).toEqual([
      { id: 'id-1', pos: 'adjective', meaningZh: CORRECT },
      { id: 'id-2', pos: 'adjective', meaningZh: '迅速消失的' },
      { id: 'id-3', pos: 'adjective', meaningZh: '令人厌烦的' },
      { id: 'id-4', pos: 'adjective', meaningZh: '非常昂贵的' },
    ]);
    expect(set.correctOptionId).toBe('id-1');
  });

  it('shuffles the options with the places the randomness picks', () => {
    const set = translationSet(
      { pos: 'noun', meaningZh: '观点' },
      ['桌子', '天气', '道路'],
      fixedRandom([0, 0, 0]),
    );

    expect(set.options.map((option) => option.meaningZh)).toEqual(['桌子', '天气', '道路', '观点']);
    expect(set.options.find((option) => option.id === set.correctOptionId)?.meaningZh).toBe('观点');
  });
});
