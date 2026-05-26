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
import { TurnCardShell, type TurnCardAccent } from './cards/TurnCardShell';

const ansiConverter = new Convert({
  fg: 'currentColor',
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

  let iconColorVar: string;
  let labelColorVar: string;
  let label: string;
  let accent: TurnCardAccent;
  if (isPolicyRejection) {
    iconColorVar = 'var(--amber-500)';
    labelColorVar = 'var(--amber-500)';
    label = isSkipped ? t('card.skipped') : t('card.rejected');
    accent = 'warning';
  } else if (isSuccess) {
    iconColorVar = 'var(--status-done-fg)';
    labelColorVar = 'var(--status-done-fg)';
    label = t('card.completed');
    accent = 'success';
  } else if (isCompleted) {
    iconColorVar = 'var(--red-500)';
    labelColorVar = 'var(--red-500)';
    label = t('card.failed');
    accent = 'error';
  } else {
    iconColorVar = 'var(--violet-500)';
    labelColorVar = 'var(--text-1)';
    label = t('card.running');
    accent = 'default';
  }

  const outputHtml = useMemo(
    () => output ? ansiConverter.toHtml(output) : '',
    [output],
  );
  const hasOutput = output && output.trim().length > 0;
  const canToggleOutput = hasOutput && isCompleted;

  return (
    <TurnCardShell accent={accent} hoverLift={!!canToggleOutput}>
      {/* Header */}
      <div
        role="button"
        tabIndex={canToggleOutput ? 0 : undefined}
        onClick={() => canToggleOutput && setIsCollapsed(!isCollapsed)}
        onKeyDown={(e) => { if (canToggleOutput && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsCollapsed(!isCollapsed); } }}
        className={`w-full px-2.5 py-1.5 ${canToggleOutput ? 'cursor-pointer' : 'cursor-default'} transition-colors select-none`}
        style={{ background: 'transparent' }}
      >
        <div
          className="flex items-center gap-1.5"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}
        >
          {/* Status Icon */}
          {isActive ? (
            <span className="flex-shrink-0 inline-flex" style={{ color: iconColorVar }}>
              <Spinner size="md" tone="inherit" />
            </span>
          ) : isPolicyRejection ? (
            <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: iconColorVar }} />
          ) : (
            <Terminal className="w-4 h-4 flex-shrink-0" style={{ color: iconColorVar }} />
          )}

          {/* Command text + expand toggle for long commands */}
          <TruncatableText
            text={command || ''}
            maxLength={60}
            className="text-[11px]"
            buttonClassName="opacity-60"
          />

          {/* Status indicator — numeric exit code for real executions,
              label for Policy rejections (where "-1" would mislead users). */}
          {isCompleted && exitCode !== undefined && (
            isPolicyRejection ? (
              <span
                className="text-[10px] flex-shrink-0 font-medium"
                style={{ color: labelColorVar, fontFamily: 'var(--font-mono)' }}
              >
                {label}
              </span>
            ) : (
              <span
                className="text-[10px] flex-shrink-0 font-medium"
                style={{ color: labelColorVar, fontFamily: 'var(--font-mono)' }}
              >
                {isSuccess ? '✓' : `✗ ${exitCode}`}
              </span>
            )
          )}

          {/* Output expand/collapse icon */}
          {canToggleOutput && (
            <div className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>
              {isCollapsed ?
                <ChevronRight className="w-3.5 h-3.5 opacity-60" /> :
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              }
            </div>
          )}
        </div>
      </div>

      {/* Output (auto-expand during streaming, collapsible when complete) */}
      {shouldShowOutput && (
        <div style={{ borderTop: '1px solid var(--border-1)' }}>
          <div
            ref={outputRef}
            className="max-h-[300px] overflow-y-auto scrollbar-thin px-4 py-3"
            style={{ overflowAnchor: 'none', background: 'var(--bg-surface-2)' }}
          >
            <pre
              className="text-xs whitespace-pre-wrap break-words"
              style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}
              dangerouslySetInnerHTML={{ __html: outputHtml }}
            />
          </div>
        </div>
      )}
    </TurnCardShell>
  );
});
