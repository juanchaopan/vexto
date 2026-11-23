import { describe, expect, it } from 'vitest';
import { hasAcceptedTerms, termsDateText, termsStatus } from './terms.ts';

const acceptedAt = new Date('2026-11-22T09:15:00Z');

describe('termsStatus', () => {
  it('reports the current version and the recorded acceptance', () => {
    expect(termsStatus({ termsVersion: 1, termsAcceptedAt: acceptedAt }, 2)).toEqual({
      currentVersion: 2,
      acceptedVersion: 1,
      acceptedAt,
    });
  });

  it('leaves the acceptance empty before the first one', () => {
    expect(termsStatus({ termsVersion: null, termsAcceptedAt: null }, 1)).toEqual({
      currentVersion: 1,
      acceptedVersion: null,
      acceptedAt: null,
    });
  });
});

describe('hasAcceptedTerms', () => {
  it('is true only for the current version', () => {
    expect(hasAcceptedTerms({ termsVersion: 2, termsAcceptedAt: acceptedAt }, 2)).toBe(true);
    expect(hasAcceptedTerms({ termsVersion: 1, termsAcceptedAt: acceptedAt }, 2)).toBe(false);
    expect(hasAcceptedTerms({ termsVersion: null, termsAcceptedAt: null }, 1)).toBe(false);
  });

  it('needs the acceptance time as well as the version', () => {
    expect(hasAcceptedTerms({ termsVersion: 1, termsAcceptedAt: null }, 1)).toBe(false);
  });
});

describe('termsDateText', () => {
  it('writes the month in full', () => {
    expect(termsDateText('2026-11-22')).toBe('November 22, 2026');
    expect(termsDateText('2027-01-05')).toBe('January 5, 2027');
  });
});
