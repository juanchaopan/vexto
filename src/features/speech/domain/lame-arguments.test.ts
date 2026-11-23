import { describe, expect, it } from 'vitest';
import { kilohertz, lameArguments } from './lame-arguments.ts';

describe('kilohertz', () => {
  it('writes sample rates the way lame reads them', () => {
    expect(kilohertz(44_100)).toBe('44.1');
    expect(kilohertz(22_050)).toBe('22.05');
    expect(kilohertz(48_000)).toBe('48');
  });
});

describe('lameArguments', () => {
  it('reads raw mono PCM from standard input and writes a 32 kbps mono MP3 to standard output', () => {
    expect(
      lameArguments({
        inputSampleRateHz: 44_100,
        bitrateKbps: 32,
        outputSampleRateHz: 44_100,
        comment: 'AI-generated voice (Supertonic 3)',
      }),
    ).toEqual([
      '-r',
      '-s',
      '44.1',
      '--bitwidth',
      '16',
      '--signed',
      '--little-endian',
      '-m',
      'm',
      '-b',
      '32',
      '--cbr',
      '--resample',
      '44.1',
      '--tc',
      'AI-generated voice (Supertonic 3)',
      '--id3v2-only',
      '--quiet',
      '-',
      '-',
    ]);
  });

  it('keeps the comment one argument whatever it holds', () => {
    const args = lameArguments({
      inputSampleRateHz: 24_000,
      bitrateKbps: 48,
      outputSampleRateHz: 48_000,
      comment: 'a "quoted" comment; rm -rf /',
    });

    expect(args[args.indexOf('--tc') + 1]).toBe('a "quoted" comment; rm -rf /');
    expect(args.slice(1, 3)).toEqual(['-s', '24']);
    expect(args[args.indexOf('--resample') + 1]).toBe('48');
  });
});
