import { describe, expect, it } from 'vitest';
import committedModel from '../../../config/speech-model.json' with { type: 'json' };
import committed from '../../../config/speech.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';
import { parseSpeechConfig, speechConfig, speechVersionOf } from './speech-config.ts';

function problems(speech: unknown, model: unknown = committedModel) {
  try {
    parseSpeechConfig(speech, model);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

describe('speechConfig', () => {
  it('reads the committed voice, settings and pinned model', () => {
    expect(speechConfig).toMatchObject({
      provider: 'supertonic',
      model: committedModel.name,
      modelRevision: committedModel.revision,
      voice: committed.voice,
      encoding: { version: committed.encoding.version, bitrateKbps: 32, sampleRateHz: 44100 },
    });
  });

  it('gives the version an audio row records', () => {
    expect(speechVersionOf(speechConfig)).toEqual({
      voice: committed.voice,
      modelRevision: committedModel.revision,
      encoding: committed.encoding.version,
    });
  });
});

describe('parseSpeechConfig', () => {
  it('refuses a bitrate lame does not write', () => {
    expect(
      problems({ ...committed, encoding: { ...committed.encoding, bitrateKbps: 33 } }),
    ).toMatch(/config\/speech\.json is invalid: encoding\.bitrateKbps/);
  });

  it('refuses a voice name that could leave the voice style directory', () => {
    expect(problems({ ...committed, voice: '../F1' })).toContain('voice');
  });

  it('refuses unknown fields', () => {
    expect(problems({ ...committed, extra: true })).toContain('config/speech.json');
  });

  it('refuses a model revision that is not a full commit', () => {
    expect(problems(committed, { ...committedModel, revision: 'main' })).toMatch(
      /config\/speech-model\.json is invalid: revision/,
    );
  });
});
