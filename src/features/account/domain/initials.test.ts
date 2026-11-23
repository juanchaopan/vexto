import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials.ts';

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Alex Chen', 'alex@example.com')).toBe('AC');
    expect(initialsOf('mary ann van dyke', null)).toBe('MA');
  });

  it('writes one letter for a one-word name', () => {
    expect(initialsOf('  Alex  ', null)).toBe('A');
  });

  it('keeps a letter outside the basic plane whole', () => {
    expect(initialsOf('𝒜lex Chen', null)).toBe('𝒜C');
  });

  it('falls back to the email address without a name', () => {
    expect(initialsOf('', 'bo@example.com')).toBe('B');
    expect(initialsOf(null, undefined)).toBe('');
  });
});
