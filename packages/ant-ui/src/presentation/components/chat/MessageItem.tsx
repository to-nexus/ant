/**
 * MessageItem - Individual message display
 * 
 * Renders different content types: thinking, text, file operations, commands
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, 
         Search, FileSearch, Eye, Loader2, Play, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, MessageContent } from '@/domain/models/chat';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { ThinkingCard } from './ThinkingCard';
import { FileIcon } from '@/shared/utils/file-icons';
import { FileCard } from './FileCard';

interface MessageItemProps {
  message: ChatMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`w-full ${isUser ? 'bg-blue-50 dark:bg-blue-900/20 max-w-[85%]' : ''}`}>
        {/* User messages */}
        {isUser && (
          <div className="px-4 py-3 rounded-lg">
            <div className="text-sm text-gray-900 dark:text-gray-100">
              {message.contents[0]?.content}
            </div>
          </div>
        )}

        {/* Assistant messages */}
        {!isUser && (
          <div className="space-y-2">
            {message.contents.map((content, index) => (
              <ContentBlock 
                key={index} 
                content={content} 
                isStreaming={message.isStreaming || false}
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
}

function ContentBlock({ content, isStreaming }: ContentBlockProps) {
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
      return (
        <div className="w-full flex items-center gap-2 px-3 py-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium shimmer-text">
            {content.content}
          </span>
        </div>
      );

    case 'thinking':
      return <ThinkingCard content={content} />;

    case 'cancelled':
      return <CancelledCard content={content} />;

    case 'text':
      // ✅ Cursor/Copilot-style: ALWAYS show full content (never truncate general responses)
      // Only thinking and file cards can be collapsed, not summary/response text
      return (
        <div className="px-1 py-2 w-full">
          <div className="prose prose-sm dark:prose-invert max-w-none w-full"
               style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
            <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  // 코드 블록 스타일링
                  code: ({ node, inline, className, children, ...props }: any) => {
                    return inline ? (
                      <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono break-all" {...props}>
                        {children}
                      </code>
                    ) : (
                      // ✅ overflow-x 제거, word-break로 줄바꿈 처리 (줄 단위 스크롤)
                      <pre className="my-4 p-0 bg-transparent">
                        <code 
                          className="block px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm font-mono whitespace-pre-wrap break-words"
                          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          {...props}
                        >
                          {children}
                        </code>
                      </pre>
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

    case 'command':
      // Command 출력이 너무 길면 마지막 부분만 표시
      const commandOutput = content.content || '';
      const isLongOutput = commandOutput.length > 500;
      const displayOutput = isLongOutput
        ? '...\n' + commandOutput.slice(-400) // 마지막 400자만
        : commandOutput;
      
      return (
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800">
            <Terminal className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
                {content.metadata?.command || 'command'}
              </div>
            </div>
            {content.metadata?.exitCode !== undefined && (
              <div className={`text-xs px-2 py-0.5 rounded ${
                content.metadata.exitCode === 0 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              }`}>
                {content.metadata.exitCode === 0 ? '✓' : '✗'}
              </div>
            )}
          </div>
          {displayOutput && (
            <div 
              className="px-3 py-2 text-xs font-mono text-gray-700 dark:text-gray-300 
                         bg-gray-50 dark:bg-gray-900/50 max-h-40 overflow-y-auto scrollbar-thin"
              style={{ overflowAnchor: 'none' }}
            >
              <pre className="whitespace-pre-wrap">{displayOutput}</pre>
            </div>
          )}
        </div>
      );

    case 'exploring':
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 
                        border border-blue-200 dark:border-blue-800 rounded-lg">
          <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-blue-800 dark:text-blue-300">
              {content.content}
            </div>
          </div>
        </div>
      );

    case 'explored':
      return <ExplorationCard content={content} />;

    case 'reading':
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 
                        border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <Eye className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-indigo-700 dark:text-indigo-300 truncate">
              {content.content}
            </div>
          </div>
        </div>
      );

    case 'read':
      return (
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400">
          <Eye className="w-3 h-3" />
          <span className="truncate">{content.metadata?.filePath}</span>
        </div>
      );

    case 'tool_action':
      // ✅ Cursor/Copilot style: Minimal one-line display for simple tool actions
      const icon = content.metadata?.actionIcon || '🔧';
      const toolContent = content.content;
      
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-400 
                        bg-gray-50/30 dark:bg-gray-800/20 rounded border border-gray-200/50 dark:border-gray-700/50">
          <span>{icon}</span>
          <span className="font-medium">{toolContent}</span>
        </div>
      );

    case 'grepping':
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 dark:bg-purple-900/20 
                        border border-purple-200 dark:border-purple-800 rounded-lg">
          <Search className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-purple-800 dark:text-purple-300">
              {content.content}
            </div>
          </div>
        </div>
      );

    case 'grepped':
      return <GrepCard content={content} />;

    // File Operations - Real-time streaming
    case 'file_creating':
    case 'file_writing':
    case 'file_create':
      return <FileCard content={content} operation="create" isStreaming={isStreaming} />;

    case 'file_editing':
    case 'file_updating':
    case 'file_edit':
      return <FileCard content={content} operation="edit" isStreaming={isStreaming} />;

    case 'file_deleting':
    case 'file_delete':
      return <FileCard content={content} operation="delete" isStreaming={isStreaming} />;

    // Command Execution - Real-time streaming
    case 'command_running':
    case 'command_streaming':
      return <CommandCard content={content} isStreaming={isStreaming} />;

    default:
      return null;
  }
}

/**
 * CommandCard - Command execution card with real-time streaming
 */
interface CommandCardProps {
  content: MessageContent;
  isStreaming?: boolean;
}

function CommandCard({ content }: CommandCardProps) {
  const outputRef = useRef<HTMLDivElement>(null);
  const command = content.metadata?.command || content.content;
  const output = content.content;
  const exitCode = content.metadata?.exitCode;
  
  // Determine state based on content type
  const isRunning = content.type === 'command_running';
  const isStreamingOutput = content.type === 'command_streaming';
  const isCompleted = content.type === 'command';
  const isActive = isRunning || isStreamingOutput;
  
  // ✅ Cursor/Copilot style: Default to expanded (show output), allow user to collapse
  const [isCollapsed, setIsCollapsed] = useState(false);
  const shouldShowOutput = !isCollapsed && output;
  
  // ✅ CRITICAL: Use ref to track previous output length
  const prevOutputLengthRef = useRef(0);
  
  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (isStreamingOutput && outputRef.current) {
      const currentLength = output?.length || 0;
      
      // Only scroll if output actually grew
      if (currentLength > prevOutputLengthRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
        prevOutputLengthRef.current = currentLength;
      }
    }
  }, [output, isStreamingOutput]);
  
  const isSuccess = exitCode === 0;
  const statusConfig = isSuccess
    ? {
        bgColor: 'bg-white dark:bg-gray-800/50',
        borderColor: 'border-gray-200 dark:border-gray-700',
        textColor: 'text-gray-700 dark:text-gray-300',
        iconColor: 'text-green-500 dark:text-green-400',
        headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
        hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
        label: 'Completed'
      }
    : {
        bgColor: 'bg-white dark:bg-gray-800/50',
        borderColor: 'border-gray-200 dark:border-gray-700',
        textColor: 'text-gray-700 dark:text-gray-300',
        iconColor: 'text-red-500 dark:text-red-400',
        headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
        hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
        label: 'Failed'
      };
  
  const activeConfig = {
    bgColor: 'bg-white dark:bg-gray-800/50',
    borderColor: 'border-gray-200 dark:border-gray-700',
    textColor: 'text-gray-700 dark:text-gray-300',
    iconColor: 'text-blue-500 dark:text-blue-400',
    headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
    hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
    label: isRunning ? 'Running...' : 'Running...'
  };
  
  const config = isActive ? activeConfig : statusConfig;
  const hasOutput = output && output.trim().length > 0;
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden ${config.bgColor}`}>
      {/* Header - Copilot/Cursor Style (Single Row) */}
      <button 
        onClick={() => hasOutput && isCompleted && setIsCollapsed(!isCollapsed)}
        disabled={!hasOutput || !isCompleted}
        className={`w-full ${config.headerBg} px-3 py-2.5 ${hasOutput && isCompleted ? config.hoverBg + ' cursor-pointer' : 'cursor-default'} transition-colors`}
      >
        <div className="flex items-center gap-2">
          {/* Status Icon */}
          {isActive ? (
            <Loader2 className={`w-4 h-4 ${config.iconColor} animate-spin flex-shrink-0`} />
          ) : (
            <Terminal className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          )}
          
          {/* Command */}
          <span className={`text-xs font-mono ${config.textColor} truncate flex-1 text-left`}>
            {command}
          </span>
          
          {/* Exit Code (Compact) */}
          {isCompleted && exitCode !== undefined && (
            <span className={`text-[10px] font-mono ${isSuccess ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} flex-shrink-0 font-medium`}>
              {isSuccess ? '✓' : `✗ ${exitCode}`}
            </span>
          )}
          
          {/* Expand/Collapse Icon */}
          {isCompleted && hasOutput && (
            <div className="flex-shrink-0">
              {isCollapsed ? 
                <ChevronRight className={`w-4 h-4 ${config.textColor} opacity-60`} /> :
                <ChevronDown className={`w-4 h-4 ${config.textColor} opacity-60`} />
              }
            </div>
          )}
        </div>
      </button>
      
      {/* Output (auto-expand during streaming, collapsible when complete) */}
      {shouldShowOutput && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div 
            ref={outputRef}
            className="max-h-[300px] overflow-y-auto scrollbar-thin bg-gray-50 dark:bg-gray-900/50 px-4 py-3"
            style={{ overflowAnchor: 'none' }}
          >
            <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {output}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ExplorationCard - Codebase exploration result card
 */
function ExplorationCard({ content }: { content: MessageContent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const filesList = content.metadata?.filesList || [];
  const hasFiles = filesList.length > 0;

  return (
    <div className="border border-gray-200/50 dark:border-gray-700/50 rounded-lg overflow-hidden bg-transparent">
      <button 
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50/30 dark:bg-gray-800/20 hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer"
        onClick={() => hasFiles && setIsExpanded(!isExpanded)}
        disabled={!hasFiles}
      >
        <FileSearch className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {content.content}
          </span>
        </div>
        {hasFiles && (
          <div className="flex-shrink-0">
            {isExpanded ? 
              <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" /> :
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" />
            }
          </div>
        )}
      </button>
      
      {hasFiles && isExpanded && (
        <div className="border-t border-gray-200/50 dark:border-gray-700/50 max-h-60 overflow-y-auto scrollbar-thin bg-gray-50/20 dark:bg-gray-900/10">
          <div className="px-4 py-2 text-xs">
            {filesList.map((file, i) => (
              <div key={i} className="py-1 font-mono text-gray-700 dark:text-gray-300 truncate flex items-center gap-2">
                <FileIcon filePath={file} size={14} />
                <span>{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * GrepCard - Search result card
 */
function GrepCard({ content }: { content: MessageContent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const filesList = content.metadata?.filesList || [];
  const hasFiles = filesList.length > 0;

  return (
    <div className="border border-gray-200/50 dark:border-gray-700/50 rounded-lg overflow-hidden bg-transparent">
      <button 
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50/30 dark:bg-gray-800/20 hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer"
        onClick={() => hasFiles && setIsExpanded(!isExpanded)}
        disabled={!hasFiles}
      >
        <Search className="w-4 h-4 text-purple-500 dark:text-purple-400 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {content.content}
          </span>
        </div>
        {hasFiles && (
          <div className="flex-shrink-0">
            {isExpanded ? 
              <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" /> :
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400 opacity-60" />
            }
          </div>
        )}
      </button>
      
      {hasFiles && isExpanded && (
        <div className="border-t border-gray-200/50 dark:border-gray-700/50 max-h-60 overflow-y-auto scrollbar-thin bg-gray-50/20 dark:bg-gray-900/10">
          <div className="px-4 py-2 text-xs">
            {filesList.map((file, i) => (
              <div key={i} className="py-1 font-mono text-gray-700 dark:text-gray-300 truncate flex items-center gap-2">
                <FileIcon filePath={file} size={14} />
                <span>{file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * CancelledCard - Cursor/Copilot-style cancelled task card with Resume button
 */
function CancelledCard({ content }: { content: MessageContent }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const isRunning = useStore(state => state.isRunning);
  const removeCancelledMessage = useStore(state => state.removeCancelledMessage);
  const [isResuming, setIsResuming] = useState(false);

  const { runJob } = useJobExecution();
  const jobId = content.metadata?.jobId;

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
            Task cancelled
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

