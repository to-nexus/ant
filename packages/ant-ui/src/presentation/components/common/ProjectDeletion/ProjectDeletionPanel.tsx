import type { ProjectDeletionPhase } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectProjectDeletionFailedPhase } from '@/domain/store/slices/projectDeletionSlice';
import { PhasedOperationPanel } from '../async/PhasedOperationPanel';

/**
 * Project deletion progress + structured-error popup.
 *
 * Thin wrapper over the generic `<PhasedOperationPanel>` — the panel
 * itself owns the modal layout, step rail, completed/failed views, and
 * Force CTA. This wrapper plugs in:
 *   - the `projectDeletionSession` selector,
 *   - the i18n prefix (`projectDeletion`) under the `async` namespace,
 *   - the `projectId` body variable, and
 *   - the `onForceCleanup` callback (caller dispatches
 *     `deleteProject(projectId, { force: true })`).
 *
 * Feature deletion has its own wrapper (`FeatureDeletionPanel`) following
 * the same shape.
 */
export interface ProjectDeletionPanelProps {
  onForceDelete: () => void;
}

export const PROJECT_DELETION_STEP_ORDER: readonly ProjectDeletionPhase[] = [
  'cancelJobs',
  'ideCleanup',
  'previewCleanup',
  'redisCleanup',
  'fsVerify',
] as const;

export function ProjectDeletionPanel({ onForceDelete }: ProjectDeletionPanelProps) {
  const session = useStore((s) => s.projectDeletionSession);
  const failedPhaseDuringCascade = useStore(selectProjectDeletionFailedPhase);
  const resetSession = useStore((s) => s.resetProjectDeletionSession);

  const projectId = session.kind !== 'idle' ? session.projectId : '';

  return (
    <PhasedOperationPanel<ProjectDeletionPhase>
      session={session}
      phaseOrder={PROJECT_DELETION_STEP_ORDER}
      failedPhaseDuringCascade={failedPhaseDuringCascade}
      i18nNamespace="async"
      i18nPrefix="projectDeletion"
      bodyVars={{ projectId }}
      onForceCleanup={onForceDelete}
      onDismiss={resetSession}
    />
  );
}
