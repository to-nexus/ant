/**
 * ShimmerCard — Status card for placeholder + thinking states.
 *
 * `placeholder` variant is rendered while the assistant is between
 * tool calls and there is no concrete event yet — it does not bind
 * to any chat-SSOT line.
 *
 * `thinking` variant is bound to a `ChatThinkingLine`. When the line
 * is `undefined` (live streaming overlay), the card consumes the
 * `streamingText` prop instead and renders without a "Thought for X"
 * footer until the worker emits the durable line.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import type { ChatThinkingLine } from '@ant/shared';
import { TypingIndicator } from './TypingIndicator';

interface ShimmerCardPlaceholderProps {
  variant: 'placeholder';
}

interface ShimmerCardThinkingProps {
  variant: 'thinking';
  line?: ChatThinkingLine;
  /** Live thinking buffer when the durable line has not yet landed. */
  streamingText?: string;
  /** Optional duration metadata from a sibling completion line. */
  durationMs?: number;
  /** Marks the thinking block as collapsed (terminal state). */
  collapsed?: boolean;
}

type ShimmerCardProps = ShimmerCardPlaceholderProps | ShimmerCardThinkingProps;

export const ShimmerCard = memo(function ShimmerCard(props: ShimmerCardProps) {
  if (props.variant === 'placeholder') {
    return <TypingIndicator />;
  }
  return (
    <ThinkingVariant
      text={props.line?.text ?? props.streamingText ?? ''}
      collapsed={props.collapsed ?? false}
      durationMs={props.durationMs}
      isStreaming={!props.line}
    />
  );
});

interface ThinkingVariantProps {
  text: string;
  collapsed: boolean;
  durationMs?: number;
  isStreaming: boolean;
}

function ThinkingVariant({ text, collapsed, durationMs, isStreaming }: ThinkingVariantProps) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);

  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const prevThinkingLengthRef = useRef(0);

  // Derived from props so the streaming→complete→streaming transition
  // (trailing-thinking merge: a new `thinking` chunk arrives after a
  // durable thought, swapping `line` back to `streamingText`) flips the
  // header back to "Thinking..." and re-opens the body. A previous
  // implementation latched this as state and never reset, defeating
  // the merge feature visually.
  const isThinkingComplete = collapsed === true || !isStreaming;

  // Reset interaction state on any streaming↔complete flip so re-entry
  // starts with a clean view (collapsed by default when complete; not
  // user-scrolling when streaming resumes).
  useEffect(() => {
    setIsThinkingExpanded(false);
    setIsUserScrolling(false);
  }, [collapsed, isStreaming]);

  const isAtBottom = (element: HTMLDivElement) => {
    const threshold = 50;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    if (isAtBottom(element)) {
      setIsUserScrolling(false);
    } else {
      setIsUserScrolling(true);
    }
  };

  useEffect(() => {
    if (!isThinkingComplete && thinkingScrollRef.current && !isUserScrolling) {
      const currentLength = text.length;
      if (currentLength > prevThinkingLengthRef.current) {
        requestAnimationFrame(() => {
          if (thinkingScrollRef.current) {
            thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
          }
        });
        prevThinkingLengthRef.current = currentLength;
      }
    }
  }, [text, isThinkingComplete, isUserScrolling]);

  const isThinkingCollapsed = isThinkingComplete && !isThinkingExpanded;
  const hasThinkingContent = text.trim().length > 0;

  const durationText = durationMs
    ? durationMs < 1000
      ? `${(durationMs / 1000).toFixed(1)}s`
      : `${Math.round(durationMs / 1000)}s`
    : null;

  return (
    <div>
      {/* Header - clickable when completed */}
      <button
        onClick={() => isThinkingComplete && hasThinkingContent && setIsThinkingExpanded(!isThinkingExpanded)}
        className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 transition-colors rounded-md ${isThinkingComplete && hasThinkingContent ? 'hover:bg-[color:var(--bg-hover)] cursor-pointer' : ''}`}
        disabled={!isThinkingComplete || !hasThinkingContent}
      >
        <Brain className="w-3 h-3" style={{ color: 'var(--text-4)' }} />
        <span
          className={`text-[11px] font-medium ${!isThinkingComplete ? 'shimmer-text' : ''}`}
          style={{ color: 'var(--text-3)' }}
        >
          {!isThinkingComplete ? 'Thinking...' : durationText ? `Thought for ${durationText}` : 'Thought'}
        </span>
        {isThinkingComplete && hasThinkingContent && (
          <ChevronRight
            className={`w-3 h-3 ml-auto transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`}
            style={{ color: 'var(--text-4)' }}
          />
        )}
      </button>

      {/* Content - show during streaming or when expanded */}
      {hasThinkingContent && !isThinkingCollapsed && (
        <div
          ref={thinkingScrollRef}
          className="mt-1 px-4 py-3 text-[11px] leading-relaxed max-h-[300px] overflow-y-auto scrollbar-thin"
          style={{
            overflowAnchor: 'none',
            color: 'var(--text-3)',
            background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-sm)',
          }}
          onScroll={handleScroll}
        >
          <pre className="whitespace-pre-wrap font-mono opacity-70">{text}</pre>
        </div>
      )}
    </div>
  );
}
