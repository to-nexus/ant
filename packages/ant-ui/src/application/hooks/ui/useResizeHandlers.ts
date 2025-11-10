/**
 * useResizeHandlers - Resize handlers for Explorer and Chat panels
 * 
 * Manages mouse move/up events for resizing panels
 */

import { useEffect } from 'react';
import type { LayoutState } from './useLayoutState';

export function useResizeHandlers(layout: LayoutState) {
  const {
    isResizingExplorer,
    isResizingChat,
    setExplorerWidth,
    setChatWidth,
    setIsExplorerCollapsed,
    setIsChatCollapsed,
    setIsResizingExplorer,
    setIsResizingChat,
    MIN_EXPLORER_WIDTH,
    MAX_EXPLORER_WIDTH,
    MIN_CHAT_WIDTH,
    MAX_CHAT_WIDTH,
  } = layout;

  // Explorer resize handler (left side)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingExplorer) return;

      const newWidth = e.clientX;
      
      // 최소 너비보다 작으면 접기
      if (newWidth < MIN_EXPLORER_WIDTH) {
        setIsExplorerCollapsed(true);
        setIsResizingExplorer(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      // 최대 너비 제한
      const constrainedWidth = Math.min(newWidth, MAX_EXPLORER_WIDTH);
      setExplorerWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizingExplorer(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingExplorer) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isResizingExplorer,
    MIN_EXPLORER_WIDTH,
    MAX_EXPLORER_WIDTH,
    setExplorerWidth,
    setIsExplorerCollapsed,
    setIsResizingExplorer,
  ]);

  // Chat resize handler (right side)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingChat) return;

      // Calculate width from right edge (window.innerWidth - clientX)
      const newWidth = window.innerWidth - e.clientX;
      
      // 최소 너비보다 작으면 접기
      if (newWidth < MIN_CHAT_WIDTH) {
        setIsChatCollapsed(true);
        setIsResizingChat(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      // 최대 너비 제한
      const constrainedWidth = Math.min(newWidth, MAX_CHAT_WIDTH);
      setChatWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizingChat(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingChat) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isResizingChat,
    MIN_CHAT_WIDTH,
    MAX_CHAT_WIDTH,
    setChatWidth,
    setIsChatCollapsed,
    setIsResizingChat,
  ]);
}

