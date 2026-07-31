/**
 * WorkerGroupDock — fixed strip above the chat input giving one-click access
 * to the parallel tasks that are RUNNING RIGHT NOW.
 *
 * Live-only by design. A task's chip exists exactly while the task does:
 * it appears when the worker opens the scope and leaves the moment the BE
 * marks the scope terminal, so the dock empties itself as the job winds
 * down and disappears with the last worker. Settled work is not duplicated
 * here — it stays in the scrollback, where `WorkerGroupSection` renders its
 * ✓ / ✗ and the group can be expanded in place.
 *
 * Bottom placement keeps the top edge single-owner for PinnedQuery's inset
 * math.
 */

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { Turn } from '@/domain/store/selectors/chat';
import { Spinner } from '@/presentation/components/common/async';
import {
  isWorkerGroupScope,
  parseWorkerScope,
  sectionStatus,
  sectionTaskName,
  workerHue,
  workerTintFg,
} from './workerGroupPolicy';

export interface WorkerGroupDockProps {
  turns: Turn[];
}

interface DockChip {
  turnId: string;
  workerScope: string;
  label: string;
  workerId?: number;
}

function chipsOf(turn: Turn): DockChip[] {
  const chips: DockChip[] = [];
  for (const section of turn.sections) {
    if (!isWorkerGroupScope(section.workerScope)) continue;
    // Live-only: a settled scope drops out of the dock entirely.
    if (sectionStatus(section) !== 'active') continue;
    const parsed = parseWorkerScope(section.workerScope);
    chips.push({
      turnId: turn.turnId,
      workerScope: section.workerScope,
      label: sectionTaskName(section) ?? parsed?.taskKey ?? section.workerScope,
      workerId: parsed?.workerId,
    });
  }
  return chips;
}

export const WorkerGroupDock = memo(function WorkerGroupDock({ turns }: WorkerGroupDockProps) {
  const { t } = useTranslation('chat');
  const expandChatGroup = useStore((s) => s.expandChatGroup);
  const requestChatJump = useStore((s) => s.requestChatJump);
  const isRunning = useStore((s) => s.isRunning);
  const currentJobId = useStore((s) => s.currentJobId);

  const last = turns[turns.length - 1];

  // Job-liveness floor. `chipsOf` already drops settled scopes, but that
  // depends on the BE marker having landed — a killed worker, a crashed
  // server, or a chat.jsonl recorded before the marker existed would leave
  // scopes permanently "open". Binding the dock to the live job makes its
  // disappearance at job end structural rather than signal-dependent.
  const live = isRunning && !!last && !!currentJobId && last.jobId === currentJobId;

  const chips = useMemo(() => (live && last ? chipsOf(last) : []), [live, last]);

  if (chips.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 px-3 overflow-x-auto flex-shrink-0"
      style={{
        height: 36,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-1)',
      }}
      aria-label={t('workerGroup.dockLabel')}
    >
      {chips.map((chip) => {
        const hue = workerHue(chip.workerId);
        return (
          <button
            key={`${chip.turnId}:${chip.workerScope}`}
            type="button"
            title={t('workerGroup.jumpTo', { label: chip.label })}
            onClick={() => {
              // Expand BEFORE the jump so the target has its final height
              // when ChatHistory's fine-scroll runs.
              expandChatGroup(chip.turnId, chip.workerScope);
              requestChatJump(chip.turnId, chip.workerScope);
            }}
            className="inline-flex items-center gap-1.5 pl-2 pr-2 flex-shrink-0 cursor-pointer min-w-0"
            style={{
              height: 24,
              maxWidth: 180,
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-1)',
              // Worker identity survives as a left accent bar — the `W{n}`
              // text badge carried no meaning the hue doesn't.
              ...(chip.workerId !== undefined
                ? { borderLeft: `3px solid ${workerTintFg(hue)}` }
                : {}),
              background: 'var(--bg-surface-2)',
            }}
          >
            <span className="text-[11px] truncate min-w-0" style={{ color: 'var(--text-2)' }}>
              {chip.label}
            </span>
            <span className="inline-flex flex-shrink-0" style={{ color: workerTintFg(hue) }}>
              <Spinner size="sm" tone="inherit" />
            </span>
          </button>
        );
      })}
    </div>
  );
});
