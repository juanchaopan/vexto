import { describe, expect, it } from 'vitest';
import { licenseBlocks, restrictionsOf } from './license-blocks.ts';
import { MODEL_LICENSE_TEXT } from './model-license.ts';

const sample = [
  'BigScience Open RAIL-M License',
  'dated August 18, 2022',
  '',
  'Section I: PREAMBLE',
  '',
  'This License governs the use of the model',
  'and its derivatives.',
  '1. Definitions',
  '(a) "License" means the terms',
  'and conditions;',
  '',
  'Attachment A',
  '',
  'Use Restrictions',
  '',
  'You agree not to use the Model:',
  '(a) In any way that violates',
  'the law;',
  '(b) To defame others;',
].join('\n');

describe('licenseBlocks', () => {
  it('joins the lines of a paragraph with spaces', () => {
    const blocks = licenseBlocks(sample);

    expect(blocks.map((block) => block.text)).toEqual([
      'BigScience Open RAIL-M License dated August 18, 2022',
      'Section I: PREAMBLE',
      'This License governs the use of the model and its derivatives.',
      '1. Definitions',
      '(a) "License" means the terms and conditions;',
      'Attachment A',
      'Use Restrictions',
      'You agree not to use the Model:',
      '(a) In any way that violates the law;',
      '(b) To defame others;',
    ]);
  });

  it('marks the title, the sections and the attachment as headings', () => {
    const headings = licenseBlocks(sample)
      .filter((block) => block.heading)
      .map((block) => block.text);

    expect(headings).toEqual([
      'BigScience Open RAIL-M License dated August 18, 2022',
      'Section I: PREAMBLE',
      'Attachment A',
      'Use Restrictions',
    ]);
  });

  it('keeps every word of the pinned license', () => {
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    const blocks = licenseBlocks(MODEL_LICENSE_TEXT);

    expect(words(blocks.map((block) => block.text).join(' '))).toEqual(words(MODEL_LICENSE_TEXT));
    expect(blocks.filter((block) => block.heading).map((block) => block.text)).toContain(
      'END OF TERMS AND CONDITIONS',
    );
  });
});

describe('restrictionsOf', () => {
  it('reads the list that follows the opening sentence', () => {
    expect(restrictionsOf(licenseBlocks(sample))).toEqual({
      intro: 'You agree not to use the Model:',
      items: [
        { letter: '(a)', text: 'In any way that violates the law;' },
        { letter: '(b)', text: 'To defame others;' },
      ],
    });
  });

  it('finds the thirteen restrictions (a)–(m) of the pinned license', () => {
    const restrictions = restrictionsOf(licenseBlocks(MODEL_LICENSE_TEXT));

    expect(restrictions.intro).toBe('You agree not to use the Model or Derivatives of the Model:');
    expect(restrictions.items.map((item) => item.letter)).toEqual(
      'abcdefghijklm'.split('').map((letter) => `(${letter})`),
    );
    expect(restrictions.items[5].text).toBe('To defame, disparage or otherwise harass others;');
  });

  it('fails on a text without use restrictions', () => {
    expect(() => restrictionsOf(licenseBlocks('Section I: PREAMBLE'))).toThrow(
      /no use restrictions/,
    );
  });
});
