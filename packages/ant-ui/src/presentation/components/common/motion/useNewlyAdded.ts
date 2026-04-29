import { useCallback, useEffect, useRef, useState } from 'react';
import { NEWLY_ADDED_AUTO_CLEAR_MS } from './motionPresets';

export interface UseNewlyAddedResult {
  /** IDs whose first observation happened AFTER the initial mount. */
  newlyAddedIds: Set<string>;
  /** Manually evict an id (e.g. from an `onAnimationComplete` callback). */
  clear: (id: string) => void;
}

interface UseNewlyAddedOptions {
  /** Override the auto-clear delay; defaults to {@link NEWLY_ADDED_AUTO_CLEAR_MS}. */
  autoClearMs?: number;
}

/**
 * Tracks which items in a streamed collection are *newly added* relative to
 * the previous render, so a consumer can drive a one-shot entrance animation
 * only for those items.
 *
 * Behaviour:
 * - First observation seeds the baseline silently — pre-existing items never
 *   fire the animation on mount.
 * - When the collection shrinks or the entire id-set is replaced (e.g. a
 *   decompose retry empties + repopulates the queue), the baseline resets
 *   without firing animations on the replacement items.
 * - Each newly-added id auto-evicts after `autoClearMs` so consumers don't
 *   need to manage timers themselves; `clear` is exposed for callers that
 *   want to evict earlier (e.g. on `onAnimationComplete`).
 */
export function useNewlyAdded<T>(
  items: readonly T[] | undefined,
  getId: (item: T) => string,
  options?: UseNewlyAddedOptions,
): UseNewlyAddedResult {
  const autoClearMs = options?.autoClearMs ?? NEWLY_ADDED_AUTO_CLEAR_MS;

  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(() => new Set());
  const previousIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const currentIds = new Set((items ?? []).map(getId));

    if (isInitialLoadRef.current) {
      previousIdsRef.current = currentIds;
      isInitialLoadRef.current = false;
      return;
    }

    const prev = previousIdsRef.current;

    // Shrink-or-replace ⇒ treat as reset (e.g. retry stream emptied the queue).
    const isReplacement =
      currentIds.size < prev.size ||
      (currentIds.size > 0 && [...currentIds].every(id => !prev.has(id)));
    if (isReplacement) {
      previousIdsRef.current = currentIds;
      return;
    }

    const adds: string[] = [];
    currentIds.forEach(id => {
      if (!prev.has(id)) adds.push(id);
    });
    if (adds.length === 0) return;

    setNewlyAddedIds(prevSet => {
      const next = new Set(prevSet);
      adds.forEach(id => next.add(id));
      return next;
    });
    previousIdsRef.current = currentIds;

    adds.forEach(id => {
      const existing = timersRef.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      const tid = window.setTimeout(() => {
        setNewlyAddedIds(prevSet => {
          if (!prevSet.has(id)) return prevSet;
          const next = new Set(prevSet);
          next.delete(id);
          return next;
        });
        timersRef.current.delete(id);
      }, autoClearMs);
      timersRef.current.set(id, tid);
    });
  }, [items, getId, autoClearMs]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const clear = useCallback((id: string) => {
    setNewlyAddedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const tid = timersRef.current.get(id);
    if (tid !== undefined) {
      clearTimeout(tid);
      timersRef.current.delete(id);
    }
  }, []);

  return { newlyAddedIds, clear };
}
