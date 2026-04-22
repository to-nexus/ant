/**
 * useLayoutState - Layout state management for App
 *
 * Manages:
 * - Explorer panel (width, collapsed state)
 * - Chat panel (width, collapsed state, expand-from-collapsed with standard-width restore)
 * - Resizing states
 *
 * Chat minimum / standard widths are SSOT'd in
 * `presentation/components/chat/AgentJobToolbar.tsx` so that the toolbar's
 * own constraints and the sidebar's layout constraints stay in sync.
 */

import { useCallback, useState } from 'react';
import {
  CHAT_SIDEBAR_MIN_WIDTH_PX,
  CHAT_SIDEBAR_STANDARD_WIDTH_PX,
} from '@/presentation/components/chat/AgentJobToolbar';

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
  /**
   * Expand the chat sidebar from the collapsed state. If the last-used width
   * is below `CHAT_SIDEBAR_STANDARD_WIDTH_PX` (e.g. the user had dragged the
   * panel narrow before collapsing), bump it back up to the standard width
   * so the footer has room for every button. Otherwise preserve the user's
   * chosen width.
   */
  expandChat: () => void;

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

  // Chat state — initial width is the "standard" one from the toolbar SSOT.
  const [chatWidth, setChatWidth] = useState(CHAT_SIDEBAR_STANDARD_WIDTH_PX);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);

  const expandChat = useCallback(() => {
    setIsChatCollapsed(false);
    // Guarantee enough room for the footer: if the stored width is below
    // standard (either due to prior drag or because we bumped MIN up past
    // the old persisted value), pop back to standard.
    setChatWidth((prev) =>
      prev < CHAT_SIDEBAR_STANDARD_WIDTH_PX ? CHAT_SIDEBAR_STANDARD_WIDTH_PX : prev,
    );
  }, []);

  // Constants
  const MIN_EXPLORER_WIDTH = 160;
  const MAX_EXPLORER_WIDTH = 600;
  // Chat sidebar minimum must accommodate the footer's icon-only button set
  // (see the CHAT_SIDEBAR_MIN_WIDTH_PX derivation in AgentJobToolbar.tsx).
  const MIN_CHAT_WIDTH = CHAT_SIDEBAR_MIN_WIDTH_PX;
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
    expandChat,

    MIN_EXPLORER_WIDTH,
    MAX_EXPLORER_WIDTH,
    MIN_CHAT_WIDTH,
    MAX_CHAT_WIDTH,
  };
}
