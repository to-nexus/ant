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

  const handleResizeEnd = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(false);
    localStorage.setItem(STORAGE_KEY, textareaHeight.toString());
    window.dispatchEvent(new Event('resize'));
  }, [textareaHeight]);

  return {
    textareaHeight,
    isResizing,
    MIN_HEIGHT,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
  };
}
