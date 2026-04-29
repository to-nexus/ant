import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Walk up the DOM from `node` until we hit the first ancestor that is itself
 * vertically scrollable (overflow-y auto/scroll AND content actually exceeds
 * its viewport). Returns null if no such ancestor exists.
 *
 * This lets a single "follow tail" hook serve both layouts where the list
 * itself owns the scrollbar (per-column scroll) and layouts where a higher
 * ancestor owns it (board-level scroll under a horizontal split).
 */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = node;
  while (cur && cur !== document.body) {
    const overflowY = window.getComputedStyle(cur).overflowY;
    const isScrollable = overflowY === 'auto' || overflowY === 'scroll';
    if (isScrollable && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}

interface UseAutoScrollOnGrowthOptions {
  /**
   * If true (default), the very first 0 → N transition does NOT auto-scroll
   * (an empty list filling up has no "tail" to follow yet).
   */
  skipFromZero?: boolean;
  /** Disable the effect entirely. */
  disabled?: boolean;
}

/**
 * When `length` grows, smooth-scroll the nearest scrollable ancestor of
 * `containerRef.current` to its bottom. No-ops when `length` shrinks or
 * stays equal.
 *
 * Always-follow policy: this hook does NOT inspect the user's current scroll
 * position. Callers who want a "near-bottom only" behaviour should pass
 * `disabled` based on their own check.
 */
export function useAutoScrollOnGrowth(
  containerRef: RefObject<HTMLElement | null>,
  length: number,
  options?: UseAutoScrollOnGrowthOptions,
): void {
  const skipFromZero = options?.skipFromZero ?? true;
  const disabled = options?.disabled ?? false;
  const prevLengthRef = useRef(length);

  useLayoutEffect(() => {
    const prev = prevLengthRef.current;
    prevLengthRef.current = length;

    if (disabled) return;
    if (length <= prev) return;
    if (skipFromZero && prev === 0) return;

    const target = findScrollParent(containerRef.current);
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
  }, [length, containerRef, skipFromZero, disabled]);
}
