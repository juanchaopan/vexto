import { describe, expect, it } from 'vitest';
import { joinPcm16 } from './pcm.ts';

function samples(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

describe('joinPcm16', () => {
  it('writes each sample as signed 16-bit little-endian', () => {
    const bytes = joinPcm16([Float32Array.of(0, 1, -1, 0.5)], 0);

    expect(Array.from(bytes)).toEqual([0, 0, 0xff, 0x7f, 0x01, 0x80, 0xff, 0x3f]);
  });

  it('clips values outside -1 to 1', () => {
    expect(samples(joinPcm16([Float32Array.of(1.5, -3)], 0))).toEqual([32767, -32767]);
  });

  it('puts the silence between the pieces only', () => {
    const joined = samples(joinPcm16([Float32Array.of(0.5), Float32Array.of(0.5, 0.5)], 2));

    expect(joined).toEqual([16383, 0, 0, 16383, 16383]);
  });

  it('gives nothing for no pieces', () => {
    expect(joinPcm16([], 100).byteLength).toBe(0);
  });
});
