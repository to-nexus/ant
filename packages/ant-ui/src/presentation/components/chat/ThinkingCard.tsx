/**
 * ThinkingCard - Cursor-style thinking block component
 * 
 * Displays LLM thinking/reasoning content with auto-collapse on completion
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';

interface ThinkingCardProps {
  content: MessageContent;
}

export function ThinkingCard({ content }: ThinkingCardProps) {
  // ✅ Cursor 스타일: 컨텐츠 변화 감지 = 펼침, 완료 후 = 접힘 (클릭하면 펼침)
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  
  // ✅ Track if thinking content is still actively streaming
  const [isThinkingComplete, setIsThinkingComplete] = useState(false);
  const thinkingContentRef = useRef(content.content);
  const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  
  // ✅ Track if user manually scrolled away from bottom
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  
  // ✅ CRITICAL: Use ref to track previous content length to prevent infinite scroll loops
  const prevThinkingLengthRef = useRef(0);
  
  // ✅ Detect when thinking content stops growing (completed)
  // Track ONLY thinking content changes, independent of overall message streaming
  useEffect(() => {
    if (content.type === 'thinking') {
      const currentContent = content.content || '';
      
      // If content changed OR this is initial mount, reset the timeout
      if (currentContent !== thinkingContentRef.current || thinkingContentRef.current === undefined) {
        thinkingContentRef.current = currentContent;
        setIsThinkingComplete(false);
        
        // Clear existing timeout
        if (thinkingTimeoutRef.current) {
          clearTimeout(thinkingTimeoutRef.current);
        }
        
        // Set new timeout: if no change for 500ms, mark as complete
        thinkingTimeoutRef.current = setTimeout(() => {
          console.log('[ThinkingCard] Thinking completed (500ms timeout)');
          setIsThinkingComplete(true);
          // ✅ Reset user scrolling state when thinking completes
          setIsUserScrolling(false);
        }, 500);
      }
    }
    
    // Cleanup timeout on unmount
    return () => {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
      }
    };
  }, [content.content, content.type]);
  
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

