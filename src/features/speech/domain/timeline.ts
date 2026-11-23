// The timeline of an audio made of pieces laid one after another (.docs/design/rules.md, 合成和发布):
// the model gives no timestamps, so each sentence's place in the article's audio follows from the
// number of samples of the sentences before it and the silence between them. Times are whole
// milliseconds, rounded from the sample positions, so they never go back.

/** Where one piece lies in the audio, in milliseconds. */
export type PieceTiming = { startMs: number; endMs: number };

export type Timeline = {
  timings: PieceTiming[];
  /** Samples of the whole audio, silences included. */
  totalSamples: number;
  durationMs: number;
};

/** Samples of silence that last `milliseconds` at this sample rate. */
export function silenceSamples(milliseconds: number, sampleRate: number): number {
  return Math.round((milliseconds * sampleRate) / 1000);
}

function toMs(samples: number, sampleRate: number) {
  return Math.round((samples * 1000) / sampleRate);
}

/**
 * The timeline of pieces of `sampleCounts` samples each, with `gapSamples` of silence between two
 * pieces and none before the first or after the last.
 */
export function timelineOf(
  sampleCounts: readonly number[],
  sampleRate: number,
  gapSamples: number,
): Timeline {
  const timings: PieceTiming[] = [];
  let position = 0;
  sampleCounts.forEach((count, index) => {
    if (index > 0) {
      position += gapSamples;
    }
    timings.push({
      startMs: toMs(position, sampleRate),
      endMs: toMs(position + count, sampleRate),
    });
    position += count;
  });
  return { timings, totalSamples: position, durationMs: toMs(position, sampleRate) };
}
