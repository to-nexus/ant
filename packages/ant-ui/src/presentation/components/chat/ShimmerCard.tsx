/**
 * ShimmerCard - Unified shimmer/status card for placeholder, thinking, cancelled
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight, XCircle, Play, Loader2 } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';

interface ShimmerCardProps {
  content: MessageContent;
  variant: 'placeholder' | 'thinking' | 'cancelled';
}

export function ShimmerCard({ content, variant }: ShimmerCardProps) {
  if (variant === 'placeholder') {
    return <PlaceholderVariant content={content} />;
  }
  
  if (variant === 'thinking') {
    return <ThinkingVariant content={content} />;
  }
  
  if (variant === 'cancelled') {
    return <CancelledVariant content={content} />;
  }
  
  return null;
}

/**
 * Placeholder variant - Simple shimmer text
 */
function PlaceholderVariant({ content }: { content: MessageContent }) {
  return (
    <div className="w-full flex items-center gap-2 px-3 py-2">
      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium shimmer-text">
        {content.content}
      </span>
    </div>
  );
}

/**
 * Thinking variant - Collapsible thinking block with duration
 */
function ThinkingVariant({ content }: { content: MessageContent }) {
  // ✅ Cursor 스타일: 컨텐츠 변화 감지 = 펼침, 완료 후 = 접힘 (클릭하면 펼침)
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  
  // ✅ Track if thinking content is still actively streaming
  const [isThinkingComplete, setIsThinkingComplete] = useState(false);
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  
  // ✅ Track if user manually scrolled away from bottom
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  
  // ✅ CRITICAL: Use ref to track previous content length to prevent infinite scroll loops
  const prevThinkingLengthRef = useRef(0);
  
  useEffect(() => {
    if (content.metadata?.collapsed === true) {
      setIsThinkingComplete(true);
      setIsThinkingExpanded(false);
      setIsUserScrolling(false);
    }
  }, [content.metadata?.collapsed, content.metadata?.durationMs]);
  
  // ✅ Check if user is at bottom of scroll area
  const isAtBottom = (element: HTMLDivElement) => {
    const threshold = 50; // 50px threshold for "near bottom"
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  };
  
  // ✅ Handle user manual scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    
    if (isAtBottom(element)) {
      // User scrolled to bottom → re-enable auto-scroll
      setIsUserScrolling(false);
    } else {
      // User scrolled away from bottom → disable auto-scroll
      setIsUserScrolling(true);
    }
  };
  
  // ✅ Auto-scroll thinking content during streaming (only if user hasn't manually scrolled)
  useEffect(() => {
    if (!isThinkingComplete && thinkingScrollRef.current && content.type === 'thinking' && !isUserScrolling) {
      const currentLength = content.content?.length || 0;
      
      // Only scroll if content actually grew
      if (currentLength > prevThinkingLengthRef.current) {
        requestAnimationFrame(() => {
          if (thinkingScrollRef.current) {
            thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
          }
        });
        prevThinkingLengthRef.current = currentLength;
      }
    }
  }, [content.content, isThinkingComplete, content.type, isUserScrolling]);
  
  const isThinkingCollapsed = isThinkingComplete && !isThinkingExpanded;
  const hasThinkingContent = content.content && content.content.trim().length > 0;
  
  // Format duration: "Thought for X seconds"
  const durationMs = content.metadata?.durationMs;
  const durationText = durationMs 
    ? durationMs < 1000 
      ? `${(durationMs / 1000).toFixed(1)}s`  // "0.5s"
      : `${Math.round(durationMs / 1000)}s`   // "3s"
    : null;
  
  return (
    <div>
      {/* Header - clickable when completed */}
      <button
        onClick={() => isThinkingComplete && hasThinkingContent && setIsThinkingExpanded(!isThinkingExpanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors rounded-md ${isThinkingComplete && hasThinkingContent ? 'hover:bg-gray-100/50 dark:hover:bg-gray-800/30 cursor-pointer' : ''}`}
        disabled={!isThinkingComplete || !hasThinkingContent}
      >
        <Brain className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
          {!isThinkingComplete ? 'Thinking...' : durationText ? `Thought for ${durationText}` : 'Thought'}
        </span>
        {isThinkingComplete && hasThinkingContent && (
          <ChevronRight className={`w-3.5 h-3.5 text-gray-400 dark:text-gray-500 ml-auto transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
        )}
      </button>
      
      {/* Content - show during streaming or when expanded */}
      {hasThinkingContent && !isThinkingCollapsed && (
        <div 
          ref={thinkingScrollRef}
          className="mt-1 px-4 py-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-gray-50/30 dark:bg-gray-900/20 rounded-md max-h-[300px] overflow-y-auto scrollbar-thin"
          style={{ overflowAnchor: 'none' }}
          onScroll={handleScroll}
        >
          <pre className="whitespace-pre-wrap font-mono opacity-70">{content.content}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * Cancelled variant - Task cancelled with original work type context
 */
function CancelledVariant({ content }: { content: MessageContent }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const isRunning = useStore(state => state.isRunning);
  const removeCancelledMessage = useStore(state => state.removeCancelledMessage);
  const [isResuming, setIsResuming] = useState(false);

  const { runJob } = useJobExecution();
  const jobId = content.metadata?.jobId;
  const originalType = content.metadata?.originalType; // The work that was cancelled

  const handleResume = async () => {
    if (!jobId || isRunning || !selectedProject || !selectedFeature) return;

    setIsResuming(true);
    try {
      // ✅ Remove this cancelled card immediately
      removeCancelledMessage(jobId);
      
      // ✅ Use useJobExecution's runJob (which handles resume internally)
      await runJob(selectedAgent, selectedJobType);
    } catch (error) {
      console.error('[CancelledCard] Failed to resume job:', error);
    } finally {
      setIsResuming(false);
    }
  };

  // Get display text based on original work type
  const getWorkTypeLabel = (type: string | undefined): string => {
    if (!type) return 'Task';
    
    const labels: Record<string, string> = {
      'analyzing': 'Analysis',
      'exploring': 'Exploration',
      'retrieving': 'Retrieval',
      'grepping': 'Search',
      'reading': 'Reading',
      'indexing': 'Indexing',
      'storing': 'Storage',
      'listing_files': 'File Listing',
      'searching_code': 'Code Search'
    };
    
    return labels[type] || 'Task';
  };

  const workLabel = getWorkTypeLabel(originalType);

  // interruption.reason이 'api_error' 등일 때도 Resume 버튼 노출
  const reason = content.metadata?.reason;
  const showResumeButton = !isRunning && jobId && selectedProject && selectedFeature && !!reason;

  return (
    <div className="border border-orange-200 dark:border-orange-800 rounded-lg overflow-hidden 
                    bg-orange-50/50 dark:bg-orange-900/10">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 
                          flex items-center justify-center">
            <XCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-orange-900 dark:text-orange-100">
            {originalType ? `${workLabel} cancelled` : 'Task cancelled'}
          </div>
          <div className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
            {content.content || 'The task was stopped by user'}
          </div>
        </div>

        {/* Resume Button - Cursor/Copilot style */}
        {showResumeButton && (
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 
                       bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600
                       text-white text-xs font-medium rounded-md
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Resume this task"
          >
            {isResuming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" fill="currentColor" />
            )}
            <span>Resume</span>
          </button>
        )}
      </div>
    </div>
  );
}
