/**
 * useResizeHandlers - Resize handlers for Explorer and Chat panels
 * 
 * Manages mouse move/up events for resizing panels with throttling for performance
 */

import { useEffect, useRef } from 'react';
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

  // ✅ Throttling: RAF를 사용하여 최대 60fps로 제한
  const rafIdExplorerRef = useRef<number | null>(null);
  const rafIdChatRef = useRef<number | null>(null);

  // Explorer resize handler (left side)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingExplorer) return;

      // ✅ Cancel previous RAF if exists
      if (rafIdExplorerRef.current !== null) {
        cancelAnimationFrame(rafIdExplorerRef.current);
      }

      // ✅ Throttle with requestAnimationFrame (~60fps)
      rafIdExplorerRef.current = requestAnimationFrame(() => {
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
      });
    };

    const handleMouseUp = () => {
      // ✅ Cancel any pending RAF
      if (rafIdExplorerRef.current !== null) {
        cancelAnimationFrame(rafIdExplorerRef.current);
        rafIdExplorerRef.current = null;
      }
      
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
      
      // ✅ Cleanup RAF on unmount
      if (rafIdExplorerRef.current !== null) {
        cancelAnimationFrame(rafIdExplorerRef.current);
      }
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

      // ✅ Cancel previous RAF if exists
      if (rafIdChatRef.current !== null) {
        cancelAnimationFrame(rafIdChatRef.current);
      }

      // ✅ Throttle with requestAnimationFrame (~60fps)
      rafIdChatRef.current = requestAnimationFrame(() => {
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
      });
    };

    const handleMouseUp = () => {
      // ✅ Cancel any pending RAF
      if (rafIdChatRef.current !== null) {
        cancelAnimationFrame(rafIdChatRef.current);
        rafIdChatRef.current = null;
      }
      
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
      
      // ✅ Cleanup RAF on unmount
      if (rafIdChatRef.current !== null) {
        cancelAnimationFrame(rafIdChatRef.current);
      }
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

