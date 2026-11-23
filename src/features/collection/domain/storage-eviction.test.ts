import { describe, expect, it } from 'vitest';
import {
  bytesOverTarget,
  estimatedArticleBytes,
  evictionCount,
  needsEviction,
} from './storage-eviction.ts';

const cap = { capBytes: 1000, evictAtRatio: 0.95, evictToRatio: 0.9 };

describe('estimatedArticleBytes', () => {
  it('is the reading time and the silences between sentences at the bitrate', () => {
    // 150 words at 150 a minute is 60 s; 9 gaps of 300 ms add 2.7 s; 32 kbps is 4 bytes a ms.
    expect(
      estimatedArticleBytes(
        { wordCount: 150, sentenceCount: 10 },
        { wordsPerMinute: 150, bitrateKbps: 32, sentenceGapMs: 300 },
      ),
    ).toBe((60_000 + 2700) * 4);
  });

  it('adds no silence for a single sentence', () => {
    expect(
      estimatedArticleBytes(
        { wordCount: 15, sentenceCount: 1 },
        { wordsPerMinute: 150, bitrateKbps: 32, sentenceGapMs: 300 },
      ),
    ).toBe(24_000);
  });
});

describe('needsEviction', () => {
  it('starts once the stored audio has reached the eviction ratio', () => {
    expect(needsEviction(950, 0, cap)).toBe(true);
    expect(needsEviction(949, 0, cap)).toBe(false);
  });

  it('starts when the incoming article would pass the eviction ratio', () => {
    expect(needsEviction(900, 51, cap)).toBe(true);
    expect(needsEviction(900, 50, cap)).toBe(false);
  });
});

describe('bytesOverTarget', () => {
  it('counts the incoming article against the target ratio', () => {
    expect(bytesOverTarget(960, 30, cap)).toBe(90);
    expect(bytesOverTarget(850, 30, cap)).toBe(-20);
  });
});

describe('evictionCount', () => {
  it('takes the oldest audio until more than the excess is freed', () => {
    expect(evictionCount([40, 40, 40, 40], 90)).toBe(3);
    expect(evictionCount([40, 40, 40, 40], 80)).toBe(3);
    expect(evictionCount([40, 40, 40, 40], 79)).toBe(2);
  });

  it('takes one audio when the stored audio sits exactly on the target', () => {
    expect(evictionCount([40, 40], 0)).toBe(1);
  });

  it('takes nothing when nothing is over the target', () => {
    expect(evictionCount([40, 40], -1)).toBe(0);
  });

  it('takes the whole batch when it is not enough', () => {
    expect(evictionCount([40, 40], 500)).toBe(2);
    expect(evictionCount([], 500)).toBe(0);
  });
});
