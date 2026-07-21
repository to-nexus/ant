/**
 * Context Lens adaptive profiles (P2 — e2-humming-spindle II-3).
 *
 * SSOT for how much cross-job context each consumer node renders, keyed by
 * (node × execution tier). Lives inside `core/executionTier/` per the D11
 * invariant — phase nodes call `contextProfileFor(...)` instead of comparing
 * tier literals themselves.
 *
 * Cost model behind the caps: triage/detect run on every turn and carry the
 * strongest context-rot sensitivity (the last intent is the signal) → lean.
 * plan runs per task per round inside Tier 2-4 jobs (multiplier ~22 on Tier
 * 3) → standard, and lean on Tier 4 where refs are the ground truth. direct
 * is the conversational rim (1-3 calls) → rich. decompose runs once per job
 * → standard.
 */

import type { ExecutionTierId } from '@ant/shared';

export type ContextProfileName = 'rich' | 'standard' | 'lean';

export interface ContextProfile {
  name: ContextProfileName;
  /** Band 1 — number of trailing verbatim exchanges. */
  band1K: number;
  /**
   * Band 1 — per-exchange assistant prose cap in chars (~2.8 chars/token).
   * 0 = do not render assistant prose at all (lean keeps user turns only).
   */
  band1AssistantCharCap: number;
  /** Band 2 — max digests rendered. */
  band2MaxDigests: number;
}

export const CONTEXT_PROFILES: Record<ContextProfileName, ContextProfile> = {
  rich: { name: 'rich', band1K: 6, band1AssistantCharCap: 1680, band2MaxDigests: 12 },
  standard: { name: 'standard', band1K: 3, band1AssistantCharCap: 840, band2MaxDigests: 8 },
  lean: { name: 'lean', band1K: 6, band1AssistantCharCap: 0, band2MaxDigests: 1 },
};

export type LensConsumerNode = 'triage' | 'detect' | 'decompose' | 'plan' | 'direct';

/**
 * II-3 matrix. `tierId` is only consulted where the row actually varies
 * (plan); triage/detect are lean and direct is rich for every job shape.
 * decompose renders standard unconditionally — it decides the tier itself,
 * so it cannot condition on it.
 */
export function contextProfileFor(
  node: LensConsumerNode,
  tierId?: ExecutionTierId,
): ContextProfile {
  switch (node) {
    case 'triage':
    case 'detect':
      return CONTEXT_PROFILES.lean;
    case 'decompose':
      return CONTEXT_PROFILES.standard;
    case 'direct':
      return CONTEXT_PROFILES.rich;
    case 'plan':
      // Tier 4 RefsGrounded: refs are the ground truth — keep the lens lean.
      return (tierId ?? 0) >= 4 ? CONTEXT_PROFILES.lean : CONTEXT_PROFILES.standard;
  }
}
