'use client';

// The Select words helper (.docs/design/screens.md, 选词, screen 64): a small panel next to the
// button that opened it, titled `Select words` with a close button; a `Sentence` choice when
// there is more than one sentence or part to choose from; `From` and `To` listing the words of
// that sentence, `To` never before `From`; and `Look up`. Opening it calls nothing; Look up looks
// the chosen words up in their sentence, or in their example.
import { useRef, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../../lib/ui/button.tsx';
import type { LookupTarget, SelectionToolRequest } from '../../../lib/ui/lookup-bridge.ts';
import { Popover, PopoverTitle } from '../../../lib/ui/popover.tsx';
import { selectableWords } from '../domain/selection.ts';
import { lookUp } from './lookup-store.ts';

type OpenTool = { id: number; request: SelectionToolRequest };

const useSelectionToolStore = create<{ open: OpenTool | null }>(() => ({ open: null }));

let lastId = 0;

export function openSelectionTool(request: SelectionToolRequest): void {
  lastId += 1;
  useSelectionToolStore.setState({ open: { id: lastId, request } });
}

export function closeSelectionTool(): void {
  useSelectionToolStore.setState({ open: null });
}

export function isSelectionToolOpen(): boolean {
  return useSelectionToolStore.getState().open !== null;
}

/** A sentence or part to choose words from: its text and how a range of it is looked up. */
type Choice = { text: string; target: (start: number, end: number) => LookupTarget };

function choicesOf(context: SelectionToolRequest['context']): Choice[] {
  if (context.kind === 'article') {
    return context.sentences.map((sentence) => ({
      text: sentence.text,
      target: (start, end) => ({
        context: {
          kind: 'article',
          articleId: context.articleId,
          firstSentence: sentence.index,
          lastSentence: sentence.index,
        },
        contextText: sentence.text,
        selection: { start, end },
      }),
    }));
  }
  const segments = context.segments ?? [{ start: 0, text: context.text }];
  return segments.map((segment) => ({
    text: segment.text,
    target: (start, end) => ({
      context: context.lookup,
      contextText: context.text,
      selection: { start: segment.start + start, end: segment.start + end },
    }),
  }));
}

const fieldClass = 'mb-2.5 grid min-w-0 gap-1 text-[11px]';
const selectClass =
  'min-h-11 w-full max-w-full min-w-0 rounded border border-line bg-surface px-3 text-base text-ink';

function Tool({ request }: { request: SelectionToolRequest }) {
  const anchor = useRef<HTMLElement>(request.anchor);
  const choices = choicesOf(request.context);
  const [choice, setChoice] = useState(0);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const words = selectableWords(choices[choice]?.text ?? '');
  const nested =
    request.context.kind === 'example' && request.context.lookup.kind === 'lookup-example';

  const lookUpChosen = () => {
    const first = words[from];
    const last = words[to];
    closeSelectionTool();
    if (first && last) {
      lookUp(choices[choice].target(first.start, last.end), nested);
    }
  };

  return (
    <Popover anchor={anchor} label="Select words" width={280} onClose={closeSelectionTool}>
      <PopoverTitle
        title="Select words"
        closeLabel="Close selection"
        onClose={closeSelectionTool}
      />
      {choices.length > 1 ? (
        <label className={fieldClass}>
          Sentence
          <select
            className={selectClass}
            value={choice}
            onChange={(event) => {
              setChoice(Number(event.target.value));
              setFrom(0);
              setTo(0);
            }}
          >
            {choices.map((item, index) => (
              <option key={index} value={index}>
                {item.text}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className={fieldClass}>
          From
          <select
            className={selectClass}
            value={from}
            onChange={(event) => {
              const next = Number(event.target.value);
              setFrom(next);
              setTo((current) => Math.max(current, next));
            }}
          >
            {words.map((word, index) => (
              <option key={word.start} value={index}>
                {word.text}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          To
          <select
            className={selectClass}
            value={to}
            onChange={(event) => setTo(Number(event.target.value))}
          >
            {words.map((word, index) => (
              <option key={word.start} value={index} disabled={index < from}>
                {word.text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button variant="primary" disabled={words.length === 0} onClick={lookUpChosen}>
        Look up
      </Button>
    </Popover>
  );
}

/** The open Select words helper, or nothing. */
export function SelectionTool() {
  const open = useSelectionToolStore((state) => state.open);
  return open ? <Tool key={open.id} request={open.request} /> : null;
}
