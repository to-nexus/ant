/**
 * ChatHistory - Virtual scrolling message history
 * Uses react-virtuoso for efficient rendering of large message lists
 * 
 * Pin Logic (Cursor-style):
 * - Find the topmost visible message (firstVisibleIndex)
 * - If it's an assistant message → pin the user message right above it
 * - If it's a user message → no pin (the question is already visible)
 */

import { useEffect, useRef, useCallback, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import type { ChatMessage } from '@/domain/models/chat';
import { MessageItem } from './MessageItem';
import { TypingIndicator } from './TypingIndicator';
import { useStore } from '@/domain/store';

/**
 * Custom Scroller for Virtuoso that ensures text selection works.
 * react-virtuoso's alignToBottom mode uses internal CSS (e.g. display:table)
 * that can interfere with native text drag-selection. Explicitly setting
 * userSelect: 'text' on the scroller overrides this.
 */
const ScrollerWithTextSelect = forwardRef<HTMLDivElement, React.ComponentPropsWithRef<'div'>>(
  ({ style, ...props }, ref) => (
    <div
      ref={ref}
      style={{ ...style, userSelect: 'text', WebkitUserSelect: 'text' }}
      {...props}
    />
  )
);

interface ChatHistoryProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onPinnedUserMessageChange?: (pinnedQuery: string | null) => void;
}

export function ChatHistory({ messages, onPinnedUserMessageChange }: ChatHistoryProps) {
  const isRunning = useStore((state) => state.isRunning);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  
  // Track visibility of each message using ref (not state to avoid re-renders)
  const visibleMessagesRef = useRef<Set<number>>(new Set());
  
  // Store refs for message elements
  const messageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  // Latest data ref for stable callbacks
  const latestRef = useRef({ messages, onPinnedUserMessageChange });
  latestRef.current.messages = messages;
  latestRef.current.onPinnedUserMessageChange = onPinnedUserMessageChange;
  
  // Use a ref to track the last pinned value to avoid unnecessary updates
  const lastPinnedRef = useRef<string | null>(null);
  const initialScrollDone = useRef(false);
  
  // ✅ Auto-scroll: ON by default, OFF only when user explicitly scrolls up,
  // re-enabled when user scrolls back to bottom.
  const isAtBottomRef = useRef(true);
  const autoScrollRef = useRef(true);
  // Track previous state to detect content changes within existing messages
  const prevScrollStateRef = useRef({ msgLen: 0, contentsLen: 0 });

  // Stable wheel handler ref — created once, never changes
  const wheelHandlerRef = useRef<EventListener | null>(null);
  if (!wheelHandlerRef.current) {
    wheelHandlerRef.current = (e: Event) => {
      if ((e as WheelEvent).deltaY < 0) {
        autoScrollRef.current = false;
      }
    };
  }

  // ✅ Calculate pinned message (stable function, no dependencies)
  const calculatePinnedMessage = useCallback(() => {
    const { messages: msgs, onPinnedUserMessageChange: callback } = latestRef.current;
    const visibleMessages = visibleMessagesRef.current;
    
    if (!callback || msgs.length === 0) {
      if (lastPinnedRef.current !== null) {
        lastPinnedRef.current = null;
        callback?.(null);
      }
      return;
    }

    // Wait for initial scroll to complete before calculating pin
    if (!initialScrollDone.current) {
      // Default: if last message is assistant, pin the last user message
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.role === 'assistant') {
        for (let i = msgs.length - 2; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            const content = msgs[i].contents[0]?.content || null;
            if (lastPinnedRef.current !== content) {
              lastPinnedRef.current = content;
              callback(content);
            }
            return;
          }
        }
      }
      if (lastPinnedRef.current !== null) {
        lastPinnedRef.current = null;
        callback(null);
      }
      return;
    }

    // No messages visible yet
    if (visibleMessages.size === 0) {
      return; // Wait for IntersectionObserver
    }

    // Find the topmost visible message index
    const firstVisibleIndex = Math.min(...Array.from(visibleMessages));
    const firstVisibleMsg = msgs[firstVisibleIndex];

    // If the topmost visible is a user message → no pin needed
    if (firstVisibleMsg?.role === 'user') {
      if (lastPinnedRef.current !== null) {
        lastPinnedRef.current = null;
        callback(null);
      }
      return;
    }

    // If the topmost visible is an assistant message → find the user message above it
    for (let i = firstVisibleIndex - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        const content = msgs[i].contents[0]?.content || null;
        if (lastPinnedRef.current !== content) {
          lastPinnedRef.current = content;
          callback(content);
        }
        return;
      }
    }

    // No user message found above
    if (lastPinnedRef.current !== null) {
      lastPinnedRef.current = null;
      callback(null);
    }
  }, []); // No dependencies - uses refs

  // ✅ Setup IntersectionObserver
  useEffect(() => {
    if (!scrollerRef.current) return;

    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let changed = false;
        
        entries.forEach(entry => {
          const index = parseInt(entry.target.getAttribute('data-msg-index') || '-1', 10);
          if (index === -1) return;
          
          if (entry.isIntersecting) {
            if (!visibleMessagesRef.current.has(index)) {
              visibleMessagesRef.current.add(index);
              changed = true;
            }
          } else {
            if (visibleMessagesRef.current.has(index)) {
              visibleMessagesRef.current.delete(index);
              changed = true;
            }
          }
        });
        
        // Only recalculate if visibility actually changed
        if (changed) {
          calculatePinnedMessage();
        }
      },
      {
        root: scrollerRef.current,
        rootMargin: '0px',
        threshold: 0.1,
      }
    );

    // Observe all registered elements
    messageRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [calculatePinnedMessage]);

  // ✅ Register message element for observation
  const registerMessageRef = useCallback((index: number, element: HTMLElement | null) => {
    if (element) {
      messageRefs.current.set(index, element);
      observerRef.current?.observe(element);
    } else {
      const existing = messageRefs.current.get(index);
      if (existing) {
        observerRef.current?.unobserve(existing);
        messageRefs.current.delete(index);
        visibleMessagesRef.current.delete(index);
      }
    }
  }, []);
  
  // Run calculation when messages count changes (new messages loaded)
  useEffect(() => {
    calculatePinnedMessage();
  }, [messages.length, calculatePinnedMessage]);

  // ✅ Initial scroll to bottom (instant, no animation)
  // Virtuoso's followOutput handles subsequent scrolling automatically
  // (only scrolls when user is already at bottom)
  
  // Scroll to bottom when scrollerRef becomes available (initial load)
  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    if (scrollerRef.current instanceof HTMLElement && wheelHandlerRef.current) {
      scrollerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
    }
    scrollerRef.current = ref as HTMLElement;
    if (ref instanceof HTMLElement && wheelHandlerRef.current) {
      ref.addEventListener('wheel', wheelHandlerRef.current, { passive: true });
    }
  }, []);
  
  // ✅ Force scroll to bottom on initial mount
  // This runs after Virtuoso has fully rendered
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDone.current) {
      // Try multiple times to ensure scroll works after Virtuoso renders
      const scrollToBottom = () => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
        });
      };
      
      // Immediate attempt
      scrollToBottom();
      
      // Retry after short delays to handle async rendering
      const timers = [
        setTimeout(scrollToBottom, 50),
        setTimeout(scrollToBottom, 150),
        setTimeout(() => {
          scrollToBottom();
          initialScrollDone.current = true;
        }, 300),
      ];
      
      return () => timers.forEach(clearTimeout);
    }
  }, [messages.length]);

  // ✅ followOutput callback: auto-scroll based on user intent, not position.
  // autoScrollRef is true by default and only disabled by explicit user scroll-up.
  const handleFollowOutput = useCallback((_isAtBottom: boolean) => {
    return autoScrollRef.current ? 'auto' : false;
  }, []);

  // ✅ Track at-bottom state — re-enable auto-scroll when user reaches bottom
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      autoScrollRef.current = true;
    }
  }, []);

  // ✅ Detect new content blocks within the last message (e.g., choice cards appearing
  // during streaming). followOutput only triggers on data-length changes (new messages),
  // not on item-height changes within existing messages.
  const lastMsg = messages[messages.length - 1];
  const lastMsgContentsLen = lastMsg?.contents?.length ?? 0;

  useEffect(() => {
    const prev = prevScrollStateRef.current;
    const isNewMessage = messages.length !== prev.msgLen;
    // Content grew within the same last message (not a new message)
    const isNewContentInLastMsg = !isNewMessage && lastMsgContentsLen > prev.contentsLen;

    // Always update tracking state
    prevScrollStateRef.current = { msgLen: messages.length, contentsLen: lastMsgContentsLen };

    if (isNewContentInLastMsg && initialScrollDone.current && autoScrollRef.current) {
      const scrollToEnd = () => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
          behavior: 'auto',
        });
      };

      // Multiple attempts: RAF for immediate layout, then retries for async rendering
      // (e.g., choice cards, images, or complex components that render in stages)
      const rafId = requestAnimationFrame(scrollToEnd);
      const t1 = setTimeout(scrollToEnd, 50);
      const t2 = setTimeout(scrollToEnd, 200);

      return () => {
        cancelAnimationFrame(rafId);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [lastMsgContentsLen, messages.length]);

  // ✅ Item content with ref registration
  const itemContent = useCallback((index: number, message: ChatMessage) => {
    return (
      <div 
        className="px-8 py-2"
        data-msg-index={index}
        ref={(el) => registerMessageRef(index, el)}
      >
        <MessageItem message={message} />
      </div>
    );
  }, [registerMessageRef]);

  // Typing indicator
  const lastMessage = messages[messages.length - 1];
  const hasActiveStreamingAssistant = lastMessage?.role === 'assistant' && lastMessage?.isStreaming;
  const showTypingInFooter = isRunning && !hasActiveStreamingAssistant;

  // Scroll to bottom when typing indicator appears.
  // Virtuoso's followOutput only triggers on data-length changes, not Footer slot changes.
  // Without this, the indicator renders below the viewport and stays invisible.
  const prevShowTypingRef = useRef(false);
  useEffect(() => {
    if (showTypingInFooter && !prevShowTypingRef.current && initialScrollDone.current && autoScrollRef.current) {
      const scrollToEnd = () => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
          behavior: 'auto',
        });
      };
      const rafId = requestAnimationFrame(scrollToEnd);
      const t1 = setTimeout(scrollToEnd, 100);
      prevShowTypingRef.current = showTypingInFooter;
      return () => {
        cancelAnimationFrame(rafId);
        clearTimeout(t1);
      };
    }
    prevShowTypingRef.current = showTypingInFooter;
  }, [showTypingInFooter, messages.length]);

  const Footer = useCallback(() => {
    if (!showTypingInFooter) return null;
    return (
      <div className="px-8 py-2">
        <TypingIndicator />
      </div>
    );
  }, [showTypingInFooter]);

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
      scrollerRef={handleScrollerRef}
      data={messages}
      style={{ height: '100%' }}
      initialTopMostItemIndex={messages.length - 1}
      followOutput={handleFollowOutput}
      alignToBottom={true}
      atBottomThreshold={100}
      atBottomStateChange={handleAtBottomStateChange}
      increaseViewportBy={{ top: 0, bottom: 200 }}
      itemContent={itemContent}
      components={{ Footer, Scroller: ScrollerWithTextSelect }}
    />
  );
}
