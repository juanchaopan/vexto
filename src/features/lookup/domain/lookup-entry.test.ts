import { describe, expect, it } from 'vitest';
import { lemmaKey } from './lookup-entry.ts';

describe('lemmaKey', () => {
  it('lower-cases, trims, joins white space and straightens apostrophes', () => {
    expect(lemmaKey('  Take   Into\tAccount ')).toBe('take into account');
    expect(lemmaKey('Moon’s')).toBe("moon's");
  });

  it('composes characters to NFC', () => {
    expect(lemmaKey('café')).toBe('café');
  });
});
