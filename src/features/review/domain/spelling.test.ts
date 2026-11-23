// Judging Spell answers (.docs/design/rules.md, Spell): NFC, trimmed, one space for any run of
// white space, any case, then an exact match with one of the accepted forms; no edit distance.
import { describe, expect, it } from 'vitest';
import { isAcceptedSpelling, spellingKey } from './spelling.ts';

const forms = ['resilient', 'give up', "don't"];

describe('Spell answers', () => {
  it('accept an accepted form in any case, with spaces around it', () => {
    expect(isAcceptedSpelling('resilient', forms)).toBe(true);
    expect(isAcceptedSpelling('  RESILIENT ', forms)).toBe(true);
    expect(isAcceptedSpelling('Resilient', ['resilient'])).toBe(true);
  });

  it('take any run of white space between words as one space', () => {
    expect(isAcceptedSpelling('give   up', forms)).toBe(true);
    expect(isAcceptedSpelling('give\tup', forms)).toBe(true);
    expect(isAcceptedSpelling('giveup', forms)).toBe(false);
  });

  it('compare after NFC normalization', () => {
    expect(isAcceptedSpelling('café', ['café'])).toBe(true);
  });

  it('take a curly apostrophe for a straight one', () => {
    expect(isAcceptedSpelling('don’t', forms)).toBe(true);
  });

  it('refuse a near miss, a part of a form and an empty answer', () => {
    expect(isAcceptedSpelling('resiliant', forms)).toBe(false);
    expect(isAcceptedSpelling('resilien', forms)).toBe(false);
    expect(isAcceptedSpelling('   ', forms)).toBe(false);
  });

  it('write the key in one form', () => {
    expect(spellingKey('  Give \n Up ')).toBe('give up');
  });
});
