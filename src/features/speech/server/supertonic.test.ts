import { describe, expect, it } from 'vitest';
import { mp3Encoder, SAMPLES_PER_CHARACTER, TEST_SAMPLE_RATE } from '../testing.ts';
import { narrate } from './narration.ts';
import { chunkText, preprocessText, synthesizeInChunks, textIds } from './supertonic.ts';

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

  it('keeps a sentence just under the limit whole', () => {
    const sentence = 'Short words go here';
    expect(sentence).toHaveLength(19);

    expect(chunkText(sentence, 20)).toEqual([sentence]);
  });

  it('keeps a sentence exactly as long as the limit whole', () => {
    const sentence = 'Short words go here.';
    expect(sentence).toHaveLength(20);

    expect(chunkText(sentence, 20)).toEqual([sentence]);
  });

  it('splits a sentence over the limit at the last word boundary that fits', () => {
    const sentence = 'Short words go there.';
    expect(sentence).toHaveLength(21);

    expect(chunkText(sentence, 20)).toEqual(['Short words go', 'there.']);
  });

  it('splits a sentence over the limit after a clause break rather than a later word', () => {
    expect(chunkText('Before the storm, the crew packed everything.', 30)).toEqual([
      'Before the storm,',
      'the crew packed everything.',
    ]);
    expect(chunkText('Three rules apply; each one is strict here.', 30)).toEqual([
      'Three rules apply;',
      'each one is strict here.',
    ]);
    expect(chunkText('They named two rivers: the Rhine and the Elbe.', 30)).toEqual([
      'They named two rivers:',
      'the Rhine and the Elbe.',
    ]);
  });

  it('takes a comma without whitespace after it, as in 1,000, for no clause break', () => {
    expect(chunkText('Prices rose to 1,000 dollars in the market today.', 25)).toEqual([
      'Prices rose to 1,000',
      'dollars in the market',
      'today.',
    ]);
  });

  it('packs the pieces of a split sentence with the sentences around it', () => {
    expect(chunkText('One. Short words go there. Two.', 20)).toEqual([
      'One. Short words go',
      'there. Two.',
    ]);
  });

  it('splits a sentence without spaces at the limit', () => {
    expect(chunkText('x'.repeat(45), 20)).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5)]);
  });

  it('does not cut a character made of two code units in two', () => {
    expect(chunkText(`${'a'.repeat(19)}😀b`, 20)).toEqual(['a'.repeat(19), '😀b']);
  });

  it('keeps every chunk of a long unpunctuated paragraph within the default limit', () => {
    const paragraph = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');

    const chunks = chunkText(paragraph);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
    expect(chunks.join(' ')).toBe(paragraph);
  });
});

describe('synthesizeInChunks', () => {
  it('reads a split sentence as one synthesis, so the timeline keeps one entry per sentence', async () => {
    const inferred: string[] = [];
    const engine = {
      sampleRate: TEST_SAMPLE_RATE,
      synthesize: (text: string) =>
        synthesizeInChunks(text, 20, TEST_SAMPLE_RATE, async (chunk) => {
          inferred.push(chunk);
          return new Float32Array(chunk.length * SAMPLES_PER_CHARACTER);
        }),
    };

    const narration = await narrate(engine, mp3Encoder(), ['Short words go there.', 'Two.'], 300);

    expect(inferred).toEqual(['Short words go', 'there.', 'Two.']);
    // The first sentence is its two pieces with 0.3 s of silence between them: 200 + 300 ms.
    expect(narration.timings).toEqual([
      { startMs: 0, endMs: 500 },
      { startMs: 800, endMs: 840 },
    ]);
    expect(narration.durationMs).toBe(840);
  });
});

describe('textIds', () => {
  it('maps code units to the indexer and leaves out units without an id', () => {
    const indexer = Array.from({ length: 128 }, (_, code) => (code === 0x7a ? -1 : code + 1000));

    expect(textIds(indexer, 'az中')).toEqual([BigInt(1097)]);
  });
});
