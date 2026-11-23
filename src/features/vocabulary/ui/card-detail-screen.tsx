'use client';

// Card details (.docs/design/screens.md, 词卡详情, screens 42 and 70): the close button, the lemma
// once with Play word, the part of speech and the Chinese meaning; the examples as in an
// explanation, with Select words, Play example and Refresh, arrows and swipes; and the three
// progress groups. There is no delete button. Every word of an example can be looked up, and the
// explanation sits just above the screen's bottom edge.
//
// Closing goes back to Vocabulary as it was, with the focus on this card. A card that is gone,
// found when it loads, refreshes an example or plays audio, sends the person back to Vocabulary,
// which reads its list again, with `This word was deleted.`. Another failure to load shows in
// place of the card with Retry; the close button stays.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hasErrorCode, offersRetry } from '../../../lib/api/client.ts';
import { Button } from '../../../lib/ui/button.tsx';
import { ExampleCarousel } from '../../../lib/ui/example-carousel.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { useLookupBridge } from '../../../lib/ui/lookup-bridge.ts';
import { CHANGED_ELSEWHERE, NEW_EXAMPLE_FAILED } from '../../../lib/ui/messages.ts';
import { useCloseTo } from '../../../lib/ui/navigation-history.tsx';
import { RetryStatus } from '../../../lib/ui/retry-status.tsx';
import { useSpeech } from '../../../lib/ui/speech-audio.ts';
import { SpeechButton, SpeechFailureRow } from '../../../lib/ui/speech-controls.tsx';
import { showToast } from '../../../lib/ui/toast.tsx';
import { returnToVocabulary } from '../../../lib/ui/vocabulary-return.ts';
import { cardTitleSelector, VOCABULARY_PATH } from './paths.ts';
import { ProgressGroups } from './progress-groups.tsx';
import {
  cardKey,
  dropOtherLists,
  requestNewCardExample,
  useCard,
  type CardDetail,
  type CardExample,
} from './vocabulary-api.ts';

const LOAD_FAILED = "Couldn't load this word.";
const DELETED = 'This word was deleted.';

/** Back to Vocabulary, once, after the card turned out to be gone: the list is read again. */
function useWordDeleted() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const handled = useRef(false);
  return useCallback(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;
    dropOtherLists(queryClient);
    returnToVocabulary(null);
    showToast(DELETED);
    router.replace(VOCABULARY_PATH);
  }, [queryClient, router]);
}

function useExampleRefresh(card: CardDetail, onDeleted: () => void) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const put = (example: CardExample) =>
    queryClient.setQueryData<CardDetail>(cardKey(card.id), (current) =>
      current
        ? {
            ...current,
            examples: current.examples.map((one) =>
              one.position === example.position ? example : one,
            ),
          }
        : current,
    );

  const send = async (exampleId: string, operationId: string) => {
    setRefreshing(exampleId);
    try {
      put(await requestNewCardExample(card.id, exampleId, operationId));
    } catch (error) {
      if (hasErrorCode(error, 'NOT_FOUND')) {
        onDeleted();
      } else if (hasErrorCode(error, 'CONFLICT')) {
        showToast(CHANGED_ELSEWHERE);
        void queryClient.invalidateQueries({ queryKey: cardKey(card.id) });
      } else {
        const retry = offersRetry(error) ? () => void send(exampleId, operationId) : undefined;
        showToast(NEW_EXAMPLE_FAILED, { retry });
      }
    } finally {
      setRefreshing(null);
    }
  };

  const refresh = (exampleId: string) => {
    if (refreshing === null) {
      void send(exampleId, crypto.randomUUID());
    }
  };
  return { refreshing, refresh };
}

function CardContent({ card, onDeleted }: { card: CardDetail; onDeleted: () => void }) {
  const speech = useSpeech();
  const bridge = useLookupBridge();
  const selectWords = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(0);
  const { refreshing, refresh } = useExampleRefresh(card, onDeleted);
  const shownIndex = Math.min(index, Math.max(0, card.examples.length - 1));
  const example = card.examples[shownIndex];
  const gone = speech.failure?.code === 'NOT_FOUND';

  useEffect(() => {
    if (gone) {
      onDeleted();
    }
  }, [gone, onDeleted]);

  const exampleLocator = example && {
    kind: 'vocabulary-example' as const,
    cardId: card.id,
    exampleId: example.id,
  };

  return (
    <>
      <div className="border-b border-line px-3 py-[15px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="min-w-0 flex-[0_1_auto] truncate text-xl leading-[1.3] font-semibold">
            {card.lemma}
          </h1>
          <SpeechButton
            speech={speech}
            speechKey="word"
            locator={{ kind: 'card-word', cardId: card.id }}
            label="Play word"
            generatingLabel="Generating word audio"
            variant="flat"
          />
        </div>
        {gone ? null : <SpeechFailureRow speech={speech} />}
        <p className="mt-[3px] text-[11px] text-muted">{card.pos}</p>
        <p className="my-[11px] text-sm">{card.meaningZh}</p>
      </div>
      <div className="p-4">
        <ExampleCarousel
          examples={card.examples}
          index={shownIndex}
          onIndexChange={setIndex}
          onLookUp={(shown, range) =>
            bridge?.lookUp({
              context: { kind: 'vocabulary-example', cardId: card.id, exampleId: shown.id },
              contextText: shown.text,
              selection: range,
            })
          }
          controls={
            example && exampleLocator ? (
              <>
                <button
                  ref={selectWords}
                  type="button"
                  className="inline-flex min-h-11 w-11 items-center justify-center disabled:opacity-45"
                  aria-label="Select words for lookup"
                  disabled={!bridge}
                  onClick={() => {
                    if (selectWords.current) {
                      bridge?.openSelectionTool({
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
                  locator={{ kind: 'card-example', cardId: card.id, exampleId: example.id }}
                  label="Play example"
                  generatingLabel="Generating example audio"
                />
                <Button
                  shape="icon"
                  aria-label="Refresh this example"
                  aria-busy={refreshing === example.id || undefined}
                  onClick={() => refresh(example.id)}
                >
                  <Icon name="refresh-cw" spin={refreshing === example.id} />
                </Button>
              </>
            ) : null
          }
        />
        <ProgressGroups progress={card.progress} now={new Date()} />
      </div>
    </>
  );
}

export function CardDetailScreen({ cardId }: { cardId: string }) {
  const card = useCard(cardId);
  const close = useCloseTo(VOCABULARY_PATH);
  const wordDeleted = useWordDeleted();
  const missing = hasErrorCode(card.error, 'NOT_FOUND');

  useEffect(() => {
    if (missing) {
      wordDeleted();
    }
  }, [missing, wordDeleted]);

  let content = null;
  if (card.data) {
    content = <CardContent card={card.data} onDeleted={wordDeleted} />;
  } else if (card.isError && !missing) {
    content = (
      <div className="px-3.5 py-[25px]">
        <RetryStatus
          message={LOAD_FAILED}
          onRetry={offersRetry(card.error) ? () => void card.refetch() : undefined}
        />
      </div>
    );
  }

  return (
    <main className="px-3 py-[15px]">
      <div className="mb-1.5 flex min-h-11 items-center justify-end">
        <Button
          variant="flat"
          shape="icon"
          aria-label="Close word and return to Vocabulary"
          onClick={() => {
            returnToVocabulary(cardTitleSelector(cardId));
            close();
          }}
        >
          <Icon name="x" />
        </Button>
      </div>
      <div className="min-w-0 rounded-[5px] border border-line bg-surface">{content}</div>
    </main>
  );
}
