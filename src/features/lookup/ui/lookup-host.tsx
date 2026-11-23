'use client';

// Where explanations appear (.docs/design/screens.md, 查词浮窗 and 嵌套浮窗): a stack of cards
// nearly as wide as the screen, their bottom just above the screen's bottom bar (the reader's
// player) or just above the screen's bottom edge without one, each as tall as its content. The
// host provides the lookup bridge, so the reader, card details and review questions open
// explanations and the Select words helper through it.
//
// Pressing a blank part of the screen closes the top explanation, and so does Escape; pressing
// text that can be looked up, a control or a panel does not. Moving to another screen closes every
// explanation and the helper, and so does logging out, which also stops word audio.
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useBottomBarHeight } from '../../../lib/ui/bottom-bar.ts';
import { provideLookup, useWordSaver } from '../../../lib/ui/lookup-bridge.ts';
import { onSignOut } from '../../../lib/ui/sign-out-cleanup.ts';
import { stopSpeech } from '../../../lib/ui/speech-audio.ts';
import { LookupLayer } from './lookup-layer.tsx';
import {
  closeAllLayers,
  closeTopLayer,
  connectLookups,
  lookUp,
  useLookupStore,
} from './lookup-store.ts';
import {
  closeSelectionTool,
  isSelectionToolOpen,
  openSelectionTool,
  SelectionTool,
} from './selection-tool.tsx';

/** What pressing does not count as pressing a blank part of the screen. */
const KEEPS_EXPLANATION =
  '[data-lookup-layer],[data-lookup-text],button,input,select,textarea,a,label,dialog,[role="dialog"]';

const SCREEN_GAP_PX = 16;

function closeEverything() {
  closeAllLayers();
  closeSelectionTool();
}

function useClosingGestures() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        useLookupStore.getState().layers.length > 0 &&
        !isSelectionToolOpen() &&
        target instanceof Element &&
        !target.closest(KEEPS_EXPLANATION)
      ) {
        closeTopLayer();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSelectionToolOpen()) {
        closeTopLayer();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

function Stack() {
  const layers = useLookupStore((state) => state.layers);
  const barHeight = useBottomBarHeight();
  const saver = useWordSaver();
  if (layers.length === 0) {
    return null;
  }
  return (
    <div
      className="pointer-events-none fixed right-[max(10px,calc((100vw-600px)/2+10px))] z-20 w-[calc(min(100vw,600px)-28px)]"
      style={{
        bottom:
          barHeight > 0
            ? barHeight + SCREEN_GAP_PX
            : `calc(${SCREEN_GAP_PX}px + env(safe-area-inset-bottom))`,
      }}
    >
      {layers.map((layer, order) => (
        <LookupLayer
          key={layer.key}
          layer={layer}
          depth={layers.length - 1 - order}
          order={order}
          saver={saver}
        />
      ))}
    </div>
  );
}

export function LookupHost() {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  useEffect(() => connectLookups(queryClient), [queryClient]);

  useEffect(
    () => provideLookup({ lookUp: (target) => lookUp(target, false), openSelectionTool }),
    [],
  );

  useEffect(
    () =>
      onSignOut(() => {
        closeEverything();
        stopSpeech();
      }),
    [],
  );

  useEffect(() => {
    closeEverything();
  }, [pathname]);

  useClosingGestures();

  return (
    <>
      <Stack />
      <SelectionTool />
    </>
  );
}
