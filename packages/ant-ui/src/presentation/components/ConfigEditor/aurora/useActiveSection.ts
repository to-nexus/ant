
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Track the currently visible section in a scrollable container.
 *
 * Uses IntersectionObserver with `rootMargin: '0px 0px -70% 0px'` so a
 * section becomes "active" once it crosses the top 30% of the viewport.
 *
 * Returns a tuple `[active, setActive]` so consumers can drive the
 * active id imperatively (e.g. when a TOC item is clicked) in addition
 * to the scroll-driven IntersectionObserver updates. This is required
 * because (1) the last section may never reach the top 30% band when
 * the scroller is at its maxScroll, (2) zero-height anchor `<div>`s
 * produce unreliable intersection events across browsers, and (3)
 * during a programmatic smooth scroll initiated by the returned setter,
 * the observer would otherwise emit intermediate-section intersections
 * that overwrite the click target; to prevent this, calls to the
 * returned setter open a click-lock window that suppresses
 * observer-driven updates until the scroller emits `scrollend` (with a
 * ~700 ms `setTimeout` fallback for browsers that lack `scrollend`,
 * e.g. Safari < 18). Free scrolling is unaffected — the observer
 * continues to drive active state through the same setter.
 *
 * @param sectionIds Ordered list of DOM element ids to observe.
 * @param scrollerRef Ref to the scrolling ancestor (null → viewport root).
 * @returns Tuple of [activeId, setActiveId]; `setActiveId` is intended
 *   for click handlers and programmatic scrolling.
 */
export function useActiveSection(
  sectionIds: string[],
  scrollerRef?: RefObject<HTMLElement | null>,
): readonly [string, (id: string) => void] {
  const [active, setActive] = useState<string>(sectionIds[0] ?? '');
  const clickLockRef = useRef<boolean>(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sectionIds.length) return;

    const root = scrollerRef?.current ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (clickLockRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      {
        root,
        rootMargin: '0px 0px -70% 0px',
        threshold: [0, 0.1, 0.5],
      },
    );

    const scrollTarget: EventTarget = scrollerRef?.current ?? window;
    const handleScrollEnd = () => {
      clickLockRef.current = false;
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
    scrollTarget.addEventListener('scrollend', handleScrollEnd);

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      scrollTarget.removeEventListener('scrollend', handleScrollEnd);
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIds.join('|'), scrollerRef]);

  const setActiveWithLock = useCallback((id: string) => {
    setActive(id);
    clickLockRef.current = true;
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = setTimeout(() => {
      clickLockRef.current = false;
      clearTimerRef.current = null;
    }, 700);
  }, []);

  return [active, setActiveWithLock] as const;
}
