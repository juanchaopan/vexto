// What a playback request points at (.docs/design/interfaces.md, 取得播放地址): IDs only, never
// text, so a request cannot have arbitrary text read aloud. An article is shared by everyone; a
// lookup and a card, with their examples, belong to one member.

export type PlaybackLocator =
  | { kind: 'article'; articleId: string }
  | { kind: 'lookup-word'; lookupId: string }
  | { kind: 'lookup-example'; lookupId: string; exampleId: string }
  | { kind: 'card-word'; cardId: string }
  | { kind: 'card-example'; cardId: string; exampleId: string };

/** Locators of a word or an example, whose speech is made on request. */
export type SpeechLocator = Exclude<PlaybackLocator, { kind: 'article' }>;

/** Speech of a word and of an example are recorded as their own kinds of usage. */
export function speechUsageKindOf(kind: SpeechLocator['kind']): 'word_tts' | 'example_tts' {
  return kind === 'lookup-word' || kind === 'card-word' ? 'word_tts' : 'example_tts';
}
