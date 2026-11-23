import { describe, expect, it } from 'vitest';
import {
  articleAudioObjectKey,
  isSpeechServiceKey,
  normalizeSpeechText,
  SMOKE_OBJECT_KEY,
  speechObjectKey,
} from './audio-asset.ts';

const id = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

describe('object keys', () => {
  it('name the object after the audio row only, never its text', () => {
    expect(speechObjectKey(id)).toBe(`speech/${id}.mp3`);
    expect(articleAudioObjectKey(id)).toBe(`articles/${id}.mp3`);
  });
});

describe('isSpeechServiceKey', () => {
  it('accepts a speech object and the smoke test object', () => {
    expect(isSpeechServiceKey(speechObjectKey(id))).toBe(true);
    expect(isSpeechServiceKey(SMOKE_OBJECT_KEY)).toBe(true);
  });

  it.each([
    ['an article object', articleAudioObjectKey(id)],
    ['a key that is not a UUID', 'speech/hello.mp3'],
    ['an upper-case UUID', `speech/${id.toUpperCase()}.mp3`],
    ['another extension', `speech/${id}.wav`],
    ['a path that climbs out', `speech/../articles/${id}.mp3`],
    ['a leading slash', `/speech/${id}.mp3`],
    ['a trailing line break', `speech/${id}.mp3\n`],
    ['another smoke key', 'smoke/other.mp3'],
    ['nothing', ''],
  ])('refuses %s', (_, key) => {
    expect(isSpeechServiceKey(key)).toBe(false);
  });
});

describe('normalizeSpeechText', () => {
  it('trims, joins white space into single spaces and keeps the case', () => {
    expect(normalizeSpeechText('  Take\toff \n\n the  Jacket ')).toBe('Take off the Jacket');
  });

  it('composes characters to NFC', () => {
    expect(normalizeSpeechText('café')).toBe('café');
  });

  it('leaves nothing of white space alone', () => {
    expect(normalizeSpeechText(' \n\t ')).toBe('');
  });
});
