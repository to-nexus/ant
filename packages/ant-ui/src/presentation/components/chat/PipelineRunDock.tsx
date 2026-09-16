/**
 * PipelineRunDock — strip above the chat input listing the LIVE runs of the
 * selected project's activation, one chip each (the WorkerGroupDock shape for
 * pipeline runs). The chat itself stays a flat turn list — a run spans many
 * turns, so turns are never grouped by run; a chip jumps to the run's latest
 * turn, and the trailing ✕ cancels that run (the chat's Stop cannot pick
 * between N runs). Store-driven: chips come from `liveRuns`, not from
 * scrollback, so a run with no turn yet is still visible.
 */

import { memo } from 'react';
import { XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import type { Turn } from '@/domain/store/selectors/chat';
import { selectLiveRunsForSelectedProject } from '@/domain/store/selectors/pipelines';
import { cancelPipelineRun } from '@/infrastructure/http/api/pipelines';
import { Spinner } from '@/presentation/components/common/async';
import { FIRED_BY_ICON, runHue, runLabel, runTintFg } from '@/presentation/components/Pipelines/runIdentity';

export interface PipelineRunDockProps {
  turns: Turn[];
}

/** The run's latest turn in this chat, if it has posted one. */
function latestTurnOf(turns: Turn[], runId: string): Turn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].user?.pipeline?.runId === runId) return turns[i];
  }
  return undefined;
}

export const PipelineRunDock = memo(function PipelineRunDock({ turns }: PipelineRunDockProps) {
  const { t } = useTranslation('chat');
  const liveRuns = useStore(selectLiveRunsForSelectedProject);
  const requestChatJump = useStore((s) => s.requestChatJump);

  if (liveRuns.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 px-3 overflow-x-auto flex-shrink-0"
      style={{ height: 36, background: 'var(--bg-surface)', borderTop: '1px solid var(--border-1)' }}
      aria-label={t('pipelineDock.label', 'Live pipeline runs')}
    >
      {liveRuns.map((run) => {
        const hue = runHue(run.runId);
        const label = runLabel(run);
        const target = latestTurnOf(turns, run.runId);
        const FiredIcon = FIRED_BY_ICON[run.firedBy];
        const awaiting = run.status === 'awaiting_human';
        return (
          <span
            key={run.runId}
            className="inline-flex items-center flex-shrink-0 min-w-0"
            style={{
              height: 24,
              maxWidth: 220,
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-1)',
              borderLeft: `3px solid ${runTintFg(hue)}`,
              background: 'var(--bg-surface-2)',
            }}
          >
            <button
              type="button"
              disabled={!target}
              title={target ? t('pipelineDock.jumpTo', 'Jump to the latest turn of run {{label}}', { label }) : t('pipelineDock.noTurnYet', 'Run {{label}} has not posted a turn yet', { label })}
              onClick={() => target && requestChatJump(target.turnId, '')}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 min-w-0 cursor-pointer disabled:cursor-default"
              style={{ height: '100%', background: 'none', border: 'none', color: 'var(--text-2)' }}
            >
              <FiredIcon size={11} style={{ flexShrink: 0, color: runTintFg(hue) }} />
              <span className="text-[11px] truncate min-w-0" style={{ fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
              {awaiting ? (
                <span className="flex-shrink-0 rounded-full" style={{ width: 7, height: 7, background: 'var(--amber-500)' }} title={t('pipelineDock.awaiting', 'Waiting on a person')} />
              ) : (
                <span className="inline-flex flex-shrink-0" style={{ color: runTintFg(hue) }}>
                  <Spinner size="sm" tone="inherit" />
                </span>
              )}
            </button>
            <button
              type="button"
              title={t('pipelineDock.cancel', 'Cancel run {{label}}', { label })}
              aria-label={t('pipelineDock.cancel', 'Cancel run {{label}}', { label })}
              onClick={() => {
                if (window.confirm(t('pipelineDock.cancelConfirm', 'Cancel pipeline run {{label}}? Its steps stop and the run is marked cancelled.', { label }))) {
                  void cancelPipelineRun(run.runId);
                }
              }}
              className="inline-flex items-center justify-center flex-shrink-0 cursor-pointer"
              style={{ width: 22, height: '100%', background: 'none', border: 'none', color: 'var(--text-3)' }}
            >
              <XCircle size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
});
