import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { Modal } from '../Modal';
import { selectProjectDeletionFailedPhase } from '@/domain/store/slices/projectDeletionSlice';
import type { ProjectDeletionSession } from '@/domain/store/types';
import { ProjectDeletionStepRail } from './ProjectDeletionStepRail';

export interface ProjectDeletionPanelProps {
  /**
   * Called when the user clicks "Force Delete" on a failed cascade.
   * Caller dispatches `deleteProject(projectId, { force: true })`.
   */
  onForceDelete: () => void;
}

/**
 * Real-time progress + structured-error popup for project deletion.
 *
 * Renders one of three modes based on `projectDeletionSession.kind`:
 *   - `deleting` — step rail + elapsed counter; not dismissable.
 *   - `completed` — brief success indicator, auto-dismisses after 600ms.
 *   - `failed` — stage banner, hint, leftovers (expandable), correlationId,
 *      and a Force Delete CTA when `canForceCleanup === true`.
 *
 * `idle` renders nothing.
 */
export function ProjectDeletionPanel({ onForceDelete }: ProjectDeletionPanelProps) {
  const { t } = useTranslation('async');
  const session = useStore((s) => s.projectDeletionSession);
  const failedPhaseDuringCascade = useStore(selectProjectDeletionFailedPhase);
  const resetSession = useStore((s) => s.resetProjectDeletionSession);

  // Auto-dismiss the completed state so the modal vanishes without a click.
  useEffect(() => {
    if (session.kind !== 'completed') return;
    const id = window.setTimeout(() => resetSession(), 600);
    return () => window.clearTimeout(id);
  }, [session.kind, resetSession]);

  // 1s tick for the elapsed counter (only mounted while deleting).
  const elapsedSeconds = useElapsedSeconds(
    session.kind === 'deleting' ? session.startedAt : null,
  );

  const [leftoversOpen, setLeftoversOpen] = useState(false);

  if (session.kind === 'idle') return null;

  // failed → user-dismissible (button); deleting/completed → not dismissable.
  const isDismissable = session.kind === 'failed';

  const title =
    session.kind === 'failed'
      ? t('projectDeletion.failed.title')
      : session.kind === 'completed'
      ? t('projectDeletion.completed.title')
      : t('projectDeletion.title');

  return (
    <Modal
      isOpen
      onClose={() => {
        if (isDismissable) resetSession();
      }}
      title={title}
      size="md"
    >
      {session.kind === 'deleting' && (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('projectDeletion.body', { projectId: session.projectId })}
          </p>
          <ProjectDeletionStepRail
            currentPhase={session.phase}
            failedPhase={failedPhaseDuringCascade}
            elapsedSeconds={elapsedSeconds}
          />
        </div>
      )}

      {session.kind === 'completed' && (
        <div className="flex items-center gap-3 py-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white text-sm font-semibold">
            ✓
          </span>
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {t('projectDeletion.completed.body', { projectId: session.projectId })}
          </span>
        </div>
      )}

      {session.kind === 'failed' && (
        <FailedView
          session={session}
          onForceDelete={onForceDelete}
          onClose={resetSession}
          leftoversOpen={leftoversOpen}
          setLeftoversOpen={setLeftoversOpen}
        />
      )}
    </Modal>
  );
}

type FailedSession = Extract<ProjectDeletionSession, { kind: 'failed' }>;

function FailedView({
  session,
  onForceDelete,
  onClose,
  leftoversOpen,
  setLeftoversOpen,
}: {
  session: FailedSession;
  onForceDelete: () => void;
  onClose: () => void;
  leftoversOpen: boolean;
  setLeftoversOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation('async');
  const stageLabel = t(`projectDeletion.step.${session.stage}`);
  const stageNumber = useMemo(() => stageIndexOf(session.stage) + 1, [session.stage]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/30 p-3">
        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
          {t('projectDeletion.failed.stage', { current: stageNumber, total: 5, label: stageLabel })}
        </p>
        <p className="text-sm text-rose-600 dark:text-rose-400 mt-1 whitespace-pre-wrap break-words">
          {session.message}
        </p>
        {session.hint && (
          <p className="text-xs text-rose-600/80 dark:text-rose-400/80 mt-2">{session.hint}</p>
        )}
      </div>

      {session.leftovers && session.leftovers.length > 0 && (
        <details
          open={leftoversOpen}
          onToggle={(e) => setLeftoversOpen((e.target as HTMLDetailsElement).open)}
          className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2"
        >
          <summary className="cursor-pointer text-xs text-gray-600 dark:text-gray-400">
            {t('projectDeletion.failed.leftoversShow', { count: session.leftovers.length })}
          </summary>
          <ul className="mt-2 text-xs font-mono text-gray-700 dark:text-gray-300 space-y-1 max-h-40 overflow-auto">
            {session.leftovers.map((p) => (
              <li key={p} className="truncate">{p}</li>
            ))}
          </ul>
        </details>
      )}

      {session.correlationId && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
          {t('projectDeletion.failed.correlationId', { cid: session.correlationId })}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {t('projectDeletion.failed.dismiss')}
        </button>
        {session.canForceCleanup && (
          <button
            type="button"
            onClick={onForceDelete}
            className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors font-medium"
          >
            {t('projectDeletion.failed.forceDelete')}
          </button>
        )}
      </div>
    </div>
  );
}

const STAGE_ORDER = ['cancelJobs', 'ideCleanup', 'previewCleanup', 'redisCleanup', 'fsVerify'] as const;
function stageIndexOf(stage: string): number {
  const idx = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return idx >= 0 ? idx : 0;
}

function useElapsedSeconds(startedAt: number | null): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return undefined;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
