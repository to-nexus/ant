/**
 * TerminalCard - Terminal-style command execution card
 * Used for: command_running, command_streaming, command
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import Convert from 'ansi-to-html';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { TruncatableText } from '@/presentation/components/common/TruncatableText';
import { lineToContent } from './cards/lineToContent';

const ansiConverter = new Convert({
  fg: '#d4d4d4',
  bg: 'transparent',
  newline: false,
  escapeXML: true,
});

interface TerminalCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  isStreaming?: boolean;
}

export const TerminalCard = memo(function TerminalCard({ line, pending }: TerminalCardProps) {
  const content = lineToContent(line, pending);
  const { t } = useTranslation('chat');
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
  
  // `exitCode === -1` is a sentinel set by every Policy-rejection path
  // (`runCommand.ts::makeRejection`, verification/error task-hook reject,
  // `codeCommandPolicy.ts::makeRejection`). These aren't command execution
  // failures — they're internal guards ("SKIPPED: deps already installed",
  // "COMMAND NOT ALLOWED", "COMMAND MAY HANG", write-path violations, …).
  // Render them with a distinct amber tone so the user does not read a
  // skip-guard as "npm install ran and failed silently".
  const isPolicyRejection = isCompleted && exitCode === -1;
  const isSuccess = !isPolicyRejection && exitCode === 0;
  const isSkipped = isPolicyRejection && typeof output === 'string' && output.includes('SKIPPED:');

  let statusConfig: {
    bgColor: string;
    borderColor: string;
    textColor: string;
    iconColor: string;
    headerBg: string;
    hoverBg: string;
    label: string;
  };
  if (isPolicyRejection) {
    statusConfig = {
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-amber-500 dark:text-amber-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
      label: isSkipped ? t('card.skipped') : t('card.rejected')
    };
  } else if (isSuccess) {
    statusConfig = {
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-green-500 dark:text-green-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
      label: t('card.completed')
    };
  } else {
    statusConfig = {
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-red-500 dark:text-red-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
      label: t('card.failed')
    };
  }
  
  const activeConfig = {
    bgColor: 'bg-white dark:bg-gray-800/50',
    borderColor: 'border-gray-200 dark:border-gray-700',
    textColor: 'text-gray-700 dark:text-gray-300',
    iconColor: 'text-blue-500 dark:text-blue-400',
    headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
    hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50',
    label: t('card.running')
  };
  
  const config = isActive ? activeConfig : statusConfig;
  const outputHtml = useMemo(
    () => output ? ansiConverter.toHtml(output) : '',
    [output],
  );
  const hasOutput = output && output.trim().length > 0;
  const canToggleOutput = hasOutput && isCompleted;
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden ${config.bgColor}`}>
      {/* Header */}
      <div
        role="button"
        tabIndex={canToggleOutput ? 0 : undefined}
        onClick={() => canToggleOutput && setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => { if (canToggleOutput && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsCollapsed(!isCollapsed); } }}
        className={`w-full ${config.headerBg} px-2.5 py-1.5 ${canToggleOutput ? config.hoverBg + ' cursor-pointer' : 'cursor-default'} transition-colors select-none`}
      >
        <div className="flex items-center gap-1.5">
          {/* Status Icon */}
          {isActive ? (
            <Spinner size="md" tone="inherit" className={`flex-shrink-0 ${config.iconColor}`} />
          ) : isPolicyRejection ? (
            <ShieldAlert className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          ) : (
            <Terminal className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          )}

          {/* Command text + expand toggle for long commands */}
          <TruncatableText
            text={command || ''}
            maxLength={60}
            className={`text-[11px] font-mono ${config.textColor}`}
            buttonClassName={`${config.textColor} opacity-60`}
          />
          
          {/* Status indicator — numeric exit code for real executions,
              label for Policy rejections (where "-1" would mislead users). */}
          {isCompleted && exitCode !== undefined && (
            isPolicyRejection ? (
              <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 flex-shrink-0 font-medium">
                {config.label}
              </span>
            ) : (
              <span className={`text-[10px] font-mono ${isSuccess ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} flex-shrink-0 font-medium`}>
                {isSuccess ? '✓' : `✗ ${exitCode}`}
              </span>
            )
          )}
          
          {/* Output expand/collapse icon */}
          {canToggleOutput && (
            <div className="flex-shrink-0">
              {isCollapsed ?
                <ChevronRight className={`w-3.5 h-3.5 ${config.textColor} opacity-60`} /> :
                <ChevronDown className={`w-3.5 h-3.5 ${config.textColor} opacity-60`} />
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
            <pre
              className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{ __html: outputHtml }}
            />
          </div>
        </div>
      )}
    </div>
  );
});
