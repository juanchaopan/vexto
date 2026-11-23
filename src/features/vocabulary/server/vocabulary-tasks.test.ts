import { describe, expect, it } from 'vitest';
import { meaningMatchTask, translationTask } from './vocabulary-tasks.ts';

const meaning = {
  meaningZh: '有韧性的；经得起损耗的',
  examples: ['The new coating keeps the camera resilient in harsh desert conditions.'],
};

describe('meaningMatchTask', () => {
  const task = meaningMatchTask({
    ownerId: 'owner',
    lookupId: 'lookup',
    lemma: 'resilient',
    pos: 'adjective',
    meaning,
    savedMeanings: [meaning, { meaningZh: '能迅速恢复的', examples: [] }],
  });

  it('records the call as meaning_match for the lookup', () => {
    expect(task.usage).toEqual({
      kind: 'meaning_match',
      ownerId: 'owner',
      resourceType: 'lookup',
      resourceId: 'lookup',
    });
    expect(task.format.name).toBe('meaning_match');
  });

  it('sends the words as numbered data and keeps them out of the instructions', () => {
    expect(JSON.parse(task.input)).toEqual({
      word: { lemma: 'resilient', pos: 'adjective', ...meaning },
      savedMeanings: [
        { number: 1, ...meaning },
        { number: 2, meaningZh: '能迅速恢复的', examples: [] },
      ],
    });
    expect(task.instructions).not.toContain('能迅速恢复的');
  });

  it('accepts 0 and the number of a saved meaning', () => {
    expect(task.check({ sameMeaning: 0 })).toEqual({ ok: true, value: 0 });
    expect(task.check({ sameMeaning: 2 })).toEqual({ ok: true, value: 2 });
  });

  it('refuses a number that names no saved meaning, and any other shape', () => {
    expect(task.check({ sameMeaning: 3 })).toEqual({
      ok: false,
      problems: ['sameMeaning must be 0 or the number of a saved meaning, from 1 to 2'],
    });
    expect(task.check({ sameMeaning: -1 }).ok).toBe(false);
    expect(task.check({ sameMeaning: 1, why: 'same' }).ok).toBe(false);
    expect(task.check({ sameMeaning: 1.5 }).ok).toBe(false);
    expect(task.check(undefined).ok).toBe(false);
  });
});

describe('translationTask', () => {
  const task = translationTask({
    ownerId: 'owner',
    resource: { type: 'card', id: 'card' },
    lemma: 'resilient',
    pos: 'adjective',
    meaning,
  });

  it('records the call as translation for the card it is made for', () => {
    expect(task.usage).toEqual({
      kind: 'translation',
      ownerId: 'owner',
      resourceType: 'card',
      resourceId: 'card',
    });
    expect(task.format.name).toBe('translation_options');
  });

  it('accepts three good wrong meanings, trimmed', () => {
    expect(task.check({ distractors: [' 迅速消失的', '令人厌烦的', '非常昂贵的 '] })).toEqual({
      ok: true,
      value: ['迅速消失的', '令人厌烦的', '非常昂贵的'],
    });
  });

  it('refuses meanings that are not Chinese, the right one, or too few', () => {
    const verdict = task.check({ distractors: ['quickly gone', '有韧性的'] });
    expect(verdict).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        'meaningZh must be written in Chinese',
        'there must be exactly 3 distractors',
        'a distractor must not be the correct meaning or one of its renderings',
      ]),
    });
  });

  it('refuses any other shape', () => {
    expect(task.check({ distractors: ['迅速消失的'], options: [] }).ok).toBe(false);
    expect(task.check({ distractors: 'all wrong' }).ok).toBe(false);
  });
});
