/**
 * ChatHistory — virtual-scrolling turn history.
 *
 * Phase 11 chat-SSOT — consumes `Turn[]` directly (no `ChatMessage`
 * envelope) and renders each turn via `TurnItem`. Pin behaviour matches
 * Cursor's: when the topmost visible row is an assistant section, pin
 * the user prompt above it so the user can always see what they asked.
 *
 * Each `Turn` carries the user prompt + every assistant section in a
 * single row, so pin lookup is just "previous turn's user line" — no
 * separate user-vs-assistant message scan.
 */

import { useEffect, useRef, useCallback, useMemo, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import type { PinnedQueryData } from './PinnedQuery';
import { TurnItem, TypingIndicator } from './TurnItem';
import { useStore } from '@/domain/store';
import type { Turn } from '@/domain/store/selectors/chat';
import { getPendingChoice } from '@/domain/store/selectors/chat';

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
  turns: Turn[];
  onPinnedUserMessageChange?: (pinnedQuery: PinnedQueryData | null) => void;
}

export function ChatHistory({ turns, onPinnedUserMessageChange }: ChatHistoryProps) {
  const isRunning = useStore((state) => state.isRunning);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  // Track visibility of each turn using ref (not state to avoid re-renders).
  const visibleTurnsRef = useRef<Set<number>>(new Set());

  const turnRefs = useRef<Map<number, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Latest data ref for stable callbacks
  const latestRef = useRef({ turns, onPinnedUserMessageChange });
  latestRef.current.turns = turns;
  latestRef.current.onPinnedUserMessageChange = onPinnedUserMessageChange;

  const lastPinnedRef = useRef<string | null>(null);
  const initialScrollDone = useRef(false);

  // Auto-scroll: ON by default, OFF only when user explicitly scrolls up,
  // re-enabled when user scrolls back to bottom.
  //
  // INVARIANT — every autoscroll trigger below must consult
  // `pendingRef.current.has`. An unresolved choice card is a 1st-class
  // citizen of autoscroll policy: while one exists, parallel-task events
  // must NOT push it out of the viewport. Once resolved, getPendingChoice
  // immediately reports has=false and normal follow-output resumes — so
  // resolved cards naturally scroll past with the feed (do NOT gate on
  // anything beyond `!resolved` in the selector).
  const isAtBottomRef = useRef(true);
  const autoScrollRef = useRef(true);
  // Track previous state to detect content changes within existing turns.
  const prevScrollStateRef = useRef({ turnLen: 0, lastSectionsLen: 0 });

  const pending = useMemo(() => getPendingChoice(turns), [turns]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const wheelHandlerRef = useRef<EventListener | null>(null);
  if (!wheelHandlerRef.current) {
    wheelHandlerRef.current = (e: Event) => {
      if ((e as WheelEvent).deltaY < 0) {
        autoScrollRef.current = false;
      }
    };
  }

  /**
   * Pin the user prompt above the topmost visible assistant section.
   *
   * Each Turn already carries its own user prompt, so the "pin" target is
   * simply the user line of the topmost visible Turn (or the previous Turn's
   * user line, when the visible row has no user prompt — e.g. continuations).
   */
  const calculatePinnedMessage = useCallback(() => {
    const { turns: ts, onPinnedUserMessageChange: callback } = latestRef.current;
    const visible = visibleTurnsRef.current;

    const buildPin = (turn: Turn | undefined): PinnedQueryData | null => {
      const userLine = turn?.user;
      if (!userLine?.text) return null;
      return { content: userLine.text, actionMetadata: userLine.actionMetadata };
    };

    if (!callback || ts.length === 0) {
      if (lastPinnedRef.current !== null) {
        lastPinnedRef.current = null;
        callback?.(null);
      }
      return;
    }

    if (!initialScrollDone.current) {
      // Default before initial scroll: pin the most recent user prompt.
      const lastTurn = ts[ts.length - 1];
      const pinData = buildPin(lastTurn);
      const pinKey = pinData?.content || null;
      if (lastPinnedRef.current !== pinKey) {
        lastPinnedRef.current = pinKey;
        callback(pinData);
      }
      return;
    }

    if (visible.size === 0) return; // Wait for IntersectionObserver

    const firstVisibleIndex = Math.min(...Array.from(visible));
    const visibleTurn = ts[firstVisibleIndex];

    // The visible turn carries its user prompt as part of the same row,
    // so once it scrolls into view the pin can be cleared. We pin only
    // when the visible row is "below" the user prompt — i.e. user prompt
    // is offscreen above. Detection: the visible turn does not own a
    // user line, so we walk back to find one.
    if (visibleTurn?.user) {
      if (lastPinnedRef.current !== null) {
        lastPinnedRef.current = null;
        callback(null);
      }
      return;
    }

    for (let i = firstVisibleIndex - 1; i >= 0; i--) {
      if (ts[i].user) {
        const pinData = buildPin(ts[i]);
        const pinKey = pinData?.content || null;
        if (lastPinnedRef.current !== pinKey) {
          lastPinnedRef.current = pinKey;
          callback(pinData);
        }
        return;
      }
    }

    if (lastPinnedRef.current !== null) {
      lastPinnedRef.current = null;
      callback(null);
    }
  }, []);

  useEffect(() => {
    if (!scrollerRef.current) return;

    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let changed = false;

        entries.forEach(entry => {
          const index = parseInt(entry.target.getAttribute('data-turn-index') || '-1', 10);
          if (index === -1) return;

          if (entry.isIntersecting) {
            if (!visibleTurnsRef.current.has(index)) {
              visibleTurnsRef.current.add(index);
              changed = true;
            }
          } else {
            if (visibleTurnsRef.current.has(index)) {
              visibleTurnsRef.current.delete(index);
              changed = true;
            }
          }
        });

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

    turnRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [calculatePinnedMessage]);

  const registerTurnRef = useCallback((index: number, element: HTMLElement | null) => {
    if (element) {
      turnRefs.current.set(index, element);
      observerRef.current?.observe(element);
    } else {
      const existing = turnRefs.current.get(index);
      if (existing) {
        observerRef.current?.unobserve(existing);
        turnRefs.current.delete(index);
        visibleTurnsRef.current.delete(index);
      }
    }
  }, []);

  useEffect(() => {
    calculatePinnedMessage();
  }, [turns.length, calculatePinnedMessage]);

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    if (scrollerRef.current instanceof HTMLElement && wheelHandlerRef.current) {
      scrollerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
    }
    scrollerRef.current = ref as HTMLElement;
    if (ref instanceof HTMLElement && wheelHandlerRef.current) {
      ref.addEventListener('wheel', wheelHandlerRef.current, { passive: true });
    }
  }, []);

  // Force scroll to bottom on initial mount.
  useEffect(() => {
    if (turns.length > 0 && !initialScrollDone.current) {
      const scrollToBottom = () => {
        virtuosoRef.current?.scrollToIndex({
          index: turns.length - 1,
          align: 'end',
        });
      };

      scrollToBottom();

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
  }, [turns.length]);

  const handleFollowOutput = useCallback((_isAtBottom: boolean) => {
    return (autoScrollRef.current && !pendingRef.current.has) ? 'auto' : false;
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (atBottom && !pendingRef.current.has) {
      autoScrollRef.current = true;
    }
  }, []);

  // Detect new content within the last turn (e.g. choice cards appearing
  // during streaming, sections growing). followOutput only triggers on
  // data-length changes (new turns), not on item-height changes.
  const lastTurn = turns[turns.length - 1];
  const lastTurnSectionsLen = lastTurn?.sections.length ?? 0;
  const lastTurnItemsLen = useTurnContentSignature(lastTurn);

  useEffect(() => {
    const prev = prevScrollStateRef.current;
    const isNewTurn = turns.length !== prev.turnLen;
    const isNewContentInLastTurn = !isNewTurn && lastTurnSectionsLen > prev.lastSectionsLen;

    prevScrollStateRef.current = { turnLen: turns.length, lastSectionsLen: lastTurnSectionsLen };

    if (isNewContentInLastTurn && initialScrollDone.current && autoScrollRef.current && !pending.has) {
      const scrollToEnd = () => {
        virtuosoRef.current?.scrollToIndex({
          index: turns.length - 1,
          align: 'end',
          behavior: 'auto',
        });
      };
      const rafId = requestAnimationFrame(scrollToEnd);
      const t1 = setTimeout(scrollToEnd, 50);
      const t2 = setTimeout(scrollToEnd, 200);

      return () => {
        cancelAnimationFrame(rafId);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [lastTurnSectionsLen, lastTurnItemsLen, turns.length, pending.has]);

  // Card-into-view transition: when an unresolved choice card first appears
  // (or switches to a different turn), bring it into view exactly once.
  // After that, the freeze above keeps it from being pushed off by parallel
  // events. When resolved → turnIndex becomes null → early-return; resolved
  // cards have no special treatment and scroll naturally with the feed.
  const prevPendingTurnIndexRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevPendingTurnIndexRef.current;
    prevPendingTurnIndexRef.current = pending.turnIndex;
    if (pending.turnIndex == null) return;
    if (pending.turnIndex === prev) return;
    if (!initialScrollDone.current) return;
    // Skip if the unresolved card lives in a non-last turn — auto-scrolling
    // upward to a card outside the current tail surprises the user (e.g.
    // a card just resolved triggers a new job whose first phase attaches
    // a fresh choice to an earlier turn, which would jump the viewport
    // away from the tail). The card stays visible without an autoscroll
    // because `pendingRef.has` already gates `followOutput` off, so new
    // content cannot push it off-screen. Manual scroll-up is preserved.
    if (pending.turnIndex !== latestRef.current.turns.length - 1) return;
    const scrollToCard = () => {
      virtuosoRef.current?.scrollToIndex({
        index: pending.turnIndex!,
        align: 'end',
        behavior: 'auto',
      });
    };
    const rafId = requestAnimationFrame(scrollToCard);
    const t1 = setTimeout(scrollToCard, 50);
    const t2 = setTimeout(scrollToCard, 200);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pending.turnIndex]);

  const itemContent = useCallback((index: number, turn: Turn) => {
    return (
      <div
        className="px-8 py-2 min-w-0"
        data-turn-index={index}
        ref={(el) => registerTurnRef(index, el)}
      >
        <TurnItem turn={turn} />
      </div>
    );
  }, [registerTurnRef]);

  // Typing indicator is shown when:
  //   - a job is running, AND
  //   - the last turn does not already have an active streaming section
  const lastTurnHasStreaming = lastTurn?.sections.some(
    (s) => s.activeText || s.activeThinking || (s.pendingCards && Object.keys(s.pendingCards).length > 0),
  ) ?? false;
  const showTypingInFooter = isRunning && !lastTurnHasStreaming;

  const prevShowTypingRef = useRef(false);
  useEffect(() => {
    if (showTypingInFooter && !prevShowTypingRef.current && initialScrollDone.current && autoScrollRef.current && !pending.has) {
      const scrollToEnd = () => {
        virtuosoRef.current?.scrollToIndex({
          index: turns.length - 1,
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
  }, [showTypingInFooter, turns.length, pending.has]);

  const Footer = useCallback(() => {
    if (!showTypingInFooter) return null;
    return (
      <div className="px-8 py-2 min-w-0">
        <TypingIndicator />
      </div>
    );
  }, [showTypingInFooter]);

  if (turns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-center">
        <div className="max-w-md">
          <div className="text-sm" style={{ color: 'var(--text-3)' }}>
            <p className="mb-2 text-gradient">✨ No messages yet</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
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
      data={turns}
      style={{ height: '100%' }}
      initialTopMostItemIndex={turns.length - 1}
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

/**
 * Reduce the last turn into a string signature that changes when the
 * displayed content meaningfully grows. Used as a useEffect dep so the
 * auto-scroll reacts when individual sections gain new items / pending
 * cards mid-stream.
 */
function useTurnContentSignature(turn: Turn | undefined): string {
  if (!turn) return '';
  const parts: string[] = [];
  for (const s of turn.sections) {
    parts.push(`${s.workerScope}:${s.items.length}`);
    if (s.activeText) parts.push(`t${s.activeText.length}`);
    if (s.activeThinking) parts.push(`th${s.activeThinking.length}`);
    if (s.pendingCards) parts.push(`p${Object.keys(s.pendingCards).length}`);
  }
  return parts.join('|');
}
