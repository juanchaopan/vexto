'use client';

// The play buttons of word and example audio and their failure row (.docs/design/screens.md, 读音
// and screens 23–24). While its audio is fetched or made, a button's speaker gives way to a
// spinner, with no text and a name that says the audio is being made; it cannot be cancelled. A
// failure shows below the lemma: an alert icon, `Audio isn't available right now.` and Retry when
// another try can help.
import { Button, type ButtonVariant } from './button.tsx';
import { Icon } from './icon.tsx';
import type { Speech, SpeechLocator } from './speech-audio.ts';

export type SpeechButtonProps = {
  speech: Speech;
  /** Which of the group's buttons this is, such as `word`. */
  speechKey: string;
  locator: SpeechLocator;
  label: string;
  /** The name while the audio is being made, such as `Generating word audio`. */
  generatingLabel: string;
  variant?: ButtonVariant;
};

export function SpeechButton({
  speech,
  speechKey,
  locator,
  label,
  generatingLabel,
  variant = 'default',
}: SpeechButtonProps) {
  const generating = speech.pending === speechKey;
  return (
    <Button
      variant={variant}
      shape="icon"
      aria-label={generating ? generatingLabel : label}
      aria-busy={generating || undefined}
      onClick={() => {
        if (speech.pending === null) {
          speech.play(speechKey, locator);
        }
      }}
    >
      <Icon name={generating ? 'loader-circle' : 'volume-2'} spin={generating} />
    </Button>
  );
}

/** The failure row of a group of play buttons, or nothing while there is no failure. */
export function SpeechFailureRow({ speech }: { speech: Speech }) {
  if (!speech.failure) {
    return null;
  }
  return (
    <div role="alert" className="mt-1.5 flex items-center gap-2 text-xs text-danger">
      <Icon name="circle-alert" />
      <span>Audio isn&apos;t available right now.</span>
      {speech.failure.retryable ? (
        <Button className="ml-auto text-ink" onClick={speech.retry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
