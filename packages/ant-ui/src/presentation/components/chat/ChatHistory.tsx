/**
 * ChatHistory — virtual-scrolling turn history, and sole owner of the pin.
 *
 * Phase 11 chat-SSOT — consumes `Turn[]` directly (no `ChatMessage`
 * envelope) and renders each turn via `TurnItem`.
 *
 * Pin behaviour: while no user prompt is on screen, the most recent one above
 * the viewport is pinned, and the pin's button jumps back to it. Bubbles
 * register themselves through `pinRegistry`, this component keeps their
 * content-space positions, and `pinTarget` owns the rule — see those headers
 * for why neither a DOM query nor row visibility works.
 *
 * Pin state is local rather than lifted because the jump needs
 * `virtuosoRef`, which no ancestor can reach.
 */

import { useEffect, useRef, useCallback, useMemo, useState, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle, type ListRange } from 'react-virtuoso';
import { PinnedQuery, PIN_COLLAPSED_HEIGHT_PX, type PinnedQueryData } from './PinnedQuery';
import { TurnItem, TypingIndicator } from './TurnItem';
import { useStore } from '@/domain/store';
import type { Turn } from '@/domain/store/selectors/chat';
import { getPendingChoice, selectResumeFallbackCard } from '@/domain/store/selectors/chat';
import { resolvePinTarget, type BubbleMetrics } from './pinTarget';
import { PinRegistryContext, type RegisterBubble } from './pinRegistry';
import { ChoiceCard } from './choiceCard';

/**
 * Custom Scroller for Virtuoso that ensures text selection works.
 * react-virtuoso's alignToBottom mode uses internal CSS (e.g. display:table)
 * that can interfere with native text drag-selection. Explicitly setting
 * userSelect: 'text' on the scroller overrides this.
 *
 * overflowX:'hidden' closes the horizontal boundary of the chat's sole
 * scroll surface. Virtuoso injects overflow-y:auto, and per CSS the other
 * axis (left visible) then computes to auto — so any sub-pixel child
 * overflow would surface as a panel-wide horizontal scrollbar. Intended
 * horizontal scroll (wide tables / code) is handled by inner wrappers.
 */
const ScrollerWithTextSelect = forwardRef<HTMLDivElement, React.ComponentPropsWithRef<'div'>>(
  ({ style, ...props }, ref) => (
    <div
      ref={ref}
      style={{ ...style, overflowX: 'hidden', userSelect: 'text', WebkitUserSelect: 'text' }}
      {...props}
    />
  )
);

interface ChatHistoryProps {
  turns: Turn[];
}

export function ChatHistory({ turns }: ChatHistoryProps) {
  const isRunning = useStore((state) => state.isRunning);
  const kanban = useStore((state) => state.kanban);
  const dismissedInterruptTimestamp = useStore((state) => state.dismissedInterruptTimestamp);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  const [pinnedQuery, setPinnedQuery] = useState<PinnedQueryData | null>(null);

  // Bubbles carry `turnId`, Virtuoso addresses rows by index — this bridges
  // the two, and resolving the jump index at click time (rather than caching
  // it in the pin payload) keeps a stale index from misfiring.
  const indexByTurnId = useMemo(() => {
    const map = new Map<string, number>();
    turns.forEach((turn, index) => map.set(turn.turnId, index));
    return map;
  }, [turns]);

  // Latest data ref for stable callbacks
  const latestRef = useRef({ turns, indexByTurnId });
  latestRef.current.turns = turns;
  latestRef.current.indexByTurnId = indexByTurnId;

  // Live bubble elements, and their positions in CONTENT space. The metrics
  // map deliberately outlives the elements: an offset stays valid while the
  // content above it is unchanged, so virtualization unmounting a bubble
  // cannot change which prompt is pinned.
  const bubbleElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const bubbleMetricsRef = useRef<Map<string, BubbleMetrics>>(new Map());
  // Dedupe on turn identity, not on prompt text: two identical prompts are
  // two distinct pins.
  const lastPinnedTurnIdRef = useRef<string | null>(null);
  const pinRafRef = useRef<number | null>(null);
  const emptyRegistryWarnedRef = useRef(false);
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

  const registerBubble = useCallback<RegisterBubble>((turnId, element) => {
    if (element) bubbleElsRef.current.set(turnId, element);
    else bubbleElsRef.current.delete(turnId);
  }, []);

  /**
   * Refresh the content-space metrics of every mounted bubble, then let
   * `resolvePinTarget` decide. This function owns geometry only — the rule
   * (including "a prompt on screen means no pin") lives there.
   */
  const recomputePin = useCallback(() => {
    const scroller = scrollerRef.current;
    const { turns: ts } = latestRef.current;

    const emit = (next: PinnedQueryData | null) => {
      const nextId = next?.turnId ?? null;
      if (nextId === lastPinnedTurnIdRef.current) return;
      lastPinnedTurnIdRef.current = nextId;
      setPinnedQuery(next);
    };

    if (!scroller || ts.length === 0) {
      emit(null);
      return;
    }

    const scrollTop = scroller.scrollTop;
    const scrollerTop = scroller.getBoundingClientRect().top;
    // Mark-then-refresh: cached offsets survive unmounting on purpose, but only
    // the entries re-measured below may be read as "on screen".
    for (const metrics of bubbleMetricsRef.current.values()) metrics.mounted = false;
    for (const [turnId, el] of bubbleElsRef.current) {
      const rect = el.getBoundingClientRect();
      bubbleMetricsRef.current.set(turnId, {
        offset: rect.top - scrollerTop + scrollTop,
        height: rect.height,
        mounted: true,
      });
    }

    if (import.meta.env.DEV && bubbleElsRef.current.size === 0 && !emptyRegistryWarnedRef.current) {
      emptyRegistryWarnedRef.current = true;
      console.warn('📌 [PinnedQuery] no user bubbles registered — the pin cannot resolve a target');
    }

    const targetIndex = resolvePinTarget(ts, bubbleMetricsRef.current, {
      scrollTop,
      height: scroller.clientHeight,
      topInset: PIN_COLLAPSED_HEIGHT_PX,
    });

    const target = targetIndex == null ? undefined : ts[targetIndex];
    const userLine = target?.user;
    emit(
      target && userLine?.text
        ? {
            content: userLine.text,
            actionMetadata: userLine.actionMetadata,
            turnId: target.turnId,
          }
        : null,
    );
  }, []);

  // Coalesce every trigger (scroll bursts, range churn, height changes) into
  // one geometry read per frame.
  const schedulePinRecompute = useCallback(() => {
    if (pinRafRef.current != null) return;
    pinRafRef.current = requestAnimationFrame(() => {
      pinRafRef.current = null;
      recomputePin();
    });
  }, [recomputePin]);

  useEffect(
    () => () => {
      if (pinRafRef.current != null) cancelAnimationFrame(pinRafRef.current);
    },
    [],
  );

  // A newly rendered bubble has no metrics until the next recompute.
  const handleRangeChanged = useCallback(
    (_range: ListRange) => schedulePinRecompute(),
    [schedulePinRecompute],
  );

  /** Activating the pin scrolls the history back to that prompt. */
  const handleJumpToPinned = useCallback(() => {
    const turnId = lastPinnedTurnIdRef.current;
    if (!turnId) return;
    const index = latestRef.current.indexByTurnId.get(turnId);
    if (index === undefined) return;
    // A jump is an explicit "leave the tail" gesture — without disarming
    // autoscroll, followOutput yanks the viewport back on the next token.
    autoScrollRef.current = false;
    virtuosoRef.current?.scrollToIndex({
      index,
      align: 'start',
      behavior: 'smooth',
      // Negative offset scrolls up so the prompt lands below the pin bar
      // rather than underneath it. The CONSTANT, never the live height — the
      // pin is hover-expanded at the moment the button is pressed.
      offset: -PIN_COLLAPSED_HEIGHT_PX,
    });
  }, []);

  const scrollHandlerRef = useRef<EventListener | null>(null);
  if (!scrollHandlerRef.current) {
    scrollHandlerRef.current = () => schedulePinRecompute();
  }

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    if (scrollerRef.current instanceof HTMLElement) {
      if (wheelHandlerRef.current) {
        scrollerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
      }
      if (scrollHandlerRef.current) {
        scrollerRef.current.removeEventListener('scroll', scrollHandlerRef.current);
      }
    }
    scrollerRef.current = ref as HTMLElement;
    if (ref instanceof HTMLElement) {
      if (wheelHandlerRef.current) {
        ref.addEventListener('wheel', wheelHandlerRef.current, { passive: true });
      }
      // The pin must react to plain scrolling: moving WITHIN one tall turn
      // changes nothing about which rows are mounted, yet it is exactly when
      // the prompt crosses the viewport edge.
      if (scrollHandlerRef.current) {
        ref.addEventListener('scroll', scrollHandlerRef.current, { passive: true });
      }
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
        // Recompute after each step so the pin reflects real geometry from
        // the first frame, instead of being force-set and then wiped.
        schedulePinRecompute();
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
  }, [turns.length, schedulePinRecompute]);

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

  // Growing content reflows every bubble above it.
  useEffect(() => {
    schedulePinRecompute();
  }, [turns.length, lastTurnSectionsLen, lastTurnItemsLen, schedulePinRecompute]);

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

  const itemContent = useCallback((_index: number, turn: Turn) => {
    return (
      <div className="px-8 py-2 min-w-0">
        <TurnItem turn={turn} />
      </div>
    );
  }, []);

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

  // Resume-affordance safety net (grim-padding-grove RCA): when a job is
  // persisted as paused+canResume but the durable cancelled card never landed
  // in chat.jsonl (cross-pod finalize race), synthesize it from the polled
  // kanban so the user can still resume on reconnect. No-op once a durable card
  // exists, the job is running, or the interruption was dismissed.
  const resumeFallbackCard = useMemo(
    () => selectResumeFallbackCard(turns, kanban, isRunning, dismissedInterruptTimestamp),
    [turns, kanban, isRunning, dismissedInterruptTimestamp],
  );

  const Footer = useCallback(() => {
    if (!showTypingInFooter && !resumeFallbackCard) return null;
    return (
      <div className="px-8 py-2 min-w-0">
        {resumeFallbackCard && <ChoiceCard presented={resumeFallbackCard} />}
        {showTypingInFooter && <TypingIndicator />}
      </div>
    );
  }, [showTypingInFooter, resumeFallbackCard]);

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
    // `relative` only — no overflow, so Virtuoso stays the sole scroll
    // surface. It is the containing block for the pin overlay, which is kept
    // out of flow to avoid a layout feedback loop with the virtual list.
    <div className="relative h-full">
      <PinnedQuery query={pinnedQuery} onJump={handleJumpToPinned} />
      <PinRegistryContext.Provider value={registerBubble}>
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
          rangeChanged={handleRangeChanged}
          totalListHeightChanged={schedulePinRecompute}
          increaseViewportBy={{ top: 0, bottom: 200 }}
          itemContent={itemContent}
          components={{ Footer, Scroller: ScrollerWithTextSelect }}
        />
      </PinRegistryContext.Provider>
    </div>
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
