'use client';

// The Spell question (.docs/design/screens.md, Spell, screens 43–45): the Chinese meaning in large
// type, the part of speech, `Play example` with the Select words button, the examples with a
// blank for the hidden word, the arrows with `1 / N`, and the `Your answer` field. Play example
// plays the whole example the arrows show, hidden word included; the audio is asked for by the
// card and example IDs only. The field turns off capitals, correction and spell checking, takes
// at most 80 characters and is read-only once the answer is sent. Words on either side of a blank
// can be looked up; a selection that reaches into a blank says
// `Select words on one side of the blank.` and asks nothing.
import { Button } from '../../../lib/ui/button.tsx';
import { ExampleCarousel } from '../../../lib/ui/example-carousel.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useLookupBridge, type ExampleLookupContext } from '../../../lib/ui/lookup-bridge.ts';
import { useSpeech, type Speech } from '../../../lib/ui/speech-audio.ts';
import { SpeechFailureRow } from '../../../lib/ui/speech-controls.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import { isShown, standInText, touchesGap, type ClozeSegment } from '../domain/cloze.ts';
import { SPELL_ANSWER_MAX_LENGTH } from '../domain/spelling.ts';
import type { SpellQuestion } from './review-api.ts';
import { isLocked, showExample, useSession, writeAnswer } from './review-session.ts';
import { SelectWordsButton } from './select-words-button.tsx';

export const HIDDEN_WORD = 'Select words on one side of the blank.';

const WORD = /[\p{L}\p{N}]/u;

/** The parts of an example a person can choose words from: the text around its blanks. */
function choosableParts(segments: readonly ClozeSegment[]) {
  return segments.filter(isShown).filter((segment) => WORD.test(segment.text));
}

type PlayExampleProps = { speech: Speech; cardId: string; exampleId: string };

function PlayExample({ speech, cardId, exampleId }: PlayExampleProps) {
  const generating = speech.pending !== null;
  return (
    <Button
      aria-label={generating ? 'Generating example audio' : 'Play the full example'}
      aria-busy={generating || undefined}
      onClick={() => {
        if (!generating) {
          speech.play('example', { kind: 'card-example', cardId, exampleId });
        }
      }}
    >
      <Icon name={generating ? 'loader-circle' : 'volume-2'} spin={generating} />
      Play example
    </Button>
  );
}

function AnswerField() {
  const text = useSession('spell', (session) => session.text);
  const locked = useSession('spell', isLocked);
  return (
    <label className="mt-[22px] grid gap-1 text-[11px] text-muted">
      Your answer
      <input
        className="mt-0.5 min-h-11 w-full rounded border border-line bg-surface px-3 text-base text-ink read-only:text-muted"
        value={text}
        maxLength={SPELL_ANSWER_MAX_LENGTH}
        readOnly={locked}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(event) => writeAnswer('spell', event.target.value)}
      />
    </label>
  );
}

export function SpellPrompt({ question }: { question: SpellQuestion }) {
  const bridge = useLookupBridge();
  const speech = useSpeech();
  const index = useSession('spell', (session) => session.exampleIndex);
  const examples = question.examples.map((example) => ({
    id: example.id,
    text: standInText(example.segments),
    targetRanges: [],
    segments: example.segments,
  }));
  const shown = examples[Math.min(index, Math.max(0, examples.length - 1))];
  const lookupOf = (exampleId: string): ExampleLookupContext => ({
    kind: 'spell-example',
    cardId: question.cardId,
    exampleId,
  });

  return (
    <>
      <p className="text-xl leading-[1.4] font-medium">{question.meaningZh}</p>
      <p className="text-[11px] text-muted">{question.pos}</p>
      <ExampleCarousel
        examples={examples}
        index={shown ? examples.indexOf(shown) : 0}
        onIndexChange={(next) => showExample('spell', next)}
        onLookUp={(example, range) => {
          if (touchesGap(example.segments ?? [], [range.start, range.end])) {
            showToast(HIDDEN_WORD);
            return;
          }
          bridge?.lookUp({
            context: lookupOf(example.id),
            contextText: example.text,
            selection: range,
          });
        }}
        lead={
          shown ? (
            <PlayExample speech={speech} cardId={question.cardId} exampleId={shown.id} />
          ) : undefined
        }
        controls={
          shown ? (
            <SelectWordsButton
              disabled={!bridge}
              onOpen={(anchor) =>
                bridge?.openSelectionTool({
                  anchor,
                  context: {
                    kind: 'example',
                    lookup: lookupOf(shown.id),
                    text: shown.text,
                    segments: choosableParts(shown.segments),
                  },
                })
              }
            />
          ) : null
        }
      />
      <SpeechFailureRow speech={speech} />
      <AnswerField />
    </>
  );
}
