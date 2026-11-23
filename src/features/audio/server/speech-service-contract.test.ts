import { describe, expect, it } from 'vitest';
import { speechAnswerSchema, speechRequestSchema } from './speech-service-contract.ts';

const request = {
  key: 'speech/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3',
  text: 'take off',
  voice: 'F1',
  modelRevision: 'a'.repeat(40),
  encodingVersion: 'mp3-mono-32k-v1',
};

describe('speechRequestSchema', () => {
  it('accepts a request for a speech object and for the smoke object', () => {
    expect(speechRequestSchema.safeParse(request).success).toBe(true);
    expect(speechRequestSchema.safeParse({ ...request, key: 'smoke/check.mp3' }).success).toBe(
      true,
    );
  });

  it('accepts text of exactly 300 characters', () => {
    expect(speechRequestSchema.safeParse({ ...request, text: 'a'.repeat(300) }).success).toBe(true);
  });

  it.each([
    ['an article key', { key: 'articles/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d.mp3' }],
    ['empty text', { text: '' }],
    ['text of 301 characters', { text: 'a'.repeat(301) }],
    ['text that is not normalized', { text: ' take  off' }],
    ['a missing voice', { voice: undefined }],
    ['an extra field', { ownerId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }],
  ])('refuses %s', (_, change) => {
    expect(speechRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
});

describe('speechAnswerSchema', () => {
  it('accepts the answer of a synthesis', () => {
    const answer = { key: request.key, byteSize: 4000, durationMs: 1000, usage: { cpuMs: 900 } };

    expect(speechAnswerSchema.parse(answer)).toEqual(answer);
  });

  it('refuses an answer without its size', () => {
    expect(
      speechAnswerSchema.safeParse({ key: request.key, durationMs: 1, usage: { cpuMs: 1 } })
        .success,
    ).toBe(false);
  });
});
