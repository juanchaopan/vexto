'use client';

// The Translate question (.docs/design/screens.md, Translate, screens 46–47 and 63): the English
// lemma in large type, the part of speech, the examples as they are (nothing hidden or
// highlighted) with the Select words button, the arrows with `1 / N`, and the four options, each
// a Chinese meaning with its part of speech below. A chosen option shows pressed. Once the answer
// is sent the options are read-only; after a wrong answer the chosen option turns red with a
// cross. Every word of the examples can be looked up in the card's example.
import { ExampleCarousel } from '../../../lib/ui/example-carousel.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useLookupBridge } from '../../../lib/ui/lookup-bridge.ts';
import type { TranslateOption, TranslateQuestion } from './review-api.ts';
import {
  chooseOption,
  isLocked,
  showExample,
  useSession,
  type ReviewSession,
} from './review-session.ts';
import { SelectWordsButton } from './select-words-button.tsx';

/** The option a wrong answer chose, or null. */
function wrongChoice(session: ReviewSession): string | null {
  const { outcome, sent } = session;
  if (outcome?.kind !== 'answered' || outcome.result.result !== 'incorrect' || !sent) {
    return null;
  }
  return 'optionId' in sent.answer ? sent.answer.optionId : null;
}

const optionClass =
  'flex min-h-11 w-full items-center gap-2 rounded border border-line bg-surface px-2.5 py-[7px] text-left text-[13px] aria-pressed:border-accent aria-pressed:bg-soft disabled:opacity-45';
const wrongClass =
  'border-danger! bg-[color-mix(in_srgb,var(--color-danger)_10%,var(--color-surface))]! text-danger opacity-100!';

function Options({ options }: { options: TranslateOption[] }) {
  const chosen = useSession('translate', (session) => session.optionId);
  const locked = useSession('translate', isLocked);
  const wrong = useSession('translate', wrongChoice);
  return (
    <div role="group" aria-label="Options" className="mt-2.5 grid gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={chosen === option.id}
          disabled={locked}
          className={`${optionClass} ${wrong === option.id ? wrongClass : ''}`}
          onClick={() => chooseOption('translate', option.id)}
        >
          <span className="min-w-0 flex-1">
            <span className="block">{option.meaningZh}</span>
            <small className="block text-[11px] text-muted">{option.pos}</small>
          </span>
          {wrong === option.id ? <Icon name="x" /> : null}
        </button>
      ))}
    </div>
  );
}

export function TranslatePrompt({ question }: { question: TranslateQuestion }) {
  const bridge = useLookupBridge();
  const index = useSession('translate', (session) => session.exampleIndex);
  const examples = question.examples.map((example) => ({ ...example, targetRanges: [] }));
  const shownIndex = Math.min(index, Math.max(0, examples.length - 1));
  const shown = examples[shownIndex];
  const lookupOf = (exampleId: string) => ({
    kind: 'vocabulary-example' as const,
    cardId: question.cardId,
    exampleId,
  });

  return (
    <>
      <p lang="en" className="truncate text-xl leading-[1.4] font-semibold">
        {question.lemma}
      </p>
      <p className="text-[11px] text-muted">{question.pos}</p>
      <ExampleCarousel
        examples={examples}
        index={shownIndex}
        onIndexChange={(next) => showExample('translate', next)}
        onLookUp={(example, range) =>
          bridge?.lookUp({
            context: lookupOf(example.id),
            contextText: example.text,
            selection: range,
          })
        }
        controls={
          shown ? (
            <SelectWordsButton
              disabled={!bridge}
              onOpen={(anchor) =>
                bridge?.openSelectionTool({
                  anchor,
                  context: { kind: 'example', lookup: lookupOf(shown.id), text: shown.text },
                })
              }
            />
          ) : null
        }
      />
      <Options options={question.options} />
    </>
  );
}
