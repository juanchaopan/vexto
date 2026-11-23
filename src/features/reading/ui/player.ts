'use client';

// The article player (.docs/design/screens.md, 播放; .docs/design/rules.md, 文章列表、搜索和播放).
// One audio element plays every article, so audio keeps playing while the person moves between
// pages, and an element the person once started may start the next article by itself. The
// element is made on first use; tests give the player a stand-in through setAudioFactory().
//
// The current sentence follows the audio's time and the sentence timings. A sentence's own button
// plays that sentence and stops at its end. The playback address is a presigned URL valid for ten
// minutes; it is fetched again when it is about to expire, and when the audio fails after it
// expired. A browser that refuses to start audio without a tap leaves the player `blocked`, and
// the player bar offers Tap to continue.
//
// A continuous play moves through its queue: in the foreground an article that ends sends the
// person back to the list, where the next article is shown, and about 500 ms later the next
// article opens and plays from its first sentence. In the background or on the lock screen only
// the audio changes. An article of the queue that no longer exists is skipped with a notice.
import type { QueryClient } from '@tanstack/react-query';
import { ApiRequestError, hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import {
  releaseAudioFocus,
  takeAudioFocus,
  type AudioHolder,
} from '../../../lib/ui/audio-focus.ts';
import { showToast } from '../../../lib/ui/toast.tsx';
import { queueFrom, sentenceAt } from '../domain/reading.ts';
import {
  fetchArticle,
  fetchPlaybackAddress,
  forgetArticle,
  type ReaderArticle,
} from './article-api.ts';
import { stoppedPlayer, usePlayerStore, type PlayMode } from './player-store.ts';
import { feedName } from './source-mark.tsx';

export const PLAY_FAILED = "Couldn't play this article.";
export const ARTICLE_GONE = 'This article is no longer available.';
export const PLAYBACK_FINISHED = 'Playback finished.';

/** How long the list shows between two articles of a continuous play. */
export const LIST_PAUSE_MS = 500;

/** A playback address is fetched again this long before it expires. */
const ADDRESS_MARGIN_MS = 60_000;

export type PlayerAudio = Pick<
  HTMLAudioElement,
  | 'src'
  | 'currentTime'
  | 'playbackRate'
  | 'play'
  | 'pause'
  | 'load'
  | 'removeAttribute'
  | 'addEventListener'
>;

/** What the player asks of the pages: where the person is, and moving between list and reader. */
export type PlayerNavigator = {
  isForeground(): boolean;
  /** Shows the list, loaded up to and scrolled to `reveal` when it names an article. */
  showList(reveal: string | null): void;
  openArticle(id: string): void;
};

type Connection = { queryClient: QueryClient; navigator: PlayerNavigator };

let createAudio: () => PlayerAudio = () => new Audio();
let audio: PlayerAudio | null = null;
let prepared = false;
let connection: Connection | null = null;
let address: { articleId: string; url: string; expiresAt: number } | null = null;
let frame = 0;
let pendingStep: ReturnType<typeof setTimeout> | undefined;

const state = () => usePlayerStore.getState();
const set = usePlayerStore.setState;

const holder: AudioHolder = { pause: () => pause() };

/** Replaces the audio element the player makes, as the component tests do. */
export function setAudioFactory(factory: () => PlayerAudio): void {
  createAudio = factory;
  audio = null;
  prepared = false;
  address = null;
}

/** Connects the player to the pages; the returned function disconnects it. */
export function connectPlayer(next: Connection): () => void {
  connection = next;
  return () => {
    if (connection === next) {
      connection = null;
    }
  };
}

function element(): PlayerAudio {
  if (!audio) {
    audio = createAudio();
    audio.addEventListener('timeupdate', follow);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onMediaError);
    audio.addEventListener('pause', onOutsidePause);
  }
  return audio;
}

function stopFrames() {
  cancelAnimationFrame(frame);
}

/** Follows the audio's time on every frame while it plays, so the highlight keeps up. */
function runFrames() {
  stopFrames();
  const step = () => {
    follow();
    if (state().status === 'playing') {
      frame = requestAnimationFrame(step);
    }
  };
  frame = requestAnimationFrame(step);
}

function follow() {
  const { article, status, mode, selected, sentence } = state();
  if (!article || !audio || status !== 'playing') {
    return;
  }
  const ms = audio.currentTime * 1000;
  if (mode === 'sentence' && selected !== null) {
    if (ms >= article.timings[selected].endMs) {
      set({ status: 'paused', sentence: selected });
      audio.pause();
      stopFrames();
      releaseAudioFocus(holder);
    }
    return;
  }
  const current = sentenceAt(article.timings, ms);
  if (current !== sentence) {
    set({ sentence: current });
  }
}

function halt() {
  stopFrames();
  audio?.pause();
}

function cancelStep() {
  clearTimeout(pendingStep);
  pendingStep = undefined;
}

function later(work: () => void) {
  cancelStep();
  pendingStep = setTimeout(work, LIST_PAUSE_MS);
}

/**
 * Lets the audio element start later without another tap. Call it in the handler of the tap that
 * starts playback, before anything is awaited: some browsers let an element play by itself only
 * once a tap has started it.
 */
export function preparePlayback(): void {
  const target = element();
  if (prepared || target.src) {
    prepared = true;
    return;
  }
  prepared = true;
  target.play().catch(() => undefined);
  target.pause();
}

async function ensureAddress(articleId: string, target: PlayerAudio, queryClient: QueryClient) {
  if (address?.articleId === articleId && address.expiresAt - ADDRESS_MARGIN_MS > Date.now()) {
    return;
  }
  const fresh = await fetchPlaybackAddress(queryClient, articleId);
  address = { articleId, url: fresh.url, expiresAt: Date.parse(fresh.expiresAt) };
  target.src = fresh.url;
}

const handledElsewhere = (error: unknown) =>
  hasErrorCode(error, 'UNAUTHENTICATED', 'NOT_A_MEMBER', 'TERMS_REQUIRED');

/** The player stops where it is and says the article could not play. */
function failed(error: unknown, retry: () => void) {
  halt();
  set({ status: 'paused' });
  releaseAudioFocus(holder);
  if (handledElsewhere(error)) {
    return;
  }
  const retryable = offersRetry(error) || !(error instanceof ApiRequestError);
  showToast(PLAY_FAILED, retryable ? { retry } : {});
}

function stillLoading(articleId: string) {
  return state().article?.id === articleId && state().status === 'loading';
}

async function startAudio(articleId: string, target: PlayerAudio, retry: () => void) {
  try {
    await target.play();
  } catch (error) {
    if (!stillLoading(articleId)) {
      return;
    }
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      set({ status: 'blocked' });
    } else {
      failed(error, retry);
    }
    return;
  }
  if (stillLoading(articleId)) {
    set({ status: 'playing' });
    runFrames();
  }
}

async function playFrom(index: number, mode: PlayMode): Promise<void> {
  const { article, speed, started } = state();
  if (!article || !connection) {
    return;
  }
  const retry = () => void playFrom(index, mode);
  cancelStep();
  takeAudioFocus(holder);
  set({
    status: 'loading',
    mode,
    sentence: index,
    selected: mode === 'sentence' ? index : null,
    started: started || mode === 'article',
  });
  const target = element();
  try {
    await ensureAddress(article.id, target, connection.queryClient);
  } catch (error) {
    failed(error, retry);
    return;
  }
  if (stillLoading(article.id)) {
    target.playbackRate = speed;
    target.currentTime = article.timings[index].startMs / 1000;
    await startAudio(article.id, target, retry);
  }
}

function onEnded() {
  stopFrames();
  const { mode, queue } = state();
  if (mode === 'sentence') {
    set({ status: 'paused' });
    releaseAudioFocus(holder);
  } else if (queue) {
    void advance();
  } else {
    set({ status: 'idle', started: false, sentence: 0 });
    releaseAudioFocus(holder);
  }
}

/** The audio failed while playing: an expired address is fetched again, anything else stops. */
function onMediaError() {
  const { status, sentence, mode } = state();
  if (status !== 'playing') {
    return;
  }
  if (address && address.expiresAt - ADDRESS_MARGIN_MS <= Date.now()) {
    address = null;
    void playFrom(sentence, mode);
    return;
  }
  failed(new Error('The audio failed to play.'), () => void playFrom(sentence, mode));
}

/** The system paused the audio, as for a call or a headset button. */
function onOutsidePause() {
  if (state().status === 'playing') {
    stopFrames();
    set({ status: 'paused' });
  }
}

/** Pauses the article, keeping its place. */
export function pause(): void {
  const { status } = state();
  if (status === 'playing' || status === 'loading') {
    set({ status: 'paused' });
    halt();
  }
}

/**
 * The top play button and the player's play button: pauses the article while it plays, and
 * otherwise plays to the end from the selected sentence, the paused place or the beginning.
 */
export function toggle(): void {
  const { status, mode, selected, started, sentence } = state();
  if ((status === 'playing' || status === 'loading') && mode === 'article') {
    pause();
    return;
  }
  preparePlayback();
  void playFrom(selected ?? (started ? sentence : 0), 'article');
}

/** A sentence's own button: plays only that sentence, or stops it and clears the selection. */
export function playSentence(index: number): void {
  if (state().selected === index) {
    halt();
    set({ status: 'idle', mode: 'article', selected: null, started: false, sentence: 0 });
    releaseAudioFocus(holder);
    return;
  }
  preparePlayback();
  void playFrom(index, 'sentence');
}

/** The progress slider: moves to a sentence, playing on from there when the audio plays. */
export function seek(index: number): void {
  const { article } = state();
  if (!article) {
    return;
  }
  set({ sentence: index, started: true, selected: null, mode: 'article' });
  if (audio && address?.articleId === article.id) {
    audio.currentTime = article.timings[index].startMs / 1000;
  }
}

export function setSpeed(speed: number): void {
  set({ speed });
  if (audio) {
    audio.playbackRate = speed;
  }
}

/** Tap to continue, and the lock screen's play: plays on from the current sentence. */
export function resume(): void {
  preparePlayback();
  void playFrom(state().sentence, 'article');
}

/** True while an article plays or a continuous play is under way. */
export function isActive(): boolean {
  const { status, queue } = state();
  return status === 'playing' || status === 'loading' || status === 'blocked' || queue !== null;
}

/** Stops playback and clears the queue, as opening an article from the list does. */
export function stop(): void {
  halt();
  cancelStep();
  set({
    status: 'idle',
    mode: 'article',
    sentence: 0,
    started: false,
    selected: null,
    queue: null,
    queueIndex: 0,
    autoplay: null,
  });
  releaseAudioFocus(holder);
}

/** Stops everything and forgets the article and its audio, as logging out does. */
export function reset(): void {
  stop();
  address = null;
  audio?.removeAttribute('src');
  audio?.load();
  set(stoppedPlayer);
}

function toPlayerArticle(article: ReaderArticle) {
  return {
    id: article.id,
    title: article.title,
    feedKey: article.feedKey,
    timings: article.sentences.map(({ startMs, endMs }) => ({ startMs, endMs })),
  };
}

/**
 * Loads the article the reader shows. Another article stops; the queue stays only when this
 * article is its current one. An article the queue is waiting for starts from its first sentence.
 */
export function open(article: ReaderArticle): void {
  const current = state();
  if (current.article?.id !== article.id) {
    const queued = current.queue !== null && current.queue[current.queueIndex] === article.id;
    halt();
    address = null;
    set({
      article: toPlayerArticle(article),
      status: 'idle',
      mode: 'article',
      sentence: 0,
      started: false,
      selected: null,
      queue: queued ? current.queue : null,
      queueIndex: queued ? current.queueIndex : 0,
    });
  }
  if (state().autoplay === article.id) {
    set({ autoplay: null });
    void playFrom(0, 'article');
  }
}

function openQueued(id: string) {
  set({ autoplay: id });
  connection?.navigator.openArticle(id);
}

/**
 * Starts a continuous play of the list's articles from `startId`: Play all passes the first ID,
 * an article's play button its own.
 */
export function startQueue(ids: readonly string[], startId: string): void {
  const queue = queueFrom(ids, startId);
  halt();
  cancelStep();
  set({ queue, queueIndex: 0, status: 'idle', selected: null, started: false, sentence: 0 });
  if (state().article?.id === queue[0]) {
    set({ article: null });
  }
  openQueued(queue[0]);
}

function stepQueue(): string | null {
  const { queue, queueIndex } = state();
  if (!queue || queueIndex + 1 >= queue.length) {
    return null;
  }
  set({ queueIndex: queueIndex + 1 });
  return queue[queueIndex + 1];
}

function endQueue(message: string) {
  halt();
  cancelStep();
  set({ status: 'idle', started: false, sentence: 0, queue: null, queueIndex: 0, autoplay: null });
  releaseAudioFocus(holder);
  connection?.navigator.showList(null);
  showToast(message);
}

async function playInBackground(id: string, queryClient: QueryClient): Promise<void> {
  try {
    const article = await fetchArticle(queryClient, id);
    set({ autoplay: id });
    open(article);
  } catch (error) {
    if (hasErrorCode(error, 'NOT_FOUND')) {
      forgetArticle(queryClient, id);
      await advance();
    } else {
      failed(error, () => void playInBackground(id, queryClient));
    }
  }
}

/** Moves to the next article of the queue, or ends the continuous play after the last one. */
export async function advance(): Promise<void> {
  const next = stepQueue();
  if (!next) {
    endQueue(PLAYBACK_FINISHED);
    return;
  }
  if (!connection) {
    return;
  }
  if (connection.navigator.isForeground()) {
    halt();
    set({ status: 'idle' });
    connection.navigator.showList(next);
    later(() => openQueued(next));
  } else {
    await playInBackground(next, connection.queryClient);
  }
}

/**
 * The reader found that its article no longer exists: back to the list with a notice, and when
 * the queue was waiting for it, on to the one after it.
 */
export function articleGone(id: string): void {
  const { queue, queueIndex } = state();
  const queued = queue !== null && queue[queueIndex] === id;
  if (connection) {
    forgetArticle(connection.queryClient, id);
  }
  if (!queued) {
    connection?.navigator.showList(null);
    showToast(ARTICLE_GONE);
    return;
  }
  set({ autoplay: null });
  const next = stepQueue();
  if (!next) {
    endQueue(ARTICLE_GONE);
    return;
  }
  halt();
  connection?.navigator.showList(next);
  showToast(ARTICLE_GONE);
  later(() => openQueued(next));
}

/** The lock screen and notification controls: title, source, play, pause and next with a queue. */
function updateMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }
  const session = navigator.mediaSession;
  const { article, status, queue } = state();
  if (!article) {
    session.metadata = null;
    return;
  }
  if (typeof MediaMetadata !== 'undefined') {
    session.metadata = new MediaMetadata({
      title: article.title,
      artist: feedName(article.feedKey),
      album: 'vexto',
    });
  }
  session.playbackState = status === 'playing' ? 'playing' : 'paused';
  session.setActionHandler('play', resume);
  session.setActionHandler('pause', pause);
  session.setActionHandler('nexttrack', queue ? () => void advance() : null);
}

if (typeof window !== 'undefined') {
  usePlayerStore.subscribe((now, before) => {
    if (
      now.article !== before.article ||
      now.status !== before.status ||
      now.queue !== before.queue
    ) {
      updateMediaSession();
    }
  });
}
