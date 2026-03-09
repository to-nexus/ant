/**
 * TerminalCard - Terminal-style command execution card
 * Used for: command_running, command_streaming, command
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';

interface TerminalCardProps {
  content: MessageContent;
  isStreaming?: boolean;
}

export function TerminalCard({ content }: TerminalCardProps) {
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
  const [isCommandExpanded, setIsCommandExpanded] = useState(false);
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
  const isLongCommand = command && command.length > 60;
  const canToggleOutput = hasOutput && isCompleted;
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden ${config.bgColor}`}>
      {/* Header */}
      <div
        role="button"
        tabIndex={canToggleOutput ? 0 : undefined}
        onClick={() => canToggleOutput && setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => { if (canToggleOutput && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsCollapsed(!isCollapsed); } }}
        className={`w-full ${config.headerBg} px-3 py-2.5 ${canToggleOutput ? config.hoverBg + ' cursor-pointer' : 'cursor-default'} transition-colors select-none`}
      >
        <div className="flex items-center gap-2">
          {/* Status Icon */}
          {isActive ? (
            <Loader2 className={`w-4 h-4 ${config.iconColor} animate-spin flex-shrink-0`} />
          ) : (
            <Terminal className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          )}
          
          {/* Command text + expand toggle for long commands */}
          <span
            className={`text-xs font-mono ${config.textColor} flex-1 text-left ${isCommandExpanded ? 'whitespace-pre-wrap break-all' : 'truncate'} ${isLongCommand ? 'cursor-pointer hover:opacity-80' : ''}`}
            onClick={(e) => {
              if (isLongCommand) {
                e.stopPropagation();
                setIsCommandExpanded(!isCommandExpanded);
              }
            }}
            title={isLongCommand && !isCommandExpanded ? command : undefined}
          >
            {command}
          </span>
          
          {/* Command expand/collapse indicator for long commands */}
          {isLongCommand && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsCommandExpanded(!isCommandExpanded); }}
              className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
              title={isCommandExpanded ? 'Collapse command' : 'Expand command'}
            >
              {isCommandExpanded
                ? <ChevronUp className={`w-3 h-3 ${config.textColor} opacity-60`} />
                : <ChevronDown className={`w-3 h-3 ${config.textColor} opacity-60`} />
              }
            </button>
          )}
          
          {/* Exit Code (Compact) */}
          {isCompleted && exitCode !== undefined && (
            <span className={`text-[10px] font-mono ${isSuccess ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} flex-shrink-0 font-medium`}>
              {isSuccess ? '✓' : `✗ ${exitCode}`}
            </span>
          )}
          
          {/* Output expand/collapse icon */}
          {canToggleOutput && (
            <div className="flex-shrink-0">
              {isCollapsed ? 
                <ChevronRight className={`w-4 h-4 ${config.textColor} opacity-60`} /> :
                <ChevronDown className={`w-4 h-4 ${config.textColor} opacity-60`} />
              }
            </div>
          )}
        </div>
      </div>
      
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
