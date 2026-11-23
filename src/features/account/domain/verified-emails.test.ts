import { describe, expect, it } from 'vitest';
import { verifiedEmails } from './verified-emails.ts';

describe('verifiedEmails', () => {
  it('keeps only verified addresses, lower-cased, with the primary first', () => {
    const emails = [
      { id: 'e1', address: 'Old@Example.com', verified: true },
      { id: 'e2', address: 'Ann.Lee@Example.COM', verified: true },
      { id: 'e3', address: 'unconfirmed@example.com', verified: false },
    ];

    expect(verifiedEmails(emails, 'e2')).toEqual(['ann.lee@example.com', 'old@example.com']);
  });

  it('leaves out an unverified primary address', () => {
    const emails = [
      { id: 'e1', address: 'ann@example.com', verified: false },
      { id: 'e2', address: 'bo@example.com', verified: true },
    ];

    expect(verifiedEmails(emails, 'e1')).toEqual(['bo@example.com']);
  });

  it('lists an address once and drops empty ones', () => {
    const emails = [
      { id: 'e1', address: 'ann@example.com', verified: true },
      { id: 'e2', address: ' ANN@example.com ', verified: true },
      { id: 'e3', address: '  ', verified: true },
    ];

    expect(verifiedEmails(emails, null)).toEqual(['ann@example.com']);
  });

  it('gives nothing without verified addresses', () => {
    expect(verifiedEmails([], null)).toEqual([]);
  });
});
