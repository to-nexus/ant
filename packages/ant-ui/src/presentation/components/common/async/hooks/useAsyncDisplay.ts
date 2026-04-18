import { useEffect, useRef, useState } from 'react';
import type { AsyncStatus } from '@/domain/async';

export interface DisplayTiming {
  delayMs?: number;      // gate before showing the loading UI (default 200ms)
  minShowMs?: number;    // minimum visible duration once shown (default 400ms)
  longWaitMs?: number;   // threshold for "still loading…" affordance (default 5000ms)
}

export interface DisplayState {
  showLoading: boolean;
  longWait: boolean;
}

/**
 * Coordinates the delay / min-visible / long-wait timing of an async UI.
 *
 * - `delayMs` suppresses the loading state entirely when a fetch resolves
 *   faster than the threshold (no flash).
 * - `minShowMs` keeps the loading UI visible long enough to avoid a flicker
 *   once it has been shown.
 * - `longWaitMs` flips `longWait=true` so surfaces can upgrade their message
 *   ("still loading…" + Cancel/Retry).
 *
 * Stale-timeout-as-error is NOT modelled here. Only slice actions may
 * transition to `error`.
 */
export function useAsyncDisplay(status: AsyncStatus, timing: DisplayTiming = {}): DisplayState {
  const { delayMs = 200, minShowMs = 400, longWaitMs = 5000 } = timing;
  const [showLoading, setShowLoading] = useState(false);
  const [longWait, setLongWait] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const showLoadingRef = useRef(false);
  showLoadingRef.current = showLoading;

  useEffect(() => {
    if (status === 'loading') {
      const delayTimer = setTimeout(() => {
        setShowLoading(true);
        shownAtRef.current = Date.now();
      }, delayMs);
      const longWaitTimer = setTimeout(() => {
        if (showLoadingRef.current || status === 'loading') setLongWait(true);
      }, longWaitMs);
      return () => {
        clearTimeout(delayTimer);
        clearTimeout(longWaitTimer);
      };
    }

    // status is one of 'idle' | 'ready' | 'empty' | 'error'. Hide with
    // min-visible guard so a loading UI never disappears mid-flash.
    if (!showLoadingRef.current) {
      setLongWait(false);
      return;
    }
    const shownFor = shownAtRef.current ? Date.now() - shownAtRef.current : 0;
    const remain = Math.max(0, minShowMs - shownFor);
    const hide = setTimeout(() => {
      setShowLoading(false);
      setLongWait(false);
      shownAtRef.current = null;
    }, remain);
    return () => clearTimeout(hide);
  }, [status, delayMs, minShowMs, longWaitMs]);

  return { showLoading, longWait };
}
