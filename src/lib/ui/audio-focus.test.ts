import { describe, expect, it, vi } from 'vitest';
import { pauseAllAudio, releaseAudioFocus, takeAudioFocus } from './audio-focus.ts';

function holder() {
  return { pause: vi.fn() };
}

describe('audio focus', () => {
  it('pauses the holder before the one that takes the focus', () => {
    const article = holder();
    const word = holder();

    takeAudioFocus(article);
    takeAudioFocus(word);

    expect(article.pause).toHaveBeenCalledOnce();
    expect(word.pause).not.toHaveBeenCalled();
    pauseAllAudio();
  });

  it('does not pause a holder that takes the focus again', () => {
    const article = holder();

    takeAudioFocus(article);
    takeAudioFocus(article);

    expect(article.pause).not.toHaveBeenCalled();
    pauseAllAudio();
  });

  it('pauses nothing after the holder released the focus', () => {
    const article = holder();
    const word = holder();
    takeAudioFocus(article);

    releaseAudioFocus(article);
    takeAudioFocus(word);

    expect(article.pause).not.toHaveBeenCalled();
    pauseAllAudio();
  });

  it('keeps the focus of another holder when one that does not hold it releases', () => {
    const article = holder();
    const word = holder();
    takeAudioFocus(article);

    releaseAudioFocus(word);
    pauseAllAudio();

    expect(article.pause).toHaveBeenCalledOnce();
  });

  it('pauses whatever plays, once', () => {
    const article = holder();
    takeAudioFocus(article);

    pauseAllAudio();
    pauseAllAudio();

    expect(article.pause).toHaveBeenCalledOnce();
  });
});
