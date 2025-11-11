/**
 * MessageItem - Individual message display
 * 
 * Renders different content types: thinking, text, file operations, commands
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, FileEdit, FilePlus, Trash2, Terminal, ChevronDown, ChevronRight, FileCode, 
         Search, FileSearch, Eye, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, MessageContent } from '@/domain/models/chat';

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
  
  // ✅ Cursor-style: Expand/collapse state (must be at top level for Hooks rules)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  
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
    case 'thinking':
      // ✅ Cursor 스타일: 스트리밍 중 = 펼침, 완료 후 = 접힘 (클릭하면 펼침)
      const isPlanning = content.content.trim() === 'Planning next moves...';
      const isThinkingCollapsed = !isStreaming && !isThinkingExpanded;
      
      return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-gray-50/30 dark:bg-gray-800/30">
          {/* Header - clickable when completed */}
          <button
            onClick={() => !isStreaming && !isPlanning && setIsThinkingExpanded(!isThinkingExpanded)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 ${!isStreaming && !isPlanning ? 'hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer' : ''}`}
            disabled={isStreaming || isPlanning}
          >
            <Brain className="w-3 h-3 text-gray-400 dark:text-gray-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {isPlanning ? 'Planning next moves...' : (isStreaming ? 'Thinking...' : 'Thought')}
            </span>
            {!isStreaming && !isPlanning && content.content && (
              <ChevronRight className={`w-3 h-3 text-gray-400 ml-auto transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} />
            )}
          </button>
          
          {/* Content - show during streaming or when expanded (but not for "Planning next moves...") */}
          {content.content && !isPlanning && !isThinkingCollapsed && (
            <div className="px-4 py-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-gray-50/20 dark:bg-gray-900/20 max-h-48 overflow-y-auto scrollbar-thin">
              <pre className="whitespace-pre-wrap font-mono opacity-60">{content.content}</pre>
            </div>
          )}
        </div>
      );

    case 'text':
      // ✅ Cursor-style: Show limited content with "Show more" button
      const CHAR_LIMIT = 2000;
      const isLongContent = content.content.length > CHAR_LIMIT;
      const displayContent = (!isExpanded && isLongContent) 
        ? content.content.slice(0, CHAR_LIMIT) 
        : content.content;
      
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
                {displayContent}
              </ReactMarkdown>
            </div>
            
          {/* ✅ Show more/less button (Cursor-style) */}
          {isLongContent && !isStreaming && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 
                         hover:text-gray-900 dark:hover:text-gray-200 
                         bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                         rounded transition-colors"
            >
              {isExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
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
  
  // Auto-expand when streaming, collapsible when complete
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldShowOutput = (isStreamingOutput || isExpanded) && output;
  
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
        bgColor: 'bg-green-50 dark:bg-green-900/20',
        borderColor: 'border-green-200 dark:border-green-800',
        textColor: 'text-green-700 dark:text-green-300',
        iconColor: 'text-green-600 dark:text-green-400',
        headerBg: 'bg-green-100 dark:bg-green-900/30',
        label: 'Completed'
      }
    : {
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-200 dark:border-red-800',
        textColor: 'text-red-700 dark:text-red-300',
        iconColor: 'text-red-600 dark:text-red-400',
        headerBg: 'bg-red-100 dark:bg-red-900/30',
        label: 'Failed'
      };
  
  const activeConfig = {
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    textColor: 'text-blue-700 dark:text-blue-300',
    iconColor: 'text-blue-600 dark:text-blue-400',
    headerBg: 'bg-blue-100 dark:bg-blue-900/30',
    label: isRunning ? 'Running...' : 'Running...'
  };
  
  const config = isActive ? activeConfig : statusConfig;
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden`}>
      {/* Header - Cursor Style */}
      <div className={`${config.headerBg} px-3 py-2`}>
        <div className="flex items-center gap-2 mb-1">
          <Terminal className={`w-4 h-4 ${config.iconColor}`} />
          <span className={`text-sm font-mono font-medium ${config.textColor} truncate flex-1`}>
            {command}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            {isActive ? (
              <Loader2 className={`w-3.5 h-3.5 ${config.iconColor} animate-spin`} />
            ) : (
              <Terminal className={`w-3.5 h-3.5 ${config.iconColor}`} />
            )}
            <span className={`font-medium ${config.textColor}`}>
              {config.label}
            </span>
          </div>
          {isCompleted && exitCode !== undefined && (
            <span className={`font-mono ${config.textColor}`}>
              Exit code: {exitCode}
            </span>
          )}
          {/* Show/Hide button - only when completed and has output */}
          {isCompleted && output && (
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className={`ml-auto flex items-center gap-1 ${config.textColor} hover:opacity-70 transition-opacity`}
            >
              <span className="text-xs">
                {isExpanded ? 'Hide' : 'Show'} output
              </span>
              {isExpanded ? 
                <ChevronDown className="w-3.5 h-3.5" /> :
                <ChevronRight className="w-3.5 h-3.5" />
              }
            </button>
          )}
        </div>
      </div>
      
      {/* Output (auto-expand during streaming, collapsible when complete) */}
      {shouldShowOutput && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div 
            ref={outputRef}
            className="max-h-60 overflow-y-auto scrollbar-thin bg-gray-50 dark:bg-gray-900/50 px-4 py-3"
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
    <div className="border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-blue-50 dark:bg-blue-900/20">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => hasFiles && setIsExpanded(!isExpanded)}
      >
        <FileSearch className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {content.content}
          </span>
        </div>
        {hasFiles && (
          isExpanded ? 
            <ChevronDown className="w-4 h-4 text-blue-600 dark:text-blue-400" /> :
            <ChevronRight className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        )}
      </div>
      
      {hasFiles && isExpanded && (
        <div className="border-t border-blue-200 dark:border-blue-700 max-h-60 overflow-y-auto scrollbar-thin bg-white dark:bg-gray-900/50">
          <div className="px-4 py-2 text-xs">
            {filesList.map((file, i) => (
              <div key={i} className="py-1 font-mono text-gray-700 dark:text-gray-300 truncate">
                📄 {file}
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
    <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden bg-purple-50 dark:bg-purple-900/20">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => hasFiles && setIsExpanded(!isExpanded)}
      >
        <Search className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
            {content.content}
          </span>
        </div>
        {hasFiles && (
          isExpanded ? 
            <ChevronDown className="w-4 h-4 text-purple-600 dark:text-purple-400" /> :
            <ChevronRight className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        )}
      </div>
      
      {hasFiles && isExpanded && (
        <div className="border-t border-purple-200 dark:border-purple-700 max-h-60 overflow-y-auto scrollbar-thin bg-white dark:bg-gray-900/50">
          <div className="px-4 py-2 text-xs">
            {filesList.map((file, i) => (
              <div key={i} className="py-1 font-mono text-gray-700 dark:text-gray-300 truncate">
                🔍 {file}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FileCard - Cursor-style file operation card with real-time streaming
 */
interface FileCardProps {
  content: MessageContent;
  operation: 'create' | 'edit' | 'delete';
  isStreaming?: boolean;
}

function FileCard({ content, operation }: FileCardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const filePath = content.metadata?.filePath || 'Unknown file';
  const fileContent = content.content;
  const diffBefore = content.metadata?.diffBefore;
  const diffAfter = content.metadata?.diffAfter;
  
  // Determine streaming state based on content type
  const isCreating = content.type === 'file_creating';
  const isWriting = content.type === 'file_writing';
  const isEditing = content.type === 'file_editing';
  const isUpdating = content.type === 'file_updating';
  const isDeleting = content.type === 'file_deleting';
  const isActive = isCreating || isWriting || isEditing || isUpdating || isDeleting;
  const isCompleted = content.type === 'file_create' || content.type === 'file_edit' || content.type === 'file_delete';
  
  // Auto-expand when streaming/writing, auto-collapse when complete
  const [isExpanded, setIsExpanded] = useState(false);
  // ✅ Only show content when: actively writing OR user manually expanded
  const shouldShowContent = (isWriting || isUpdating || isExpanded) && (fileContent || diffBefore || diffAfter);
  
  // ✅ CRITICAL: Use ref to track previous content length
  const prevContentLengthRef = useRef(0);
  
  // Auto-scroll to bottom during streaming (with requestAnimationFrame for better performance)
  useEffect(() => {
    if ((isWriting || isUpdating) && contentRef.current) {
      const currentLength = (fileContent?.length || 0) + (diffAfter?.length || 0);
      
      // Only scroll if content actually grew
      if (currentLength > prevContentLengthRef.current) {
        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        });
        prevContentLengthRef.current = currentLength;
      }
    }
  }, [fileContent, diffAfter, isWriting, isUpdating]);
  
  // Calculate line stats
  const calculateLineStats = () => {
    if (operation === 'edit' && diffBefore && diffAfter) {
      const beforeLines = diffBefore.split('\n').length;
      const afterLines = diffAfter.split('\n').length;
      const added = afterLines;
      const removed = beforeLines;
      return { added, removed, total: null };
    } else if (fileContent) {
      const totalLines = fileContent.split('\n').length;
      return { 
        added: operation === 'create' ? totalLines : 0, 
        removed: operation === 'delete' ? totalLines : 0,
        total: totalLines 
      };
    }
    return { added: 0, removed: 0, total: 0 };
  };
  
  const lineStats = calculateLineStats();
  
  // Determine operation details
  const operationConfig = {
    create: {
      icon: FilePlus,
      labelCompleted: 'Created',
      labelActive: isCreating ? 'Creating...' : 'Writing...',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      borderColor: 'border-green-200 dark:border-green-800',
      textColor: 'text-green-700 dark:text-green-300',
      iconColor: 'text-green-600 dark:text-green-400',
      headerBg: 'bg-green-100 dark:bg-green-900/30'
    },
    edit: {
      icon: FileEdit,
      labelCompleted: 'Modified',
      labelActive: isEditing ? 'Editing...' : 'Updating...',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
      borderColor: 'border-amber-200 dark:border-amber-800',
      textColor: 'text-amber-700 dark:text-amber-300',
      iconColor: 'text-amber-600 dark:text-amber-400',
      headerBg: 'bg-amber-100 dark:bg-amber-900/30'
    },
    delete: {
      icon: Trash2,
      labelCompleted: 'Deleted',
      labelActive: 'Deleting...',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      borderColor: 'border-red-200 dark:border-red-800',
      textColor: 'text-red-700 dark:text-red-300',
      iconColor: 'text-red-600 dark:text-red-400',
      headerBg: 'bg-red-100 dark:bg-red-900/30'
    }
  };
  
  const config = operationConfig[operation];
  const Icon = config.icon;
  const displayLabel = isActive ? config.labelActive : config.labelCompleted;
  
  // Check if there's content to show
  const hasContent = (operation === 'create' && fileContent) || 
                    (operation === 'edit' && (diffBefore || diffAfter)) ||
                    (operation === 'delete' && fileContent);
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden`}>
      {/* Header - Cursor Style with real-time streaming */}
      <div className={`${config.headerBg} px-3 py-2`}>
        <div className="flex items-center gap-2 mb-1">
          <FileCode className={`w-4 h-4 ${config.iconColor}`} />
          <span className={`text-sm font-mono font-medium ${config.textColor} truncate flex-1`}>
            {filePath}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            {isActive ? (
              <Loader2 className={`w-3.5 h-3.5 ${config.iconColor} animate-spin`} />
            ) : (
              <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
            )}
            <span className={`font-medium ${config.textColor}`}>
              {displayLabel}
            </span>
          </div>
          {/* Line stats - only show when completed or actively streaming with content */}
          {isCompleted && operation === 'edit' && (lineStats.added > 0 || lineStats.removed > 0) && (
            <div className="flex items-center gap-2">
              {lineStats.added >= 0 && (
                <span className="text-green-600 dark:text-green-400 font-mono">
                  +{lineStats.added}
                </span>
              )}
              {lineStats.removed >= 0 && (
                <span className="text-red-600 dark:text-red-400 font-mono">
                  -{lineStats.removed}
                </span>
              )}
            </div>
          )}
          {isCompleted && operation === 'create' && lineStats.total != null && (
            <span className="text-green-600 dark:text-green-400 font-mono">
              +{lineStats.total} {lineStats.total === 1 ? 'line' : 'lines'}
            </span>
          )}
          {isCompleted && operation === 'delete' && lineStats.total != null && (
            <span className="text-red-600 dark:text-red-400 font-mono">
              -{lineStats.total} {lineStats.total === 1 ? 'line' : 'lines'}
            </span>
          )}
          {/* Show/Hide button - only when completed and has content */}
          {isCompleted && hasContent && (
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className={`ml-auto flex items-center gap-1 ${config.textColor} hover:opacity-70 transition-opacity`}
            >
              <span className="text-xs">
                {isExpanded ? 'Hide' : 'Show'} content
              </span>
              {isExpanded ? 
                <ChevronDown className="w-3.5 h-3.5" /> :
                <ChevronRight className="w-3.5 h-3.5" />
              }
            </button>
          )}
        </div>
      </div>
      
      {/* Content (auto-expand during streaming, collapsible when complete) */}
      {shouldShowContent && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {operation === 'edit' && (diffBefore || diffAfter) ? (
            // Diff view for edits (real-time streaming)
            <div ref={contentRef} className="max-h-96 overflow-y-auto scrollbar-thin" style={{ overflowAnchor: 'none' }}>
              {diffBefore && (
                <div className="bg-red-50 dark:bg-red-900/10">
                  <pre className="px-4 py-2 text-xs font-mono text-red-800 dark:text-red-300 whitespace-pre-wrap break-words">
                    {diffBefore.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="text-red-600 dark:text-red-400 mr-2">-</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
              {diffAfter && (
                <div className="bg-green-50 dark:bg-green-900/10">
                  <pre className="px-4 py-2 text-xs font-mono text-green-800 dark:text-green-300 whitespace-pre-wrap break-words">
                    {diffAfter.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="text-green-600 dark:text-green-400 mr-2">+</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          ) : fileContent ? (
            // ✅ File content: ALWAYS show as raw text (no markdown rendering)
            // Virtual scrolling: During streaming, show only last 200 lines
            (() => {
              const lines = fileContent.split('\n');
              const displayContent = (isWriting || isUpdating) && lines.length > 200
                ? '...\n' + lines.slice(-200).join('\n')
                : fileContent;
              
              return (
                <div ref={contentRef} className="max-h-96 overflow-y-auto scrollbar-thin bg-gray-50 dark:bg-gray-900/50" style={{ overflowAnchor: 'none' }}>
                  <pre className="px-4 py-3 text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                    {displayContent}
                  </pre>
                </div>
              );
            })()
          ) : null}
        </div>
      )}
    </div>
  );
}

