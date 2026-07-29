/**
 * SubagentCard — one compact card per explore-subagent launch.
 *
 * Running (`subagent_running`, pending-card channel): borderless line —
 * spinner + shimmering goal + live elapsed (the round counter is
 * intentionally not surfaced). Terminal (`subagent_report`, persisted line):
 * state-accented summary card; clicking opens the full report in a
 * main-panel editor tab when a body exists.
 *
 * The terminal row keeps its state wording on purpose: it has no animation,
 * and `stateVisual` maps `partial` and `aborted` onto the same icon.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, AlertTriangle, XCircle, FileSearch } from 'lucide-react';
import type { ChatStatusLine, PendingCardSnapshot, SubagentReportMetadata } from '@ant/shared';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import { TurnCardShell, type TurnCardAccent } from './cards/TurnCardShell';

interface SubagentCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
}

function stateVisual(state: SubagentReportMetadata['state'] | undefined): {
  accent: TurnCardAccent;
  Icon: typeof Compass;
  color: string;
} {
  switch (state) {
    case 'partial':
      return { accent: 'warning', Icon: AlertTriangle, color: 'var(--amber-500)' };
    case 'error':
      return { accent: 'error', Icon: XCircle, color: 'var(--red-500)' };
    case 'aborted':
      return { accent: 'warning', Icon: XCircle, color: 'var(--amber-500)' };
    case 'done':
    default:
      return { accent: 'info', Icon: FileSearch, color: 'var(--violet-500)' };
  }
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Identity chip — makes it explicit that an independent subagent is at work. */
function SubagentBadge() {
  const { t } = useTranslation('chat');
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium"
      style={{ background: 'var(--bg-surface-2)', color: 'var(--violet-500)' }}
    >
      {t('subagent.badge')}
    </span>
  );
}

/** Live-ticking elapsed seconds. Prefers the BE `startedAt`; if absent, anchors
 *  to first render so the timer never resets across metadata deltas. */
function useElapsedMs(startedAt: string | undefined): number {
  const firstSeenRef = useRef<number>(Date.now());
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const anchor = Number.isFinite(startMs) ? startMs : firstSeenRef.current;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, now - anchor);
}

/**
 * Running row. Extracted so the 1s interval only mounts while a subagent runs.
 *
 * The spinner is the sole VISIBLE progress signal; `subagent.running` moves to
 * `aria-label` so assistive tech still hears what the animation conveys.
 * Metrics mirror WorkingCard's in-flight row — one rhythm for borderless lines.
 */
function SubagentRunningRow({ goal, startedAt }: { goal: string; startedAt?: string }) {
  const { t } = useTranslation('chat');
  const elapsed = formatDuration(useElapsedMs(startedAt)) ?? '0s';
  return (
    <div
      role="status"
      aria-label={t('subagent.running', { goal })}
      className="flex items-center gap-1.5 px-2.5 py-1.5 min-w-0"
    >
      <Spinner size="md" />
      <SubagentBadge />
      <span
        className="gradient-flow text-[11px] font-medium truncate min-w-0"
        title={goal}
        style={{
          backgroundImage: 'var(--gradient-aurora-soft)',
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
        }}
      >
        {goal}
      </span>
      <span className="ml-auto text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-3)' }}>
        {elapsed}
      </span>
    </div>
  );
}

export const SubagentCard = memo(function SubagentCard({ line, pending }: SubagentCardProps) {
  const { t } = useTranslation('chat');
  const openReportEditorTab = useStore((s) => s.openReportEditorTab);

  const metadata = {
    ...(line.metadata ?? {}),
    ...(pending?.metadata ?? {}),
  } as Partial<SubagentReportMetadata>;
  const goal = metadata.goal || '…';
  const isRunning = line.statusType === 'subagent_running';

  const onOpen = useCallback(
    () =>
      openReportEditorTab({
        cardId: line.cardId,
        goal,
        report: metadata.report ?? '',
      }),
    [openReportEditorTab, line.cardId, goal, metadata.report],
  );

  if (isRunning) {
    return <SubagentRunningRow goal={goal} startedAt={metadata.startedAt} />;
  }

  const { accent, Icon, color } = stateVisual(metadata.state);
  const hasReport = typeof metadata.report === 'string' && metadata.report.length > 0;
  const duration = formatDuration(metadata.durationMs);
  const tokens = metadata.usage?.totalTokens;
  const label =
    metadata.state === 'partial' ? t('subagent.partial', { goal })
    : metadata.state === 'error' ? t('subagent.error', { goal })
    : metadata.state === 'aborted' ? t('subagent.aborted', { goal })
    : t('subagent.done', { goal });

  return (
    <TurnCardShell
      accent={accent}
      hoverLift={hasReport}
      className={hasReport ? 'cursor-pointer' : undefined}
      {...(hasReport
        ? { role: 'button', tabIndex: 0, 'aria-label': t('subagent.reportOpenAria', { goal }), onClick: onOpen,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } }
        : {})}
    >
      <div className="flex items-center gap-2 px-3 py-2 min-w-0">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <SubagentBadge />
        <span className="text-xs font-medium truncate min-w-0" style={{ color: 'var(--text-1)' }}>
          {label}
        </span>
        {(duration || typeof tokens === 'number') && (
          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-3)' }}>
            {t('subagent.stats', {
              duration: duration ?? '—',
              tokens: typeof tokens === 'number' ? tokens.toLocaleString() : '—',
            })}
          </span>
        )}
        <span className="ml-auto text-[10px] font-medium flex-shrink-0" style={{ color: hasReport ? color : 'var(--text-3)' }}>
          {hasReport ? t('subagent.viewReport') : t('subagent.noReport')}
        </span>
      </div>
    </TurnCardShell>
  );
});
