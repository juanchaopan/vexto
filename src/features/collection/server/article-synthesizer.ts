// What the collection job needs from speech synthesis and from the audio storage, as interfaces
// another feature implements (.docs/design/rules.md, 合成和发布 and 朗读和存储上限). The job
// keeps the article's state, attempts, audio row, usage record, monthly synthesis tally and the
// publishing transaction; the synthesizer only turns sentences into one uploaded MP3.
import type { SynthesisErrorCode } from '../../articles/index.ts';

/** How the audio is made; recorded on the audio row and the usage record. */
export type ArticleVoice = {
  /** Such as `supertonic`. */
  provider: string;
  /** Such as `supertonic-3`. */
  model: string;
  /** Such as `F1`. */
  voice: string;
  /** The pinned revision of the model. */
  modelRevision: string;
  /** The encoding version, such as `mp3-mono-32k-v1`. */
  encoding: string;
};

export type ArticleSynthesisRequest = {
  articleId: string;
  /** Where the MP3 goes in the bucket, `articles/<audio ID>.mp3`; overwritten when it exists. */
  objectKey: string;
  /** The article's sentences in order; each is synthesized on its own. */
  sentences: readonly string[];
};

/** Where one sentence lies in the article's audio, in milliseconds. */
export type SentenceTiming = { startMs: number; endMs: number };

export type SynthesizedArticle = {
  /** Size of the uploaded MP3. */
  byteSize: number;
  durationMs: number;
  /** One timing per sentence, in order, within the duration and never going back. */
  sentenceTimings: readonly SentenceTiming[];
  /** CPU time the synthesis used. */
  cpuMs: number;
};

/**
 * Synthesizes an article sentence by sentence, joins and encodes the audio and uploads it to the
 * object key. It throws an ArticleSynthesisError for a failure the article is retried for; any
 * other error ends the run as failed. Messages name what failed, never the article's text.
 */
export type ArticleSynthesizer = {
  readonly voice: ArticleVoice;
  synthesize(request: ArticleSynthesisRequest): Promise<SynthesizedArticle>;
};

/**
 * Makes the synthesizer ready, such as loading the speech model. The job calls it only when an
 * article is about to be synthesized, so a run with nothing to synthesize never loads the model.
 */
export type ArticleSynthesizerLoader = () => Promise<ArticleSynthesizer>;

export type ArticleToStore = { articleId: string; wordCount: number; sentenceCount: number };

/**
 * Keeps the audio storage under its cap: called before every article synthesis, it evicts the
 * oldest audio when the stored audio has reached the eviction ratio, or would with this article.
 */
export type AudioStorageRoom = {
  makeRoomFor(article: ArticleToStore): Promise<void>;
};

export type SynthesisFailureCode = Exclude<SynthesisErrorCode, 'interrupted'>;

/** A synthesis that failed in a way the article is retried for, with the reason recorded. */
export class ArticleSynthesisError extends Error {
  readonly code: SynthesisFailureCode;

  constructor(code: SynthesisFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArticleSynthesisError';
    this.code = code;
  }
}

function notBuilt(what: string): never {
  throw new Error(`${what} is not implemented.`);
}

/** Stands in for the speech model, which this build does not have: loading it throws. */
export const unimplementedSynthesizerLoader: ArticleSynthesizerLoader = async () =>
  notBuilt('Article synthesis');

/** Stands in for the storage eviction, which this build does not have: it throws. */
export const unimplementedAudioStorageRoom: AudioStorageRoom = {
  async makeRoomFor() {
    notBuilt('Audio storage eviction');
  },
};
