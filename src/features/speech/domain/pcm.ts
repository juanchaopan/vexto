// Raw audio the MP3 encoder reads: signed 16-bit little-endian PCM, one channel. The model's
// samples lie between -1 and 1; values outside are clipped, as the original Supertonic program
// does when it writes WAV files.

/** Bytes per sample of 16-bit PCM. */
export const PCM_BYTES_PER_SAMPLE = 2;

/**
 * Joins the pieces into one 16-bit PCM buffer, with `gapSamples` of silence between two pieces
 * and none before the first or after the last.
 */
export function joinPcm16(pieces: readonly Float32Array[], gapSamples: number): Uint8Array {
  const gaps = Math.max(0, pieces.length - 1) * gapSamples;
  const total = pieces.reduce((sum, piece) => sum + piece.length, gaps);
  const bytes = new Uint8Array(total * PCM_BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  let sample = 0;
  pieces.forEach((piece, index) => {
    if (index > 0) {
      sample += gapSamples;
    }
    for (const value of piece) {
      const clipped = Math.max(-1, Math.min(1, value));
      view.setInt16(sample * PCM_BYTES_PER_SAMPLE, Math.floor(clipped * 32767), true);
      sample += 1;
    }
  });
  return bytes;
}
