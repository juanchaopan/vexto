import { describe, expect, it } from 'vitest';
import { canonicalJson, requestDigest, sha256Hex } from './digest.ts';

describe('sha256Hex', () => {
  it('hashes the UTF-8 text into lower-case hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('韧性')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalJson', () => {
  it('sorts the keys of every object, however deep', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}',
    );
  });

  it('leaves out undefined fields and writes dates as ISO strings', () => {
    expect(canonicalJson({ a: undefined, at: new Date('2026-11-22T10:00:00Z') })).toBe(
      '{"at":"2026-11-22T10:00:00.000Z"}',
    );
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('requestDigest', () => {
  it('is the same for the same content in any field order and differs for other content', () => {
    const digest = requestDigest({ cardId: 'c1', answer: { text: 'resilient' } });

    expect(requestDigest({ answer: { text: 'resilient' }, cardId: 'c1' })).toBe(digest);
    expect(requestDigest({ cardId: 'c1', answer: { text: 'resilience' } })).not.toBe(digest);
  });
});
