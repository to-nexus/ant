import { useTranslation } from 'react-i18next';
import type { ProjectDeletionPhase } from '@ant/shared';
import { StepIndicator } from '../async/primitives/StepIndicator';
import { buildStepStatusArray } from '../async/buildStepStatusArray';

/**
 * The 5 BE-emitted deletion phases — order matches the cascade order
 * (`stopProjectRuntime` 4 + final `fsVerify`) so users see steps fill
 * in left-to-right.
 */
export const PROJECT_DELETION_STEP_ORDER: readonly ProjectDeletionPhase[] = [
  'cancelJobs',
  'ideCleanup',
  'previewCleanup',
  'redisCleanup',
  'fsVerify',
] as const;

const STEP_LABEL_KEY: Record<ProjectDeletionPhase, string> = {
  cancelJobs: 'projectDeletion.step.cancelJobs',
  ideCleanup: 'projectDeletion.step.ideCleanup',
  previewCleanup: 'projectDeletion.step.previewCleanup',
  redisCleanup: 'projectDeletion.step.redisCleanup',
  fsVerify: 'projectDeletion.step.fsVerify',
};

export interface ProjectDeletionStepRailProps {
  /** Current phase. `null` means cascade hasn't entered any step yet. */
  currentPhase: ProjectDeletionPhase | null;
  /** Phase that failed (if any). Renders the corresponding step as red. */
  failedPhase: ProjectDeletionPhase | null;
  /** Seconds elapsed since the cascade started. Shown next to the active step. */
  elapsedSeconds?: number;
}

export function ProjectDeletionStepRail({
  currentPhase,
  failedPhase,
  elapsedSeconds,
}: ProjectDeletionStepRailProps) {
  const { t } = useTranslation('async');

  const labels = PROJECT_DELETION_STEP_ORDER.reduce(
    (acc, id) => ({ ...acc, [id]: t(STEP_LABEL_KEY[id]) }),
    {} as Record<ProjectDeletionPhase, string>,
  );

  const steps = buildStepStatusArray<ProjectDeletionPhase>({
    order: PROJECT_DELETION_STEP_ORDER,
    currentPhase,
    failedPhase,
    labels,
    trailingFor: (_phase, status) =>
      status === 'active' && elapsedSeconds !== undefined && elapsedSeconds > 0
        ? t('ide.elapsed', { seconds: elapsedSeconds })
        : undefined,
  });

  return <StepIndicator steps={steps} orientation="vertical" />;
}
