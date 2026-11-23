import { describe, expect, it } from 'vitest';
import { silenceSamples, timelineOf } from './timeline.ts';

describe('silenceSamples', () => {
  it('turns milliseconds into samples at the sample rate', () => {
    expect(silenceSamples(300, 44_100)).toBe(13_230);
    expect(silenceSamples(0, 44_100)).toBe(0);
  });
});

describe('timelineOf', () => {
  it('lays the pieces one after another with the gap between them', () => {
    expect(timelineOf([44_100, 22_050, 88_200], 44_100, 4410)).toEqual({
      timings: [
        { startMs: 0, endMs: 1000 },
        { startMs: 1100, endMs: 1600 },
        { startMs: 1700, endMs: 3700 },
      ],
      totalSamples: 44_100 + 4410 + 22_050 + 4410 + 88_200,
      durationMs: 3700,
    });
  });

  it('puts no silence before the first piece or after the last', () => {
    const timeline = timelineOf([1000], 1000, 500);

    expect(timeline.timings).toEqual([{ startMs: 0, endMs: 1000 }]);
    expect(timeline.durationMs).toBe(1000);
  });

  it('rounds to whole milliseconds without ever going back', () => {
    const counts = [1, 2, 44, 45, 1, 0, 3, 22_049];
    const { timings, durationMs } = timelineOf(counts, 44_100, 7);

    for (const [index, timing] of timings.entries()) {
      expect(Number.isInteger(timing.startMs) && Number.isInteger(timing.endMs)).toBe(true);
      expect(timing.startMs).toBeLessThanOrEqual(timing.endMs);
      if (index > 0) {
        expect(timing.startMs).toBeGreaterThanOrEqual(timings[index - 1].endMs);
      }
    }
    expect(timings.at(-1)!.endMs).toBeLessThanOrEqual(durationMs);
  });

  it('gives an empty timeline for no pieces', () => {
    expect(timelineOf([], 44_100, 100)).toEqual({ timings: [], totalSamples: 0, durationMs: 0 });
  });
});
