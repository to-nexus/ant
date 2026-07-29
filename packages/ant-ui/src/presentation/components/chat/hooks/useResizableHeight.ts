import { useState, useRef, useEffect, useCallback } from 'react';

const MIN_HEIGHT = 40;
const STORAGE_KEY = 'chatInputHeight';

/**
 * Manages textarea resize state: persisted height, drag tracking,
 * body cursor/select overrides during resize.
 */
export function useResizableHeight() {
  const [textareaHeight, setTextareaHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : MIN_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeBaseRef = useRef(0);

  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textareaEl = document.querySelector('[data-chat-input]') as HTMLElement;
    if (textareaEl) {
      resizeBaseRef.current = textareaEl.getBoundingClientRect().bottom;
    }
    setIsResizing(true);
  }, []);

  const handleResizeMove = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const newHeight = Math.max(MIN_HEIGHT, resizeBaseRef.current - e.clientY);
    setTextareaHeight(newHeight);
  }, []);

  // Read the latest height without re-subscribing the document listener on
  // every pixel of the drag.
  const heightRef = useRef(textareaHeight);
  heightRef.current = textareaHeight;

  const finishResize = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem(STORAGE_KEY, heightRef.current.toString());
    window.dispatchEvent(new Event('resize'));
  }, []);

  // The resize overlay's own `onMouseUp` is not a sufficient exit: release the
  // button outside the window (or lose focus mid-drag) and it never fires,
  // leaving a transparent `fixed inset-0; z-index: 9999` overlay mounted that
  // silently swallows every click in the app. Same pattern as
  // `application/hooks/ui/useResizeHandlers.ts`.
  useEffect(() => {
    if (!isResizing) return;
    const end = () => finishResize();
    document.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
    return () => {
      document.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
  }, [isResizing, finishResize]);

  const handleResizeEnd = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    finishResize();
  }, [finishResize]);

  return {
    textareaHeight,
    isResizing,
    MIN_HEIGHT,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  };
}
