/**
 * PlanCard - Card for displaying LLM plan output with real-time streaming
 *
 * Renders plan JSON/YAML content in a collapsible card format
 * with auto-scroll during streaming and collapse/expand after completion.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList, Check } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { lineToContent } from './cards/lineToContent';

interface PlanCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  isStreaming?: boolean;
}

export const PlanCard = memo(function PlanCard({ line, pending }: PlanCardProps) {
  const content = lineToContent(line, pending);
  const contentRef = useRef<HTMLDivElement>(null);
  const planContent = content.content || '';
  const taskName = content.metadata?.taskName;

  const isGenerating = content.type === 'plan_generating';
  const isCompleted = content.type === 'plan';

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const prevScrollLengthRef = useRef(0);

  useEffect(() => {
    if (isCompleted) {
      setIsUserScrolling(false);
    }
  }, [isCompleted]);

  const hasContent = planContent.length > 0;
  const shouldShowContent = !isCollapsed && (isGenerating || (isCompleted && hasContent));

  const lineCount = hasContent ? planContent.split('\n').length : (content.metadata?.lineCount ?? 0);

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
    if (isGenerating && contentRef.current && !isUserScrolling) {
      const currentLength = planContent.length;
      if (currentLength > prevScrollLengthRef.current) {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        });
        prevScrollLengthRef.current = currentLength;
      }
    }
  }, [planContent, isGenerating, isUserScrolling]);

  return (
    <div className="border border-indigo-200 dark:border-indigo-800/60 rounded-lg overflow-hidden bg-white dark:bg-gray-800/50">
      {/* Header */}
      <button
        onClick={() => hasContent && isCompleted && setIsCollapsed(!isCollapsed)}
        disabled={!hasContent || !isCompleted}
        className={`w-full bg-indigo-50/50 dark:bg-indigo-900/20 px-3 py-2.5 ${
          hasContent && isCompleted ? 'hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 cursor-pointer' : 'cursor-default'
        } transition-colors`}
      >
        <div className="flex items-center gap-2">
          {isGenerating ? (
            <Spinner size="md" tone="inherit" className="flex-shrink-0 text-indigo-500 dark:text-indigo-400" />
          ) : (
            <ClipboardList className="w-4 h-4 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
          )}

          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 truncate flex-1 text-left">
            {taskName ? `Plan: ${taskName}` : 'Plan'}
          </span>

          {isCompleted && lineCount > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Check className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
              <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                {lineCount} lines
              </span>
            </div>
          )}

          {isCompleted && hasContent && (
            <div className="flex-shrink-0">
              {isCollapsed ?
                <ChevronRight className="w-4 h-4 text-indigo-700 dark:text-indigo-300 opacity-60" /> :
                <ChevronDown className="w-4 h-4 text-indigo-700 dark:text-indigo-300 opacity-60" />
              }
            </div>
          )}
        </div>
      </button>

      {/* Content */}
      {shouldShowContent && (
        <div className="border-t border-indigo-200 dark:border-indigo-800/60">
          <div
            ref={contentRef}
            className="px-4 py-3 text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 max-h-[192px] overflow-y-auto scrollbar-thin"
            style={{ overflowAnchor: 'none', lineHeight: '1.5' }}
            onScroll={handleScroll}
          >
            <pre className="whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
              {planContent || ' '}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
});
