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
import { TurnCardShell } from './cards/TurnCardShell';

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
    <TurnCardShell accent="info" hoverLift={hasContent && isCompleted}>
      {/* Header */}
      <button
        onClick={() => hasContent && isCompleted && setIsCollapsed(!isCollapsed)}
        disabled={!hasContent || !isCompleted}
        className={`w-full px-2.5 py-1.5 ${
          hasContent && isCompleted ? 'cursor-pointer' : 'cursor-default'
        } transition-colors`}
        style={{ background: 'transparent' }}
      >
        <div className="flex items-center gap-1.5">
          {isGenerating ? (
            <span className="flex-shrink-0 inline-flex" style={{ color: 'var(--violet-500)' }}>
              <Spinner size="md" tone="inherit" />
            </span>
          ) : (
            <ClipboardList className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--violet-500)' }} />
          )}

          <span
            className="text-[11px] font-medium truncate flex-1 text-left"
            style={{ color: 'var(--violet-700)' }}
          >
            {taskName ? `Plan: ${taskName}` : 'Plan'}
          </span>

          {isCompleted && lineCount > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Check className="w-3 h-3" style={{ color: 'var(--violet-500)' }} />
              <span
                className="text-[10px] font-medium"
                style={{ color: 'var(--violet-600)', fontFamily: 'var(--font-mono)' }}
              >
                {lineCount} lines
              </span>
            </div>
          )}

          {isCompleted && hasContent && (
            <div className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>
              {isCollapsed ?
                <ChevronRight className="w-3.5 h-3.5 opacity-60" /> :
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              }
            </div>
          )}
        </div>
      </button>

      {/* Content */}
      {shouldShowContent && (
        <div style={{ borderTop: '1px solid var(--border-1)' }}>
          <div
            ref={contentRef}
            className="px-4 py-3 text-xs max-h-[192px] overflow-y-auto scrollbar-thin"
            style={{
              overflowAnchor: 'none',
              lineHeight: '1.5',
              background: 'var(--bg-surface-2)',
              color: 'var(--text-1)',
              fontFamily: 'var(--font-mono)',
            }}
            onScroll={handleScroll}
          >
            <pre className="whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
              {planContent || ' '}
            </pre>
          </div>
        </div>
      )}
    </TurnCardShell>
  );
});
