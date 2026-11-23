import { describe, expect, it } from 'vitest';
import { PLAYBACK_URL_SECONDS, playbackExpiry } from './playback.ts';

describe('playbackExpiry', () => {
  it('is ten minutes after the address was signed', () => {
    expect(PLAYBACK_URL_SECONDS).toBe(600);
    expect(playbackExpiry(new Date('2026-11-22T10:00:00.250Z'))).toBe('2026-11-22T10:10:00.250Z');
  });
});
