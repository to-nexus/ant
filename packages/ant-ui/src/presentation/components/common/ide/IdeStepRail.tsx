import { useTranslation } from 'react-i18next';
import type { IdePhase } from '@ant/shared';
import { StepIndicator } from '../async/primitives/StepIndicator';
import { buildStepStatusArray } from '../async/buildStepStatusArray';

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

export function IdeStepRail({ currentStep, elapsedSeconds, isStuck = false, isFailed = false }: IdeStepRailProps) {
  const { t } = useTranslation('async');

  const labels = STEP_ORDER.reduce(
    (acc, id) => ({ ...acc, [id]: t(STEP_LABEL_KEY[id]) }),
    {} as Record<IdeStepId, string>,
  );

  // IDE's "stuck" + "failed" both surface visually as a failed-styled active
  // step; in either case the user needs the attention hint. We model this as
  // `forceActiveStatus: 'failed'` rather than passing `failedPhase` so subsequent
  // steps still appear pending (legacy IDE rail behavior).
  const forceActiveStatus = isFailed || isStuck ? 'failed' : undefined;

  const steps = buildStepStatusArray<IdeStepId>({
    order: STEP_ORDER,
    currentPhase: currentStep,
    forceActiveStatus,
    labels,
    trailingFor: (_phase, status) =>
      status === 'active' && elapsedSeconds !== undefined && elapsedSeconds > 0
        ? t('ide.elapsed', { seconds: elapsedSeconds })
        : undefined,
  });

  return <StepIndicator steps={steps} orientation="vertical" />;
}
