import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { articleAudioCacheKey } from './article-audio.ts';
import { speechCacheKey } from './speech-audio.ts';

const version = { voice: 'F1', modelRevision: 'a'.repeat(40), encoding: 'mp3-mono-32k-v1' };

function sha256(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('speechCacheKey', () => {
  it('is the SHA-256 of the normalized text, voice, revision and encoding, one per line', () => {
    expect(speechCacheKey('take off', version)).toBe(
      sha256(`take off\nF1\n${'a'.repeat(40)}\nmp3-mono-32k-v1`),
    );
  });

  it('is the same for texts that normalize to the same text', () => {
    expect(speechCacheKey('  take \n off ', version)).toBe(speechCacheKey('take off', version));
    expect(speechCacheKey('café', version)).toBe(speechCacheKey('café', version));
  });

  it('keeps letter case apart', () => {
    expect(speechCacheKey('Polish', version)).not.toBe(speechCacheKey('polish', version));
  });

  it('changes with the voice, the model revision and the encoding', () => {
    const key = speechCacheKey('take off', version);

    expect(speechCacheKey('take off', { ...version, voice: 'M1' })).not.toBe(key);
    expect(speechCacheKey('take off', { ...version, modelRevision: 'b'.repeat(40) })).not.toBe(key);
    expect(speechCacheKey('take off', { ...version, encoding: 'mp3-mono-48k-v1' })).not.toBe(key);
  });

  it('never meets an article cache key', () => {
    const articleId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

    expect(speechCacheKey(`article\n${articleId}`, version)).not.toBe(
      articleAudioCacheKey(articleId, version),
    );
  });
});
