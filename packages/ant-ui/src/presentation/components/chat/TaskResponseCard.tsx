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
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { lineToContent } from './cards/lineToContent';

interface TaskResponseCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  isStreaming?: boolean;
}

export const TaskResponseCard = memo(function TaskResponseCard({ line, pending, isStreaming }: TaskResponseCardProps) {
  const content = lineToContent(line, pending);
  const contentRef = useRef<HTMLDivElement>(null);
  const textContent = content.content || '';
  const taskName = content.metadata?.taskName;

  const isActive = isStreaming === true && !content.metadata?.completed;
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
                components={{
                  pre: ({ node, className, children, ...props }: any) => (
                    <pre
                      className="my-2 px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm font-mono whitespace-pre-wrap break-words"
                      style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                      {...props}
                    >
                      {children}
                    </pre>
                  ),
                  code: ({ node, className, children, ...props }: any) => {
                    const hasLanguage = /language-\w+/.test(className || '');
                    const isMultiLine = String(children).includes('\n');

                    if (hasLanguage || isMultiLine) {
                      return <code className={className} {...props}>{children}</code>;
                    }

                    return (
                      <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono break-words" {...props}>
                        {children}
                      </code>
                    );
                  },
                  a: ({ node, children, ...props }: any) => (
                    <a className="text-blue-600 dark:text-blue-400 hover:underline break-words" target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  ),
                  table: ({ node, children, ...props }: any) => (
                    <div className="overflow-x-auto my-4">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" {...props}>
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ node, children, ...props }: any) => (
                    <th className="px-4 py-2 bg-gray-50 dark:bg-gray-800 text-left text-xs font-semibold break-words" {...props}>
                      {children}
                    </th>
                  ),
                  td: ({ node, children, ...props }: any) => (
                    <td className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-sm break-words" {...props}>
                      {children}
                    </td>
                  ),
                  p: ({ node, children, ...props }: any) => (
                    <div className="my-2 leading-relaxed break-words" {...props}>
                      {children}
                    </div>
                  ),
                  h1: ({ node, children, ...props }: any) => (
                    <h1 className="text-xl font-bold my-3 break-words" {...props}>{children}</h1>
                  ),
                  h2: ({ node, children, ...props }: any) => (
                    <h2 className="text-lg font-bold my-2 break-words" {...props}>{children}</h2>
                  ),
                  h3: ({ node, children, ...props }: any) => (
                    <h3 className="text-base font-bold my-2 break-words" {...props}>{children}</h3>
                  )
                }}
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
