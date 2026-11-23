import { describe, expect, it } from 'vitest';
import {
  acceptedFormsWith,
  exampleOf,
  exampleProblems,
  explanationOf,
  explanationProblems,
  findTargetRanges,
  formProblems,
  meaningProblems,
  type ExplanationDraft,
} from './explanation.ts';

const draft: ExplanationDraft = {
  lemma: 'resilient',
  pos: 'adjective',
  meaningZh: '有韧性的；经得起损耗的',
  examples: [
    'The new coating keeps the camera resilient in harsh desert conditions.',
    'Resilient materials return to their shape after being bent or pressed.',
  ],
  acceptedForms: ['resilient'],
};

describe('findTargetRanges', () => {
  it('finds whole words in any case, in order', () => {
    expect(findTargetRanges('Resilient parts stay resilient.', ['resilient'])).toEqual([
      [0, 9],
      [21, 30],
    ]);
  });

  it('does not match a form inside a longer word', () => {
    expect(findTargetRanges('An unresilient design.', ['resilient'])).toEqual([]);
    expect(findTargetRanges('Adapting adapts.', ['adapt'])).toEqual([]);
  });

  it('matches a phrase across any space and either apostrophe', () => {
    expect(findTargetRanges('They set  off early.', ['set off'])).toEqual([[5, 13]]);
    expect(findTargetRanges('It’s the team’s call.', ["team's"])).toEqual([[9, 15]]);
  });

  it('lets a longer form win over a shorter one at the same place', () => {
    expect(findTargetRanges('They took off at dawn.', ['took', 'took off'])).toEqual([[5, 13]]);
  });

  it('treats the forms as text, not as patterns', () => {
    expect(findTargetRanges('A U.S. firm, not a UXS firm.', ['U.S.'])).toEqual([[2, 6]]);
  });
});

describe('acceptedFormsWith', () => {
  it('puts the lemma first and drops repeats in any case', () => {
    expect(acceptedFormsWith('adapt', ['Adapts', 'adapt', 'adapted', ' adapts '])).toEqual([
      'adapt',
      'Adapts',
      'adapted',
    ]);
  });
});

describe('formProblems', () => {
  it('accepts forms of about the lemma’s length', () => {
    expect(formProblems('set off', ['set off', 'sets off', 'setting off'])).toEqual([]);
  });

  it('refuses forms that are not English word forms or not forms of the lemma', () => {
    expect(formProblems('dust', ['尘土'])).toEqual(['"尘土" is not an English word form']);
    expect(formProblems('dust', ['a layer of fine dust'])).toEqual([
      '"a layer of fine dust" is not a form of the lemma',
    ]);
  });

  it('refuses a lemma that is not an English base form', () => {
    expect(formProblems('灰尘', [])).toHaveLength(1);
    expect(
      formProblems('one two three four five six seven eight nine ten eleven', []),
    ).toHaveLength(1);
  });
});

describe('meaningProblems', () => {
  it('accepts Chinese of at most 30 characters', () => {
    expect(meaningProblems('有韧性的；经得起损耗的')).toEqual([]);
    expect(meaningProblems('一'.repeat(30))).toEqual([]);
  });

  it('refuses a meaning that is not Chinese or is too long', () => {
    expect(meaningProblems('resilient')).toEqual(['meaningZh must be written in Chinese']);
    expect(meaningProblems('一'.repeat(31))).toEqual(['meaningZh must have at most 30 characters']);
  });
});

describe('exampleProblems', () => {
  const forms = ['resilient'];

  it('accepts a sentence of 8 to 20 words with the target', () => {
    expect(exampleProblems(draft.examples[0], forms, [])).toEqual([]);
  });

  it('refuses a sentence with too few or too many words', () => {
    expect(exampleProblems('It is resilient.', forms, [])[0]).toContain('must have 8 to 20 words');
    expect(exampleProblems(`resilient ${'word '.repeat(20)}`, forms, [])[0]).toContain('not 21');
  });

  it('refuses a sentence without the target or with a translation', () => {
    expect(
      exampleProblems('The new coating keeps the camera working in the desert.', forms, []),
    ).toEqual([
      '"The new coating keeps the camera working in the desert." must contain the target word in one of the accepted forms',
    ]);
    expect(
      exampleProblems('The resilient camera kept working in the desert heat. 有韧性的', forms, []),
    ).toHaveLength(1);
  });

  it('refuses a sentence the word already has, in any case or spacing', () => {
    const problems = exampleProblems(` ${draft.examples[0].toUpperCase()} `, forms, [
      draft.examples[0],
    ]);
    expect(problems).toEqual([expect.stringContaining('repeats an example the word already has')]);
  });
});

describe('explanationProblems', () => {
  it('accepts a complete explanation', () => {
    expect(explanationProblems(draft)).toEqual([]);
  });

  it('wants exactly two examples that differ', () => {
    expect(explanationProblems({ ...draft, examples: [draft.examples[0]] })).toContain(
      'there must be exactly 2 examples',
    );
    expect(
      explanationProblems({ ...draft, examples: [draft.examples[0], draft.examples[0]] }),
    ).toEqual([expect.stringContaining('repeats an example')]);
  });

  it('finds the target with the lemma even when the forms leave it out', () => {
    expect(explanationProblems({ ...draft, acceptedForms: [] })).toEqual([]);
  });
});

describe('explanationOf', () => {
  it('tidies the texts, adds the lemma to the forms and finds the targets', () => {
    expect(
      explanationOf({
        ...draft,
        lemma: ' Resilient ',
        meaningZh: ' 有韧性的 ',
        acceptedForms: ['resilient'],
      }),
    ).toEqual({
      lemma: 'Resilient',
      lemmaKey: 'resilient',
      pos: 'adjective',
      meaningZh: '有韧性的',
      acceptedForms: ['Resilient'],
      examples: [
        { text: draft.examples[0], targetRanges: [[33, 42]] },
        { text: draft.examples[1], targetRanges: [[0, 9]] },
      ],
    });
  });
});

describe('exampleOf', () => {
  it('tidies the example and finds its targets', () => {
    expect(exampleOf('  Planes  set off at dawn.', ['set off'])).toEqual({
      text: 'Planes set off at dawn.',
      targetRanges: [[7, 14]],
    });
  });
});
