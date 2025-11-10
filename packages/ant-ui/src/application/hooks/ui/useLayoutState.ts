/**
 * useLayoutState - Layout state management for App
 * 
 * Manages:
 * - Explorer panel (width, collapsed state)
 * - Chat panel (width, collapsed state)
 * - Resizing states
 */

import { useState } from 'react';

export interface LayoutState {
  // Explorer panel
  explorerWidth: number;
  isExplorerCollapsed: boolean;
  isResizingExplorer: boolean;
  setExplorerWidth: (width: number) => void;
  setIsExplorerCollapsed: (collapsed: boolean) => void;
  setIsResizingExplorer: (resizing: boolean) => void;
  
  // Chat panel
  chatWidth: number;
  isChatCollapsed: boolean;
  isResizingChat: boolean;
  setChatWidth: (width: number) => void;
  setIsChatCollapsed: (collapsed: boolean) => void;
  setIsResizingChat: (resizing: boolean) => void;
  
  // Constants
  MIN_EXPLORER_WIDTH: number;
  MAX_EXPLORER_WIDTH: number;
  MIN_CHAT_WIDTH: number;
  MAX_CHAT_WIDTH: number;
}

export function useLayoutState(): LayoutState {
  // Explorer state
  const [explorerWidth, setExplorerWidth] = useState(320); // 80 * 4 = 320px (w-80)
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);
  
  // Chat state
  const [chatWidth, setChatWidth] = useState(400);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);
  
  // Constants
  const MIN_EXPLORER_WIDTH = 160;
  const MAX_EXPLORER_WIDTH = 600;
  const MIN_CHAT_WIDTH = 160;
  const MAX_CHAT_WIDTH = 1000;
  
  return {
    explorerWidth,
    isExplorerCollapsed,
    isResizingExplorer,
    setExplorerWidth,
    setIsExplorerCollapsed,
    setIsResizingExplorer,
    
    chatWidth,
    isChatCollapsed,
    isResizingChat,
    setChatWidth,
    setIsChatCollapsed,
    setIsResizingChat,
    
    MIN_EXPLORER_WIDTH,
    MAX_EXPLORER_WIDTH,
    MIN_CHAT_WIDTH,
    MAX_CHAT_WIDTH,
  };
}

