
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Track the currently visible section in a scrollable container.
 *
 * Uses IntersectionObserver with `rootMargin: '0px 0px -70% 0px'` so a
 * section becomes "active" once it crosses the top 30% of the viewport.
 *
 * @param sectionIds Ordered list of DOM element ids to observe.
 * @param scrollerRef Ref to the scrolling ancestor (null → viewport root).
 * @returns The id of the section currently nearest the top.
 */
export function useActiveSection(
  sectionIds: string[],
  scrollerRef?: RefObject<HTMLElement | null>,
): string {
  const [active, setActive] = useState<string>(sectionIds[0] ?? '');

  useEffect(() => {
    if (!sectionIds.length) return;

    const root = scrollerRef?.current ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
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

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIds.join('|'), scrollerRef]);

  return active;
}
