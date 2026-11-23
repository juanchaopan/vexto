'use client';

// The player fixed at the bottom of the reader (.docs/design/screens.md, 阅读页上有什么): play or
// pause, `<title> · <sentence>/<count>` over the progress slider, the speed button and, during a
// continuous play, the next article button. When the browser refused to start the audio, Tap to
// continue takes the place of the play button and the slider.
import { useRef } from 'react';
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { choiceRowClass, Popover, PopoverTitle, usePopover } from '../../../lib/ui/popover.tsx';
import { advance, resume, seek, setSpeed, toggle } from './player.ts';
import { isPlaying, speedText, SPEEDS, usePlayerStore } from './player-store.ts';

export type PlayerBarProps = {
  title: string;
  sentenceCount: number;
  /** The sentence to show; the player's own when it holds this article. */
  sentence: number;
  /** Whether the player holds this article. */
  current: boolean;
};

function SpeedControl() {
  const speed = usePlayerStore((state) => state.speed);
  const anchor = useRef<HTMLButtonElement>(null);
  const { open, toggle: toggleOpen, close } = usePopover(anchor);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-line bg-linear-to-b from-surface to-page px-1.5 py-1 text-xs font-medium"
        aria-label={`Playback speed, ${speedText(speed)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {speedText(speed)}
      </button>
      {open ? (
        <Popover anchor={anchor} label="Playback speed" width={200} onClose={close}>
          <PopoverTitle title="Speed" closeLabel="Close speed" onClose={() => close()} />
          <div className="mt-[3px] mb-[9px] grid">
            {SPEEDS.map((value) => (
              <label key={value} className={choiceRowClass}>
                <input
                  type="radio"
                  name="playback-speed"
                  checked={value === speed}
                  onChange={() => {
                    setSpeed(value);
                    close();
                  }}
                />
                <span>{speedText(value)}</span>
              </label>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function PlayerBar({ title, sentenceCount, sentence, current }: PlayerBarProps) {
  const status = usePlayerStore((state) => (current ? state.status : 'idle'));
  const mode = usePlayerStore((state) => state.mode);
  const queued = usePlayerStore((state) => current && state.queue !== null);
  const playing = isPlaying(status) && mode === 'article';
  return (
    <footer
      aria-label="Article player"
      className="sticky bottom-0 z-[5] flex min-h-[58px] items-center gap-1 border-t border-line bg-surface px-[5px] pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]"
    >
      {status === 'blocked' ? (
        <Button variant="primary" className="flex-1" onClick={resume}>
          Tap to continue
        </Button>
      ) : (
        <>
          <Button
            variant="primary"
            shape="icon"
            aria-label={playing ? 'Pause article' : 'Play article'}
            onClick={toggle}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </Button>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[10px] text-muted">
              {title} · {sentence + 1}/{sentenceCount}
            </span>
            <input
              type="range"
              aria-label="Article progress"
              min={0}
              max={Math.max(0, sentenceCount - 1)}
              value={sentence}
              onChange={(event) => seek(Number(event.target.value))}
              className="m-0 h-7 w-full accent-accent"
            />
          </div>
        </>
      )}
      <SpeedControl />
      {queued ? (
        <Button
          variant="flat"
          shape="icon"
          aria-label="Next article"
          onClick={() => void advance()}
        >
          <Icon name="skip-forward" />
        </Button>
      ) : null}
    </footer>
  );
}
