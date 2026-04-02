/**
 * MessageItem - Individual message display
 * 
 * Renders different content types: thinking, text, file operations, commands
 */

import { useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, MessageContent } from '@/domain/models/chat';
import { ShimmerCard } from './ShimmerCard';
import { WorkingCard } from './WorkingCard';
import { TerminalCard } from './TerminalCard';
import { FileCard } from './FileCard';
import { ToolActionCard } from './ToolActionCard';
import { ContextLoadedCard } from './ContextLoadedCard';
import { ChoiceCard } from './choiceCard';
import { PlanCard } from './PlanCard';
import { TaskResponseCard } from './TaskResponseCard';
import { TypingIndicator } from './TypingIndicator';

interface MessageItemProps {
  message: ChatMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  // ✅ No client-side deduplication — backend manages file card lifecycle correctly.
  // In-progress → completed transitions happen via content_update at the same array index,
  // so each slot in the contents array already reflects its final state.
  // Multiple completed operations on the same filePath are independent cards
  // (e.g., planner editing prd-refine.md multiple times across ReAct iterations).
  const deduplicatedContents = useMemo(() => {
    return message.contents.map((content, index) => ({
      content,
      originalIndex: index,
    }));
  }, [message.contents]);

  return (
    <div className="w-full">
      <div className={`w-full ${isUser ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
        {/* User messages */}
        {isUser && (
          <div className="px-4 py-3 rounded-lg">
            <div className="text-sm text-gray-900 dark:text-gray-100 select-text">
              {message.contents[0]?.content}
            </div>
          </div>
        )}

        {/* Assistant messages */}
        {!isUser && (
          <div className="space-y-2">
            {/* ✅ Show typing indicator when streaming but no content yet */}
            {message.isStreaming && message.contents.length === 0 && (
              <TypingIndicator />
            )}
            {deduplicatedContents.map(({ content, originalIndex }) => (
              <ContentBlock 
                key={originalIndex} 
                content={content} 
                isStreaming={message.isStreaming || false}
                messageId={message.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ContentBlockProps {
  content: MessageContent;
  isStreaming: boolean;
  messageId: string;
}

function ContentBlock({ content, isStreaming, messageId }: ContentBlockProps) {
  // ✅ Auto-scroll to bottom during streaming to prevent word-by-word disappearing
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // ✅ CRITICAL: Use ref to track previous content length to prevent infinite scroll loops
  const prevContentLengthRef = useRef(0);
  
  useEffect(() => {
    if (isStreaming && scrollContainerRef.current && content.type === 'text') {
      const currentLength = content.content?.length || 0;
      
      // Only scroll if content actually grew (not just re-rendered)
      if (currentLength > prevContentLengthRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        prevContentLengthRef.current = currentLength;
      }
    }
  }, [content.content, isStreaming, content.type]);
  
  switch (content.type) {
    case 'placeholder':
      // Defensive: don't render stale placeholders in finalized (non-streaming) messages.
      // Placeholders should be consumed by ContentMerger before finalization, but guard here
      // in case one leaks through (e.g., file operations that bypassed ContentMerger).
      if (!isStreaming) return null;
      return <ShimmerCard content={content} variant="placeholder" />;
    
    case 'thinking':
      return <ShimmerCard content={content} variant="thinking" />;

    case 'cancelled':
      return <ChoiceCard content={content} variant="cancelled" messageId={messageId} />;

    case 'text':
      // ✅ Cursor/Copilot-style: ALWAYS show full content (never truncate general responses)
      // Only thinking and file cards can be collapsed, not summary/response text
      return (
        <div className="px-1 py-2 w-full select-text">
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
                  // 링크 스타일링
                  a: ({ node, children, ...props }: any) => (
                    <a className="text-blue-600 dark:text-blue-400 hover:underline break-words" target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  ),
                  // 테이블 스타일링
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
                  // 문단 스타일링 (높이 안정화)
                  // ✅ Use div instead of p to avoid nesting issues with pre/code blocks
                  p: ({ node, children, ...props }: any) => (
                    <div className="my-2 leading-relaxed break-words" {...props}>
                      {children}
                    </div>
                  ),
                  // 제목 스타일링
                  h1: ({ node, children, ...props }: any) => (
                    <h1 className="text-xl font-bold my-3 break-words" {...props}>
                      {children}
                    </h1>
                  ),
                  h2: ({ node, children, ...props }: any) => (
                    <h2 className="text-lg font-bold my-2 break-words" {...props}>
                      {children}
                    </h2>
                  ),
                  h3: ({ node, children, ...props }: any) => (
                    <h3 className="text-base font-bold my-2 break-words" {...props}>
                      {children}
                    </h3>
                  )
                }}
              >
                {content.content}
              </ReactMarkdown>
            </div>
        </div>
      );

    // ===== Working States (~ing) =====
    case 'exploring':
      return <WorkingCard content={content} variant="exploring" />;
    
    case 'retrieving':
      return <WorkingCard content={content} variant="retrieving" />;
    
    case 'grepping':
      return <WorkingCard content={content} variant="grepping" />;
    
    case 'listing_files':
      return <WorkingCard content={content} variant="listing_files" />;
    
    case 'searching_code':
      return <WorkingCard content={content} variant="searching_code" />;
    
    case 'reading':
      return <WorkingCard content={content} variant="reading" />;
    
    case 'reading_source':
      return <WorkingCard content={content} variant="reading_source" />;
    
    case 'indexing':
      return <WorkingCard content={content} variant="indexing" />;
    
    case 'analyzing':
      return <WorkingCard content={content} variant="analyzing" />;
    
    case 'storing':
      return <WorkingCard content={content} variant="storing" />;
    
    case 'learning':
      return <WorkingCard content={content} variant="learning" />;
    
    case 'loading':
      return <WorkingCard content={content} variant="loading" />;

    case 'processing':
      return <WorkingCard content={content} variant="processing" />;

    case 'downloading':
      return <WorkingCard content={content} variant="downloading" />;

    case 'figma_calling':
      return <WorkingCard content={content} variant="figma_calling" />;

    // ===== Result States (~ed) =====
    case 'explored':
      return <WorkingCard content={content} variant="explored" />;
    
    case 'retrieved':
      return <WorkingCard content={content} variant="retrieved" />;
    
    case 'grepped':
      return <WorkingCard content={content} variant="grepped" />;
    
    case 'listed_files':
      return <WorkingCard content={content} variant="listed_files" />;
    
    case 'searched_code':
      return <WorkingCard content={content} variant="searched_code" />;
    
    case 'read':
      return <WorkingCard content={content} variant="read" />;
    
    case 'read_source':
      return <WorkingCard content={content} variant="read_source" />;
    
    case 'indexed':
      return <WorkingCard content={content} variant="indexed" />;
    
    case 'analyzed':
      return <WorkingCard content={content} variant="analyzed" />;
    
    case 'stored':
      return <WorkingCard content={content} variant="stored" />;
    
    case 'learned':
      return <WorkingCard content={content} variant="learned" />;
    
    case 'loaded':
      return <WorkingCard content={content} variant="loaded" />;

    case 'processed':
      return <WorkingCard content={content} variant="processed" />;

    case 'downloaded':
      return <WorkingCard content={content} variant="downloaded" />;

    case 'figma_called':
      return <WorkingCard content={content} variant="figma_called" />;

    // ===== Context Loaded =====
    case 'context_loaded':
      return <ContextLoadedCard content={content} />;

    // ===== Tool Actions =====
    case 'tool_action':
      return <ToolActionCard content={content} />;

    // ===== Terminal Commands =====
    case 'command':
    case 'command_running':
    case 'command_streaming':
      return <TerminalCard content={content} isStreaming={isStreaming} />;

    // ===== File Operations =====
    case 'file_creating':
    case 'file_writing':
    case 'file_create':
    case 'file_create_failed':
      return <FileCard content={content} operation="create" isStreaming={isStreaming} />;

    case 'file_editing':
    case 'file_updating':
    case 'file_edit':
    case 'file_edit_failed':
      return <FileCard content={content} operation="edit" isStreaming={isStreaming} />;

    case 'file_deleting':
    case 'file_delete':
    case 'file_delete_failed':
      return <FileCard content={content} operation="delete" isStreaming={isStreaming} />;

    // ===== Plan Card =====
    case 'plan_generating':
    case 'plan':
      return <PlanCard content={content} isStreaming={isStreaming} />;

    // ===== Task Response Card =====
    case 'task_response':
      return <TaskResponseCard content={content} isStreaming={isStreaming} />;

    // ===== Triage Choice =====
    case 'triage_choice':
      return <ChoiceCard content={content} variant="triage_choice" messageId={messageId} />;

    // ===== Generic Choice Cards =====
    case 'choice_card': {
      const cardType = content.metadata?.cardType;
      if (cardType === 'eval_save') {
        return <ChoiceCard content={content} variant="eval_save" messageId={messageId} />;
      }
      if (cardType === 'prd_apply') {
        return <ChoiceCard content={content} variant="prd_apply" messageId={messageId} />;
      }
      if (cardType === 'clarifying') {
        return <ChoiceCard content={content} variant="clarifying" messageId={messageId} />;
      }
      if (cardType === 'spec_complete') {
        return <ChoiceCard content={content} variant="spec_complete" messageId={messageId} />;
      }
      return null;
    }

    default:
      return null;
  }
}

