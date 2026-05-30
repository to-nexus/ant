import type { FeatureDeletionPhase } from '@ant/shared';
import { useStore } from '@/domain/store';
import { selectFeatureDeletionFailedPhase } from '@/domain/store/slices/featureDeletionSlice';
import { PhasedOperationPanel } from '../async/PhasedOperationPanel';

/**
 * Feature deletion progress + structured-error popup.
 *
 * Thin wrapper over `<PhasedOperationPanel>` — sibling of
 * `<ProjectDeletionPanel>` (same panel underneath, different i18n prefix +
 * session selector + identity fields).
 */
export interface FeatureDeletionPanelProps {
  /**
   * Called when the user clicks "Force Delete" on a failed cascade.
   * Caller dispatches `deleteFeature(projectId, featureName, { force: true })`.
   */
  onForceDelete: () => void;
}

export const FEATURE_DELETION_STEP_ORDER: readonly FeatureDeletionPhase[] = [
  'cancelJobs',
  'ideCleanup',
  'previewCleanup',
  'redisCleanup',
  'fsVerify',
] as const;

export function FeatureDeletionPanel({ onForceDelete }: FeatureDeletionPanelProps) {
  const session = useStore((s) => s.featureDeletionSession);
  const failedPhaseDuringCascade = useStore(selectFeatureDeletionFailedPhase);
  const resetSession = useStore((s) => s.resetFeatureDeletionSession);

  const projectId = session.kind !== 'idle' ? session.projectId : '';
  const featureName = session.kind !== 'idle' ? session.featureName : '';

  return (
    <PhasedOperationPanel<FeatureDeletionPhase>
      session={session}
      phaseOrder={FEATURE_DELETION_STEP_ORDER}
      failedPhaseDuringCascade={failedPhaseDuringCascade}
      i18nNamespace="async"
      i18nPrefix="featureDeletion"
      bodyVars={{ projectId, featureName }}
      onForceCleanup={onForceDelete}
      onDismiss={resetSession}
    />
  );
}
