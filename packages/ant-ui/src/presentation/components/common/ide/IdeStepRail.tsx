import { useTranslation } from 'react-i18next';
import type { IdePhase } from '@ant/shared';
import { StepIndicator } from '../async/primitives/StepIndicator';
import type { StepIndicatorStep, StepStatus } from '../async/primitives/StepIndicator';

/**
 * The 5 startup steps surfaced to the user. The first 4 are BE-emitted
 * `IdePhase` values; the 5th is FE-only (iframe onLoad).
 */
export type IdeStepId = IdePhase | 'frame-load';

const STEP_ORDER: readonly IdeStepId[] = [
  'pod-pending',
  'image-pulling',
  'container-ready',
  'http-ready',
  'frame-load',
] as const;

const STEP_LABEL_KEY: Record<IdeStepId, string> = {
  'pod-pending': 'ide.step.podPending',
  'image-pulling': 'ide.step.imagePulling',
  'container-ready': 'ide.step.containerReady',
  'http-ready': 'ide.step.httpReady',
  'frame-load': 'ide.step.frameLoad',
};

export interface IdeStepRailProps {
  /** Current step. `null` means we haven't entered any step yet (just `starting`). */
  currentStep: IdeStepId | null;
  /** Seconds elapsed in the current step. Rendered next to the active label. */
  elapsedSeconds?: number;
  /** Stuck signal — render the active step with the `failed` status to draw attention. */
  isStuck?: boolean;
  /** Mark the current step as failed (terminal error). */
  isFailed?: boolean;
}

function statusFor(stepIdx: number, currentIdx: number, isStuck: boolean, isFailed: boolean): StepStatus {
  if (stepIdx < currentIdx) return 'complete';
  if (stepIdx === currentIdx) {
    if (isFailed) return 'failed';
    if (isStuck) return 'failed'; // visually marks the step as needing attention
    return 'active';
  }
  return 'pending';
}

export function IdeStepRail({ currentStep, elapsedSeconds, isStuck = false, isFailed = false }: IdeStepRailProps) {
  const { t } = useTranslation('async');
  const currentIdx = currentStep === null ? 0 : STEP_ORDER.indexOf(currentStep);

  const steps: StepIndicatorStep[] = STEP_ORDER.map((id, idx) => {
    const status = statusFor(idx, currentIdx, isStuck, isFailed);
    const trailing =
      status === 'active' && elapsedSeconds !== undefined && elapsedSeconds > 0
        ? t('ide.elapsed', { seconds: elapsedSeconds })
        : undefined;
    return {
      id,
      label: t(STEP_LABEL_KEY[id]),
      status,
      trailing,
    };
  });

  return <StepIndicator steps={steps} orientation="vertical" />;
}
