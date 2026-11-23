// Reads what an MP3 holds without decoding it: the comment of its ID3v2 tag and the MPEG audio
// frames after it. Each frame header gives the frame's length, so walking the frames from the
// first to the end of the file checks that the file is a whole run of valid Layer III frames,
// and gives their bitrate, sample rate, channel mode and duration. The speech checks and the smoke
// test use it to tell that what lame wrote is a playable MP3 with the AI voice comment.

export type ChannelMode = 'stereo' | 'joint-stereo' | 'dual-channel' | 'mono';

export type Mp3Summary = {
  /** The text of the ID3v2 COMM frame, or null when there is none. */
  comment: string | null;
  frameCount: number;
  /** The bitrates the frames use; one for a constant-bitrate file. */
  bitratesKbps: number[];
  sampleRateHz: number;
  channelMode: ChannelMode;
  durationMs: number;
};

export class Mp3FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp3FormatError';
  }
}

type FrameHeader = {
  length: number;
  bitrateKbps: number;
  sampleRateHz: number;
  samples: number;
  channelMode: ChannelMode;
};

const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000];
const CHANNEL_MODES: readonly ChannelMode[] = ['stereo', 'joint-stereo', 'dual-channel', 'mono'];

/** Version bits 11 are MPEG-1, 10 MPEG-2 and 00 MPEG-2.5, which halve and quarter the rates. */
const RATE_DIVISORS: Readonly<Record<number, number>> = { 3: 1, 2: 2, 0: 4 };

/** The fields of a header word that has the sync bits, or null when it is not Layer III. */
function layerThreeFields(byte1: number, byte2: number) {
  const divisor = RATE_DIVISORS[(byte1 >> 3) & 0b11];
  const layer = (byte1 >> 1) & 0b11;
  const bitrateIndex = byte2 >> 4;
  const rateIndex = (byte2 >> 2) & 0b11;
  const valid =
    layer === 0b01 &&
    divisor !== undefined &&
    bitrateIndex > 0 &&
    bitrateIndex < 15 &&
    rateIndex < 3;
  return valid ? { divisor, bitrateIndex, rateIndex, padding: (byte2 >> 1) & 1 } : null;
}

/** The Layer III frame header at `offset`, or null when there is none. */
export function frameHeaderAt(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
    return null;
  }
  const fields = layerThreeFields(bytes[offset + 1], bytes[offset + 2]);
  if (!fields) {
    return null;
  }
  const mpeg1 = fields.divisor === 1;
  const bitrateKbps = (mpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[fields.bitrateIndex];
  const sampleRateHz = MPEG1_SAMPLE_RATES[fields.rateIndex] / fields.divisor;
  const length =
    Math.floor(((mpeg1 ? 144_000 : 72_000) * bitrateKbps) / sampleRateHz) + fields.padding;
  const channelMode = CHANNEL_MODES[bytes[offset + 3] >> 6];
  return { length, bitrateKbps, sampleRateHz, samples: mpeg1 ? 1152 : 576, channelMode };
}

function syncsafe(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3]
  );
}

function bigEndian(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  const label = encoding === 1 || encoding === 2 ? 'utf-16' : encoding === 3 ? 'utf-8' : 'latin1';
  return new TextDecoder(label).decode(bytes).replace(/\0+$/, '');
}

/** The text of a COMM frame: after the encoding, the language and the terminated description. */
export function commentText(frame: Uint8Array): string {
  const encoding = frame[0];
  const wide = encoding === 1 || encoding === 2;
  let index = 4;
  while (index < frame.length && !(frame[index] === 0 && (!wide || frame[index + 1] === 0))) {
    index += wide ? 2 : 1;
  }
  return decodeText(frame.subarray(index + (wide ? 2 : 1)), encoding);
}

type Id3Tag = { end: number; comment: string | null };

/** The ID3v2 tag at the start of the file, with its end and its first comment. */
export function readId3v2(bytes: Uint8Array): Id3Tag {
  if (bytes.length < 10 || new TextDecoder('latin1').decode(bytes.subarray(0, 3)) !== 'ID3') {
    return { end: 0, comment: null };
  }
  const major = bytes[3];
  const end = 10 + syncsafe(bytes, 6);
  let offset = 10;
  while (offset + 10 <= end && bytes[offset] !== 0) {
    const id = new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4));
    const size = major >= 4 ? syncsafe(bytes, offset + 4) : bigEndian(bytes, offset + 4);
    const body = bytes.subarray(offset + 10, offset + 10 + size);
    if (id === 'COMM') {
      return { end, comment: commentText(body) };
    }
    offset += 10 + size;
  }
  return { end, comment: null };
}

/** Reads the tag and every frame; throws Mp3FormatError when the frames do not fill the file. */
export function readMp3(bytes: Uint8Array): Mp3Summary {
  const tag = readId3v2(bytes);
  const frames: FrameHeader[] = [];
  let offset = tag.end;
  for (let header = frameHeaderAt(bytes, offset); header; header = frameHeaderAt(bytes, offset)) {
    frames.push(header);
    offset += header.length;
  }
  if (frames.length === 0) {
    throw new Mp3FormatError('The file has no MPEG Layer III frame after its tag.');
  }
  if (offset !== bytes.length) {
    throw new Mp3FormatError(`The frames end at byte ${offset} of ${bytes.length}.`);
  }
  const [first] = frames;
  const samples = frames.reduce((sum, frame) => sum + frame.samples, 0);
  return {
    comment: tag.comment,
    frameCount: frames.length,
    bitratesKbps: [...new Set(frames.map((frame) => frame.bitrateKbps))],
    sampleRateHz: first.sampleRateHz,
    channelMode: first.channelMode,
    durationMs: Math.round((samples * 1000) / first.sampleRateHz),
  };
}
