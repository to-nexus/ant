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

interface ContextLoadedCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

export const ContextLoadedCard = memo(function ContextLoadedCard({ line, pending }: ContextLoadedCardProps) {
  const content = lineToContent(line, pending);
  const items = content.metadata?.items as Array<{ label: string; detail?: string }> | undefined;

  // Fallback to content string if no structured items
  if (!items || items.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg 
                      bg-teal-50/50 dark:bg-teal-900/15 border border-teal-200/60 dark:border-teal-800/40">
        <BookOpen className="w-3.5 h-3.5 flex-shrink-0 text-teal-600 dark:text-teal-400" />
        <span className="text-xs font-medium text-teal-800 dark:text-teal-300">
          {content.content || 'Context loaded'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg 
                    bg-teal-50/50 dark:bg-teal-900/15 border border-teal-200/60 dark:border-teal-800/40">
      <BookOpen className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
        {items.map((item, idx) => (
          <span key={idx} className="text-xs inline-flex items-center gap-1">
            <span className="font-medium text-teal-800 dark:text-teal-300">{item.label}</span>
            {item.detail && (
              <span className="text-teal-600/70 dark:text-teal-400/60">{item.detail}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
});
