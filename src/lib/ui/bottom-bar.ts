// The bar a screen keeps at the bottom, such as the reader's player (.docs/design/screens.md, 查词
// 浮窗): panels that sit at the bottom of the screen, like the lookup explanation, go just above
// it, and just above the screen's bottom edge on screens without one. The bar reports its height
// while it is shown; the panels read it.
import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';

const useBottomBarStore = create<{ height: number }>(() => ({ height: 0 }));

/** Reports the element's height as the bottom bar's while the calling component is mounted. */
export function useBottomBar(element: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bar = element.current;
    if (!bar) {
      return;
    }
    const report = () => useBottomBarStore.setState({ height: bar.offsetHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      useBottomBarStore.setState({ height: 0 });
    };
  }, [element]);
}

/** The height of the bottom bar on the screen, 0 without one. */
export function useBottomBarHeight(): number {
  return useBottomBarStore((state) => state.height);
}
