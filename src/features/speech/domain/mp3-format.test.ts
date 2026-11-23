import { describe, expect, it } from 'vitest';
import { fakeMp3 } from '../testing.ts';
import { commentText, frameHeaderAt, Mp3FormatError, readId3v2, readMp3 } from './mp3-format.ts';

const comment = 'AI-generated voice (Supertonic 3)';

describe('frameHeaderAt', () => {
  it('reads a 32 kbps mono MPEG-1 Layer III frame at 44.1 kHz', () => {
    expect(frameHeaderAt(Uint8Array.of(0xff, 0xfb, 0x10, 0xc0), 0)).toEqual({
      length: 104,
      bitrateKbps: 32,
      sampleRateHz: 44_100,
      samples: 1152,
      channelMode: 'mono',
    });
  });

  it('adds the padding byte and reads MPEG-2 rates', () => {
    // MPEG-2 Layer III, 32 kbps (index 4), 22.05 kHz, padded, joint stereo.
    expect(frameHeaderAt(Uint8Array.of(0xff, 0xf3, 0x42, 0x40), 0)).toEqual({
      length: Math.floor((72_000 * 32) / 22_050) + 1,
      bitrateKbps: 32,
      sampleRateHz: 22_050,
      samples: 576,
      channelMode: 'joint-stereo',
    });
  });

  it.each([
    ['no sync word', [0xfe, 0xfb, 0x10, 0xc0]],
    ['Layer II', [0xff, 0xfd, 0x10, 0xc0]],
    ['the reserved version', [0xff, 0xeb, 0x10, 0xc0]],
    ['a free bitrate', [0xff, 0xfb, 0x00, 0xc0]],
    ['a bad bitrate', [0xff, 0xfb, 0xf0, 0xc0]],
    ['the reserved sample rate', [0xff, 0xfb, 0x1c, 0xc0]],
    ['too few bytes', [0xff, 0xfb, 0x10]],
  ])('finds no frame with %s', (_, bytes) => {
    expect(frameHeaderAt(Uint8Array.from(bytes), 0)).toBeNull();
  });
});

describe('commentText', () => {
  it('reads a latin1 comment after its empty description', () => {
    const frame = Uint8Array.from([0, 0x65, 0x6e, 0x67, 0, ...new TextEncoder().encode('hi')]);

    expect(commentText(frame)).toBe('hi');
  });

  it('reads a UTF-16 comment after its description', () => {
    const utf16 = (text: string) => [
      0xff,
      0xfe,
      ...Array.from(text).flatMap((char) => [char.charCodeAt(0), 0]),
    ];
    const frame = Uint8Array.from([1, 0x65, 0x6e, 0x67, ...utf16('d'), 0, 0, ...utf16('AI')]);

    expect(commentText(frame)).toBe('AI');
  });
});

describe('readId3v2', () => {
  it('finds no tag in a file that starts with a frame', () => {
    expect(readId3v2(Uint8Array.of(0xff, 0xfb, 0x10, 0xc0))).toEqual({ end: 0, comment: null });
  });
});

describe('readMp3', () => {
  it('reads the comment and every frame of the file', () => {
    expect(readMp3(fakeMp3(44_100, comment))).toEqual({
      comment,
      frameCount: 39,
      bitratesKbps: [32],
      sampleRateHz: 44_100,
      channelMode: 'mono',
      durationMs: Math.round((39 * 1152 * 1000) / 44_100),
    });
  });

  it('refuses a file whose frames stop before its end', () => {
    const bytes = fakeMp3(1152, comment);
    const cut = bytes.subarray(0, bytes.length - 1);

    expect(() => readMp3(cut)).toThrow(Mp3FormatError);
  });

  it('refuses a file with no frame', () => {
    expect(() => readMp3(new TextEncoder().encode('not audio'))).toThrow(
      'The file has no MPEG Layer III frame after its tag.',
    );
  });
});
