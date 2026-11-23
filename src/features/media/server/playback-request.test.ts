import { describe, expect, it } from 'vitest';
import { playbackRequest } from './playback-request.ts';

const a = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const b = '1c2d3e4f-5061-4b7c-9d8e-0f1a2b3c4d5e';

describe('playbackRequest', () => {
  it.each([
    { kind: 'article', articleId: a },
    { kind: 'lookup-word', lookupId: a },
    { kind: 'lookup-example', lookupId: a, exampleId: b },
    { kind: 'card-word', cardId: a },
    { kind: 'card-example', cardId: a, exampleId: b },
  ])('accepts a $kind locator', (locator) => {
    expect(playbackRequest.parse(locator)).toEqual(locator);
  });

  it.each([
    ['an unknown kind', { kind: 'speech', articleId: a }],
    ['text to read', { kind: 'card-word', cardId: a, text: 'take off' }],
    ['a field of another kind', { kind: 'article', articleId: a, cardId: b }],
    ['an example without its parent', { kind: 'card-example', exampleId: b }],
    ['an ID that is not a UUID', { kind: 'article', articleId: '1 or 1=1' }],
    ['an object key', { kind: 'article', articleId: `articles/${a}.mp3` }],
    ['no kind', { articleId: a }],
    ['nothing', undefined],
  ])('refuses %s', (_, body) => {
    expect(playbackRequest.safeParse(body).success).toBe(false);
  });
});
