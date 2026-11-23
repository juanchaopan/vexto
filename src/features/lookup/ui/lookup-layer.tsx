'use client';

// One explanation (.docs/design/screens.md, 查词浮窗, screens 20–27 and 56): a card with the title
// row `Word explanation`, the Add word button and the close button, then
//   - while it loads: the selected text, grey placeholder bars and `Explaining…`;
//   - when it failed: the selected text and `Couldn't explain this.`, or `You're offline. Connect
//     to look up words.` when the request got no response, with Retry when another try can help;
//   - with the explanation: the lemma and Play word, the audio failure row, the part of speech,
//     the Chinese meaning and the examples with Select words, Play example and Refresh.
// Add word works only on a finished explanation and only when the vocabulary provides a saver;
// an explanation already saved as a card shows the check at once. A layer below the top one is
// shifted to the left and cannot be used.
import { useRef, useState } from 'react';
import { Button } from '../../../lib/ui/button.tsx';
import { ExampleCarousel } from '../../../lib/ui/example-carousel.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import type { WordSaver } from '../../../lib/ui/lookup-bridge.ts';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { useSpeech } from '../../../lib/ui/speech-audio.ts';
import { SpeechButton, SpeechFailureRow } from '../../../lib/ui/speech-controls.tsx';
import type { LookupResult } from './lookup-api.ts';
import {
  closeTopLayer,
  lookUp,
  markSaved,
  refreshExample,
  retryLookup,
  showExample,
  type Layer,
} from './lookup-store.ts';
import { openSelectionTool } from './selection-tool.tsx';

const OFFLINE = "You're offline. Connect to look up words.";
const FAILED = "Couldn't explain this.";

const lemmaClass =
  'min-w-0 flex-[0_1_auto] truncate text-lg leading-[1.3] font-semibold whitespace-nowrap';

function AddWordButton({ layer, saver }: { layer: Layer; saver: WordSaver | null }) {
  const [saving, setSaving] = useState(false);
  const result = layer.result;
  if (result?.savedCardId) {
    return (
      <Button
        variant="flat"
        shape="icon"
        className="text-accent"
        aria-label="Saved to Vocabulary"
        aria-pressed="true"
      >
        <Icon name="check" />
      </Button>
    );
  }
  const save = () => {
    if (!result || !saver) {
      return;
    }
    setSaving(true);
    saver(result)
      .then((cardId) => {
        if (cardId) {
          markSaved(result.id, cardId);
        }
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  return (
    <Button
      variant="flat"
      shape="icon"
      aria-label="Add word"
      aria-busy={saving || undefined}
      disabled={layer.status !== 'ready' || !saver || saving}
      onClick={save}
    >
      <Icon name={saving ? 'loader-circle' : 'plus'} spin={saving} />
    </Button>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <div aria-busy="true">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className={lemmaClass}>{title}</h2>
      </div>
      {['28%', '70%', '92%', '64%'].map((width) => (
        <div
          key={width}
          className="my-2.5 h-3 rounded-[3px] bg-line opacity-70"
          style={{ width }}
        />
      ))}
      <p role="status" className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <Icon name="loader-circle" spin />
        Explaining…
      </p>
    </div>
  );
}

function Failure({ layer }: { layer: Layer }) {
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className={lemmaClass}>{layer.title}</h2>
      </div>
      <RetryStatus
        className="mt-1.5"
        message={layer.status === 'offline' ? OFFLINE : FAILED}
        onRetry={layer.retryable ? () => retryLookup(layer.key) : undefined}
      />
    </div>
  );
}

function Explanation({ layer, result }: { layer: Layer; result: LookupResult }) {
  const speech = useSpeech();
  const selectWords = useRef<HTMLButtonElement>(null);
  const example = result.examples[layer.exampleIndex];
  const exampleLocator = example && {
    kind: 'lookup-example' as const,
    lookupId: result.id,
    exampleId: example.id,
  };
  return (
    <div>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className={lemmaClass}>{result.lemma}</h2>
        <SpeechButton
          speech={speech}
          speechKey="word"
          locator={{ kind: 'lookup-word', lookupId: result.id }}
          label="Play word"
          generatingLabel="Generating word audio"
          variant="flat"
        />
      </div>
      <SpeechFailureRow speech={speech} />
      <p className="mt-[3px] text-[11px] text-muted">{result.pos}</p>
      <p className="my-[11px] text-sm">{result.meaningZh}</p>
      <ExampleCarousel
        examples={result.examples}
        index={layer.exampleIndex}
        onIndexChange={(index) => showExample(layer.key, index)}
        onLookUp={(shown, range) =>
          lookUp(
            {
              context: { kind: 'lookup-example', lookupId: result.id, exampleId: shown.id },
              contextText: shown.text,
              selection: range,
            },
            true,
          )
        }
        controls={
          example && exampleLocator ? (
            <>
              <button
                ref={selectWords}
                type="button"
                className="inline-flex min-h-11 w-11 items-center justify-center"
                aria-label="Select words for lookup"
                onClick={() => {
                  if (selectWords.current) {
                    openSelectionTool({
                      anchor: selectWords.current,
                      context: { kind: 'example', lookup: exampleLocator, text: example.text },
                    });
                  }
                }}
              >
                <Icon name="text-cursor-input" />
              </button>
              <SpeechButton
                speech={speech}
                speechKey={`example:${example.id}`}
                locator={exampleLocator}
                label="Play example"
                generatingLabel="Generating example audio"
              />
              <Button
                shape="icon"
                aria-label="Refresh this example"
                aria-busy={layer.refreshing === example.id || undefined}
                onClick={() => refreshExample(layer.key)}
              >
                <Icon name="refresh-cw" spin={layer.refreshing === example.id} />
              </Button>
            </>
          ) : null
        }
      />
    </div>
  );
}

function Body({ layer }: { layer: Layer }) {
  if (layer.status === 'ready' && layer.result) {
    return <Explanation layer={layer} result={layer.result} />;
  }
  if (layer.status === 'loading') {
    return <Loading title={layer.title} />;
  }
  return <Failure layer={layer} />;
}

export type LookupLayerProps = {
  layer: Layer;
  /** 0 for the top layer, 1 for the one below it and so on. */
  depth: number;
  /** The layer's place from the bottom of the stack. */
  order: number;
  saver: WordSaver | null;
};

export function LookupLayer({ layer, depth, order, saver }: LookupLayerProps) {
  const back = depth > 0;
  return (
    <section
      data-lookup-layer
      aria-label={`Explanation of ${layer.result?.lemma ?? layer.title}`}
      inert={back}
      style={back ? { transform: `translateX(${-8 * depth}px)`, zIndex: order } : { zIndex: order }}
      className={`rounded-[7px] border border-line bg-surface text-xs [overflow-wrap:anywhere] shadow-[0_10px_35px_#00000022] ${
        back
          ? 'pointer-events-none absolute right-2 bottom-0 -left-2'
          : 'pointer-events-auto relative'
      }`}
    >
      <header className="flex items-center gap-1.5 rounded-t-[7px] border-b border-line bg-page pl-[9px] text-[11px] whitespace-nowrap text-muted">
        <span className="min-w-0 flex-1 truncate">Word explanation</span>
        <AddWordButton layer={layer} saver={saver} />
        <Button
          variant="flat"
          shape="icon"
          aria-label="Close this explanation"
          onClick={closeTopLayer}
        >
          <Icon name="x" />
        </Button>
      </header>
      <div className="p-[11px]">
        <Body layer={layer} />
      </div>
    </section>
  );
}
