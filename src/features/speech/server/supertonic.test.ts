import { describe, expect, it } from 'vitest';
import { chunkText, preprocessText, textIds } from './supertonic.ts';

describe('preprocessText', () => {
  it('tags the text with its language and ends it with a period', () => {
    expect(preprocessText('Hello world', 'en')).toBe('<en>Hello world.</en>');
  });

  it('replaces symbols the model does not voice and fixes the spacing around punctuation', () => {
    expect(preprocessText('A “quiet” wing — see e.g., NASA ; ok', 'en')).toBe(
      '<en>A "quiet" wing - see for example, NASA; ok.</en>',
    );
  });

  it('keeps closing punctuation that already ends the text', () => {
    expect(preprocessText('Is it?', 'en')).toBe('<en>Is it?</en>');
  });

  it('refuses a language the model does not have', () => {
    expect(() => preprocessText('Hi', 'xx')).toThrow('Invalid language: xx');
  });
});

describe('chunkText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkText('One sentence. Another one.')).toEqual(['One sentence. Another one.']);
  });

  it('splits at sentences when the text is longer than the limit', () => {
    expect(chunkText('First part here. Second part here.', 20)).toEqual([
      'First part here.',
      'Second part here.',
    ]);
  });

  it('does not split after a title such as Dr.', () => {
    expect(chunkText('Ask Dr. Lee now. Then go.', 18)).toEqual(['Ask Dr. Lee now.', 'Then go.']);
  });

  it('splits paragraphs apart', () => {
    expect(chunkText('One.\n\nTwo.')).toEqual(['One.', 'Two.']);
  });
});

describe('textIds', () => {
  it('maps code units to the indexer and leaves out units without an id', () => {
    const indexer = Array.from({ length: 128 }, (_, code) => (code === 0x7a ? -1 : code + 1000));

    expect(textIds(indexer, 'az中')).toEqual([BigInt(1097)]);
  });
});
