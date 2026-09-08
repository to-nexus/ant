/**
 * Drag-resizable panel width — localStorage-persisted, RAF-throttled, with
 * the document `mouseup` + window `blur` end-guards (an overlay-only mouseup
 * leaks the drag state when the button is released outside the window; see
 * `chat/hooks/useResizableHeight.ts`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from '@/domain/store/storage';

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
export const AGENT_TREE_DEFAULT_WIDTH = 224;

export type ResizeGrow = 'right' | 'left';

export interface ResizableWidthOptions {
  storageKey?: string;
  min?: number;
  max?: number;
  defaultWidth?: number;
  /** Which way the panel grows when the handle moves right — `left` for a right-docked panel. */
  grow?: ResizeGrow;
}

/** Pure delta → clamped width; `grow: 'left'` inverts the pointer delta (a right-docked drawer). */
export function nextResizedWidth(startWidth: number, startX: number, clientX: number, grow: ResizeGrow, min: number, max: number): number {
  const delta = grow === 'left' ? startX - clientX : clientX - startX;
  return Math.min(max, Math.max(min, startWidth + delta));
}

/**
 * Defaults describe the agent tree (the first caller); a second panel passes
 * its own key and bounds rather than forking the hook.
 */
export function useResizableWidth({
  storageKey = STORAGE_KEYS.AGENT_TREE_WIDTH,
  min = MIN_WIDTH,
  max = MAX_WIDTH,
  defaultWidth = AGENT_TREE_DEFAULT_WIDTH,
  grow = 'right',
}: ResizableWidthOptions = {}) {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(loadFromStorage(storageKey));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const widthRef = useRef(width);
  widthRef.current = width;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = widthRef.current;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setWidth(nextResizedWidth(startWidthRef.current, startXRef.current, e.clientX, grow, min, max));
      });
    };
    const end = () => {
      setIsResizing(false);
      saveToStorage(storageKey, widthRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
  }, [isResizing, storageKey, min, max, grow]);

  return { width, isResizing, startResize };
}
