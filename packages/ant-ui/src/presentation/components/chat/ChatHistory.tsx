/**
 * ChatHistory - Virtual scrolling message history
 * Uses react-virtuoso for efficient rendering of large message lists
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso';
import type { ChatMessage } from '@/domain/models/chat';
import { MessageItem } from './MessageItem';

interface ChatHistoryProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onLastUserMessageVisibilityChange?: (isVisible: boolean) => void;
}

export function ChatHistory({ messages, onLastUserMessageVisibilityChange }: ChatHistoryProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  
  // Find the last user message index
  const lastUserMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }, [messages]);
  
  // Track visible range to determine if last user message is visible
  const handleRangeChanged = useCallback((range: ListRange) => {
    if (!onLastUserMessageVisibilityChange || lastUserMessageIndex === -1) return;
    
    // Check if last user message is in the visible range
    const isVisible = lastUserMessageIndex >= range.startIndex && lastUserMessageIndex <= range.endIndex;
    onLastUserMessageVisibilityChange(isVisible);
  }, [lastUserMessageIndex, onLastUserMessageVisibilityChange]);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: 'smooth',
        align: 'end'
      });
    }
  }, [messages.length]);
  
  // ✅ CRITICAL: Memoize itemContent to prevent Virtuoso from re-rendering on every parent render
  const itemContent = useCallback((_index: number, message: ChatMessage) => (
    <div className="px-8 py-2">
      <MessageItem message={message} />
    </div>
  ), []); // Empty deps - function logic doesn't change
  
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-center">
        <div className="max-w-md">
          <div className="text-gray-400 dark:text-gray-500 text-sm">
            <p className="mb-2">💬 No messages yet</p>
            <p className="text-xs text-gray-500 dark:text-gray-600">
              Start a conversation with the AI assistant
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      style={{ height: '100%' }}
      initialTopMostItemIndex={messages.length - 1}  // Start at bottom
      followOutput="smooth"  // Auto-scroll to new messages
      rangeChanged={handleRangeChanged}  // Track visible range
      itemContent={itemContent}
    />
  );
}

