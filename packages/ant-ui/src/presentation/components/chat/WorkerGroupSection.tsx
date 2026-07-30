/**
 * WorkerGroupSection — collapsible container for one parallel worker's chat
 * section (plan curious-spinning-twilight, Part C).
 *
 * Parallel turns previously rendered every worker's stream as an always-
 * expanded flat stack inside one Virtuoso row: deltas appended to an earlier
 * worker's section pushed every later section down on each chunk. Collapsed
 * groups here have CONSTANT height — a fixed-height header whose one-line
 * live ticker swaps text in place — so streaming into a non-focused group
 * produces zero layout movement.
 *
 * Invariants (ChatHistory autoscroll/pin):
 *  - collapse state lives in chatSlice (`chatGroupOverrides`), NEVER in the
 *    projector's inputs — `Turn` refs stay stable across toggles;
 *  - a toggle changes row height only → Virtuoso re-measures and
 *    `totalListHeightChanged` re-runs the pin recompute;
 *  - the collapsed body renders `null` (not display:none) — no hidden
 *    ReactMarkdown work for collapsed groups;
 *  - no height animation (it would fight Virtuoso measurement).
 */

import { memo, useCallback, useMemo } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { TurnSection } from '@/domain/store/selectors/chat';
import { Spinner } from '@/presentation/components/common/async';
import { TurnCardShell, type TurnCardAccent } from './cards/TurnCardShell';
import { useRegisterGroup } from './workerGroupRegistry';
import {
  groupOverrideKey,
  parseWorkerScope,
  resolveGroupCollapsed,
  sectionDurationMs,
  sectionHasUnresolvedChoice,
  sectionStatus,
  sectionStepCount,
  sectionTaskName,
  sectionTicker,
  workerHue,
  workerTintBg,
  workerTintFg,
  type WorkerGroupStatus,
} from './workerGroupPolicy';

const STATUS_ACCENT: Record<WorkerGroupStatus, TurnCardAccent> = {
  active: 'info',
  completed: 'success',
  failed: 'error',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export interface WorkerGroupSectionProps {
  turnId: string;
  section: TurnSection;
  /** Count of worker-scoped sections in this turn (collapse default input). */
  workerSectionCount: number;
  /** The section body (SectionStack content) — rendered only when expanded. */
  children: ReactNode;
}

export const WorkerGroupSection = memo(function WorkerGroupSection({
  turnId,
  section,
  workerSectionCount,
  children,
}: WorkerGroupSectionProps) {
  const { t } = useTranslation('chat');
  const key = groupOverrideKey(turnId, section.workerScope);
  const override = useStore((s) => s.chatGroupOverrides[key]);
  const toggleChatGroup = useStore((s) => s.toggleChatGroup);
  const registerGroup = useRegisterGroup(turnId, section.workerScope);

  const parsed = useMemo(() => parseWorkerScope(section.workerScope), [section.workerScope]);
  // Section ref is per-turn-stable (selectTurns cache) — these recompute
  // only when this section actually changed.
  const status = useMemo(() => sectionStatus(section), [section]);
  const hasChoice = useMemo(() => sectionHasUnresolvedChoice(section), [section]);
  const taskName = useMemo(() => sectionTaskName(section), [section]);
  const collapsed = resolveGroupCollapsed(section, workerSectionCount, override);
  const ticker = useMemo(
    () => (collapsed && status === 'active' ? sectionTicker(section) : undefined),
    [collapsed, status, section],
  );

  const onToggle = useCallback(() => {
    toggleChatGroup(turnId, section.workerScope, collapsed);
  }, [toggleChatGroup, turnId, section.workerScope, collapsed]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  const hue = workerHue(parsed?.workerId);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const stepCount = sectionStepCount(section);
  const duration = formatDuration(sectionDurationMs(section));

  return (
    <TurnCardShell nested accent={STATUS_ACCENT[status]} ref={registerGroup}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className="flex items-center gap-2 w-full min-w-0 cursor-pointer select-none px-3"
        style={{ minHeight: 40, paddingTop: 10, paddingBottom: 10 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
      >
        <Chevron
          className="w-3.5 h-3.5 flex-shrink-0 opacity-60"
          style={{
            color: 'var(--text-3)',
            transition: 'transform var(--dur-fast) var(--ease-smooth)',
          }}
        />
        <span
          className="flex-shrink-0 inline-flex items-center px-1.5 font-medium text-[11px]"
          style={{
            height: 18,
            borderRadius: 'var(--r-pill)',
            background: workerTintBg(hue),
            color: workerTintFg(hue),
          }}
        >
          {parsed?.workerId !== undefined ? `W${parsed.workerId}` : parsed?.workerLabel ?? ''}
        </span>
        <span
          className="text-[13px] font-medium truncate min-w-0"
          style={{ color: 'var(--text-1)' }}
        >
          {taskName ?? t('workerGroup.untitled')}
        </span>
        {parsed?.cycleSeq !== undefined && (
          <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
            {t('workerGroup.retry', { n: parsed.cycleSeq })}
          </span>
        )}
        <span className="flex-1 min-w-0 flex items-center justify-end gap-2">
          {ticker && (
            <span
              className="shimmer-text truncate text-[11px] min-w-0"
              style={{ color: 'var(--text-3)', height: 14, lineHeight: '14px' }}
            >
              {ticker}
            </span>
          )}
          {collapsed && status !== 'active' && (
            <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
              {t('workerGroup.summary', { count: stepCount })}
              {duration ? ` · ${duration}` : ''}
            </span>
          )}
          {hasChoice && (
            <span
              className="flex-shrink-0 inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--amber-500)' }}
              aria-label={t('workerGroup.needsAttention')}
            />
          )}
          <span className="flex-shrink-0 inline-flex items-center">
            {status === 'active' && (
              <span style={{ color: workerTintFg(hue) }}>
                <Spinner size="md" tone="inherit" />
              </span>
            )}
            {status === 'completed' && (
              <Check className="w-3.5 h-3.5" style={{ color: 'var(--status-done-fg)' }} />
            )}
            {status === 'failed' && (
              <XCircle className="w-3.5 h-3.5" style={{ color: 'var(--red-500)' }} />
            )}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div
          className="px-3 pb-3 pt-2"
          style={{ borderTop: '1px solid var(--border-1)' }}
        >
          {children}
        </div>
      )}
    </TurnCardShell>
  );
});
