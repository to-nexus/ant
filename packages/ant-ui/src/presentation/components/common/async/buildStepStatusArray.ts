import type { StepIndicatorStep, StepStatus } from './primitives/StepIndicator';

/**
 * Derive a `StepIndicator` step array from a phase order + current/failed phase.
 *
 * Two consumers — IDE startup (`IdeStepRail`) and project deletion
 * (`ProjectDeletionStepRail`) — share this logic so the rules for
 * pending/active/complete/failed cannot drift.
 *
 * Status rules:
 *   - `failedPhase === step` → `failed` (red)
 *   - step appears before `currentPhase` in the order → `complete`
 *   - step === `currentPhase` → `active` (or `failed` when also failed)
 *   - otherwise → `pending`
 *
 * `currentPhase === null` means "no step has started yet" — every step
 * renders as pending. This matches the IDE `starting` lifecycle phase before
 * any sub-phase has fired.
 */
export interface BuildStepStatusArrayArgs<TPhase extends string> {
  order: readonly TPhase[];
  currentPhase: TPhase | null;
  /** Phase that failed (mutually exclusive with success). `null` = no failure. */
  failedPhase?: TPhase | null;
  /** Override active step's status (e.g. IDE's "stuck" renders as `failed` visually). */
  forceActiveStatus?: StepStatus;
  /** i18n labels keyed by phase. */
  labels: Record<TPhase, string>;
  /** Optional trailing text per step (e.g. "2.3s elapsed" on the active step). */
  trailingFor?: (phase: TPhase, status: StepStatus) => string | undefined;
}

export function buildStepStatusArray<TPhase extends string>({
  order,
  currentPhase,
  failedPhase = null,
  forceActiveStatus,
  labels,
  trailingFor,
}: BuildStepStatusArrayArgs<TPhase>): StepIndicatorStep[] {
  const currentIdx = currentPhase ? order.indexOf(currentPhase) : -1;
  const failedIdx = failedPhase ? order.indexOf(failedPhase) : -1;

  return order.map((phase, i) => {
    let status: StepStatus;
    if (failedIdx >= 0 && i === failedIdx) {
      status = 'failed';
    } else if (failedIdx >= 0 && i < failedIdx) {
      status = 'complete';
    } else if (failedIdx >= 0) {
      status = 'pending';
    } else if (currentIdx < 0) {
      status = 'pending';
    } else if (i < currentIdx) {
      status = 'complete';
    } else if (i === currentIdx) {
      status = forceActiveStatus ?? 'active';
    } else {
      status = 'pending';
    }

    const trailing = trailingFor?.(phase, status);
    return {
      id: phase,
      label: labels[phase],
      status,
      ...(trailing !== undefined ? { trailing } : {}),
    };
  });
}
