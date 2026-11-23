// One audio at a time (.docs/design/rules.md, 文章列表、搜索和播放): the article player, a word or
// example audio and anything else that plays sound takes the focus before it starts, and the one
// that held it is paused. Nothing resumes on its own when the focus moves on, so a word audio
// that pauses the article leaves it paused. Entering a review pauses whatever plays.

export type AudioHolder = {
  /** Pauses this holder's audio, keeping its position. */
  pause(): void;
};

let holder: AudioHolder | null = null;

/** Makes `next` the one audio that plays, pausing the holder before it. */
export function takeAudioFocus(next: AudioHolder): void {
  const previous = holder;
  holder = next;
  if (previous && previous !== next) {
    previous.pause();
  }
}

/** Gives the focus up when this holder stops by itself; another holder's focus stays. */
export function releaseAudioFocus(current: AudioHolder): void {
  if (holder === current) {
    holder = null;
  }
}

/** Pauses whatever plays, as entering a review does. */
export function pauseAllAudio(): void {
  const previous = holder;
  holder = null;
  previous?.pause();
}
