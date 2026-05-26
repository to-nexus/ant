/**
 * ContextLoadedCard - Unified notification for loaded context
 *
 * Shows what context the system loaded before processing (eval reports, PRD, design docs, etc.)
 * Compact, non-blocking, informational - not a progress indicator or choice card.
 *
 * Usage: showChatStatus('context_loaded', { items: [{ label: 'Eval report', detail: 'eval-2026-02-10.md' }] })
 */

import { memo } from 'react';
import { BookOpen } from 'lucide-react';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { lineToContent } from './cards/lineToContent';
import { TurnCardShell } from './cards/TurnCardShell';

interface ContextLoadedCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

const TEAL_WASH = 'oklch(from var(--teal-500) 96% 0.04 195 / 0.45)';

export const ContextLoadedCard = memo(function ContextLoadedCard({ line, pending }: ContextLoadedCardProps) {
  const content = lineToContent(line, pending);
  const items = content.metadata?.items as Array<{ label: string; detail?: string }> | undefined;

  // Fallback to content string if no structured items
  if (!items || items.length === 0) {
    return (
      <TurnCardShell hoverLift={false}>
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ background: TEAL_WASH }}
        >
          <BookOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--teal-500)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-1)' }}>
            {content.content || 'Context loaded'}
          </span>
        </div>
      </TurnCardShell>
    );
  }

  return (
    <TurnCardShell hoverLift={false}>
      <div
        className="flex items-start gap-2 px-3 py-2"
        style={{ background: TEAL_WASH }}
      >
        <BookOpen className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--teal-500)' }} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          {items.map((item, idx) => (
            <span key={idx} className="text-xs inline-flex items-center gap-1">
              <span className="font-medium" style={{ color: 'var(--text-1)' }}>{item.label}</span>
              {item.detail && (
                <span style={{ color: 'var(--text-3)' }}>{item.detail}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </TurnCardShell>
  );
});
