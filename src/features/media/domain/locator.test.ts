import { describe, expect, it } from 'vitest';
import { speechUsageKindOf } from './locator.ts';

describe('speechUsageKindOf', () => {
  it('records the speech of words and of examples as their own kinds', () => {
    expect(speechUsageKindOf('lookup-word')).toBe('word_tts');
    expect(speechUsageKindOf('card-word')).toBe('word_tts');
    expect(speechUsageKindOf('lookup-example')).toBe('example_tts');
    expect(speechUsageKindOf('card-example')).toBe('example_tts');
  });
});
