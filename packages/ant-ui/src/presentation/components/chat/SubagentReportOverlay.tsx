/**
 * SubagentReportOverlay — chat-pane-covering panel that renders one explore
 * subagent's full report (markdown). Opens from a SubagentCard click; mounts
 * at ChatPanel level (absolute inset-0 inside the history container) so it
 * survives the card's Virtuoso unmount. Escape / close button returns to the
 * normal chat.
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileSearch, AlertTriangle, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SubagentReportMetadata } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectSubagentReportLine } from '@/domain/store/selectors/chat';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';

const REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_COMPONENTS = createMarkdownComponents();

function stateBadge(state: SubagentReportMetadata['state'] | undefined): {
  Icon: typeof FileSearch;
  color: string;
} {
  switch (state) {
    case 'partial':
    case 'aborted':
      return { Icon: AlertTriangle, color: 'var(--amber-500)' };
    case 'error':
      return { Icon: XCircle, color: 'var(--red-500)' };
    default:
      return { Icon: FileSearch, color: 'var(--violet-500)' };
  }
}

export const SubagentReportOverlay = memo(function SubagentReportOverlay() {
  const { t } = useTranslation('chat');
  const cardId = useStore((s) => s.openSubagentReportCardId);
  const closeSubagentReport = useStore((s) => s.closeSubagentReport);
  const line = useStore((s) => selectSubagentReportLine(s, cardId));
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const metadata = (line?.metadata ?? {}) as Partial<SubagentReportMetadata>;
  const report = typeof metadata.report === 'string' ? metadata.report : '';
  const isOpen = !!cardId && !!line && report.length > 0;

  // Stale cardId (chat cleared / line gone) — release the store flag so a
  // later valid open is not blocked by dead state.
  useEffect(() => {
    if (cardId && !line) closeSubagentReport();
  }, [cardId, line, closeSubagentReport]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSubagentReport();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeSubagentReport]);

  const { Icon, color } = useMemo(() => stateBadge(metadata.state), [metadata.state]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: 'var(--bg-surface)' }}
      role="dialog"
      aria-label={t('subagent.overlay.title')}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-1)' }}
      >
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {t('subagent.overlay.title')}
            </div>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium"
              style={{ background: 'var(--bg-surface-2)', color: 'var(--violet-500)' }}
            >
              {t('subagent.badge')}
            </span>
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--text-3)' }} title={metadata.goal}>
            {metadata.goal}
          </div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label={t('subagent.overlay.close')}
          onClick={closeSubagentReport}
          className="p-1.5 rounded-md flex-shrink-0 turn-card-hover"
          style={{ color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Report body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {report}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});
