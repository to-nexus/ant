/**
 * WorkerGroupDock — fixed strip above the chat input giving always-available
 * access to the latest parallel turn's worker groups (plan
 * curious-spinning-twilight, Part C Phase 2).
 *
 * Deliberately independent of the token ring gauge: rings live and die with
 * the workers, but the tasks' chat records persist — this dock's lifecycle
 * follows the chat record (the latest turn that has worker sections), so a
 * completed job's groups stay reachable until the next user turn replaces
 * them. Bottom placement keeps the top edge single-owner for PinnedQuery's
 * inset math.
 */

import { memo, useMemo } from 'react';
import { Check, XCircle } from 'lucide-react';
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
  workerTintBg,
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
  status: ReturnType<typeof sectionStatus>;
}

function chipsOf(turn: Turn): DockChip[] {
  const chips: DockChip[] = [];
  for (const section of turn.sections) {
    if (!isWorkerGroupScope(section.workerScope)) continue;
    const parsed = parseWorkerScope(section.workerScope);
    chips.push({
      turnId: turn.turnId,
      workerScope: section.workerScope,
      label: sectionTaskName(section) ?? parsed?.taskKey ?? section.workerScope,
      workerId: parsed?.workerId,
      status: sectionStatus(section),
    });
  }
  return chips;
}

function StatusGlyph({ status, hue }: { status: DockChip['status']; hue: number }) {
  if (status === 'active') {
    return (
      <span className="inline-flex flex-shrink-0" style={{ color: workerTintFg(hue) }}>
        <Spinner size="sm" tone="inherit" />
      </span>
    );
  }
  if (status === 'failed') {
    return <XCircle className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--red-500)' }} />;
  }
  return <Check className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--status-done-fg)' }} />;
}

export const WorkerGroupDock = memo(function WorkerGroupDock({ turns }: WorkerGroupDockProps) {
  const { t } = useTranslation('chat');
  const expandChatGroup = useStore((s) => s.expandChatGroup);
  const requestChatJump = useStore((s) => s.requestChatJump);

  // The dock mirrors the LATEST turn only: while a job runs that is the live
  // parallel turn; after completion it stays until the next user turn
  // replaces it (chat-record lifecycle, not worker lifecycle).
  const chips = useMemo(() => {
    const last = turns[turns.length - 1];
    return last ? chipsOf(last) : [];
  }, [turns]);

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
            className="inline-flex items-center gap-1.5 px-2 flex-shrink-0 cursor-pointer min-w-0"
            style={{
              height: 24,
              maxWidth: 180,
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-1)',
              background: 'var(--bg-surface-2)',
            }}
          >
            <span
              className="inline-flex items-center px-1 font-medium text-[10px] flex-shrink-0"
              style={{
                height: 14,
                borderRadius: 'var(--r-pill)',
                background: workerTintBg(hue),
                color: workerTintFg(hue),
              }}
            >
              {chip.workerId !== undefined ? `W${chip.workerId}` : '·'}
            </span>
            <span className="text-[11px] truncate min-w-0" style={{ color: 'var(--text-2)' }}>
              {chip.label}
            </span>
            <StatusGlyph status={chip.status} hue={hue} />
          </button>
        );
      })}
    </div>
  );
});
