/**
 * TaskResponseCard - Contained card for worker graph text output
 *
 * Renders LLM inter-tag text responses inside a bounded card
 * with ReactMarkdown. Used in worker graph nodes (plan, codeGen, docGen)
 * to prevent unbounded text streaming in parallel execution.
 *
 * Height: dynamic up to ~12 lines (max-h-[288px]), then scrollable.
 * Short content (1-2 lines) only takes the space it needs.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { lineToContent } from './cards/lineToContent';

interface TaskResponseCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  isStreaming?: boolean;
}

const MARKDOWN_COMPONENTS = createMarkdownComponents();

export const TaskResponseCard = memo(function TaskResponseCard({ line, pending }: TaskResponseCardProps) {
  const content = lineToContent(line, pending);
  const contentRef = useRef<HTMLDivElement>(null);
  const textContent = content.content || '';
  const taskName = content.metadata?.taskName;

  // SSOT pattern (matches PlanCard/FileCard/TerminalCard): the durable
  // line's statusType decides in-flight vs completed. Section-wide
  // `isStreaming` was unreliable here — it goes true whenever ANY
  // pendingCard / activeText sits in the same section's TURN_BUFFER
  // mirror, leaving the spinner stuck after `task_response` finalize.
  const isActive = content.type === 'task_response_streaming';
  const isCompleted = !isActive;

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const prevScrollLengthRef = useRef(0);

  useEffect(() => {
    if (isCompleted) {
      setIsUserScrolling(false);
    }
  }, [isCompleted]);

  const hasContent = textContent.length > 0;
  const shouldShowContent = !isCollapsed && hasContent;

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
    if (isActive && contentRef.current && !isUserScrolling) {
      const currentLength = textContent.length;
      if (currentLength > prevScrollLengthRef.current) {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        });
        prevScrollLengthRef.current = currentLength;
      }
    }
  }, [textContent, isActive, isUserScrolling]);

  return (
    <div className="border border-gray-200 dark:border-gray-700/60 rounded-lg overflow-hidden bg-white dark:bg-gray-800/50">
      {/* Header */}
      <button
        onClick={() => hasContent && isCompleted && setIsCollapsed(!isCollapsed)}
        disabled={!hasContent || !isCompleted}
        className={`w-full bg-gray-50/50 dark:bg-gray-800/40 px-3 py-2.5 ${
          hasContent && isCompleted ? 'hover:bg-gray-100/50 dark:hover:bg-gray-700/30 cursor-pointer' : 'cursor-default'
        } transition-colors`}
      >
        <div className="flex items-center gap-2">
          {isActive ? (
            <Spinner size="md" tone="muted" className="flex-shrink-0" />
          ) : (
            <MessageSquare className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          )}

          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1 text-left">
            {taskName || 'Task'}
          </span>

          {isCompleted && hasContent && (
            <div className="flex-shrink-0">
              {isCollapsed ?
                <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400 opacity-60" /> :
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 opacity-60" />
              }
            </div>
          )}
        </div>
      </button>

      {/* Content */}
      {shouldShowContent && (
        <div className="border-t border-gray-200 dark:border-gray-700/60">
          <div
            ref={contentRef}
            className="px-4 py-3 max-h-[288px] overflow-y-auto scrollbar-thin"
            style={{ overflowAnchor: 'none' }}
            onScroll={handleScroll}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none w-full select-text"
                 style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {textContent}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
