// The command line of the lame encoder (.docs/design/rules.md, 合成和发布): raw 16-bit
// little-endian mono PCM on standard input at the model's sample rate, a constant-bitrate mono
// MP3 at the configured bitrate and output rate on standard output, and the ID3v2 comment saying
// the voice is machine-generated. Only the ID3v2 tag is written, so the comment is never cut to
// the 28 characters an ID3v1 tag holds. Every value is a separate argument; no shell reads them.

export type Mp3Settings = {
  /** Sample rate of the PCM on standard input. */
  inputSampleRateHz: number;
  bitrateKbps: number;
  /** Sample rate of the MP3. */
  outputSampleRateHz: number;
  /** The ID3 comment. */
  comment: string;
};

/** A sample rate as lame writes it, in kHz: 44100 is `44.1`. */
export function kilohertz(hertz: number): string {
  return String(hertz / 1000);
}

export function lameArguments(settings: Mp3Settings): string[] {
  return [
    '-r',
    '-s',
    kilohertz(settings.inputSampleRateHz),
    '--bitwidth',
    '16',
    '--signed',
    '--little-endian',
    '-m',
    'm',
    '-b',
    String(settings.bitrateKbps),
    '--cbr',
    '--resample',
    kilohertz(settings.outputSampleRateHz),
    '--tc',
    settings.comment,
    '--id3v2-only',
    '--quiet',
    '-',
    '-',
  ];
}
