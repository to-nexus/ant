/**
 * core/executionTier — 5-Tier Execution Strategy facade.
 *
 * Usage in phase nodes:
 *
 *   import { getExecutionTier } from '../../../../../../core/executionTier';
 *   const executionTier = getExecutionTier(state);
 *   await executionTier.breadcrumb(state, touched);
 *   await executionTier.boundary(state);
 *
 * Phase code MUST NOT compare `mode` literals; routing is encapsulated
 * behind this facade. Mode branching lives ONLY inside the tier
 * constructors (Tier3Task, Tier4Plan) — D11 invariant.
 *
 * `state.executionTier` is authored by each job's Tier Entry Node LLM
 * (code/design: Decompose, plan/visual: Detect, learn/ask: fixed 0). If
 * the channel is missing when `getExecutionTier` is called (e.g. resolve
 * runs before Decompose, or the LLM failed to emit `<executionTier>`),
 * the facade returns Tier 0 Reflex — a read-only Noop tier that is safe
 * to execute under any circumstances. Callers that require a specific
 * tier MUST ensure the Tier Entry Node has run first.
 */

import type { Mode } from '@ant/shared';
import { ExecutionTierId } from './types';
import type { ExecutionTier } from './types';
import { Tier0Reflex } from './tiers/Tier0Reflex';
import { Tier1OneShot } from './tiers/Tier1OneShot';
import { Tier2Exploratory } from './tiers/Tier2Exploratory';
import { Tier3Task } from './tiers/Tier3Task';
import { Tier4Plan } from './tiers/Tier4Plan';

export type { ExecutionTier, ExecutionTierState } from './types';
export { ExecutionTierId } from './types';
export {
  tierToDirectMode,
  isDirectTier,
  isTaskTier,
} from './derive';
export {
  parseExecutionTierTag,
  coerceExecutionTier,
} from './parseExecutionTierTag';

/**
 * Minimal state shape consumed by {@link getExecutionTier}. Accepts a
 * loose projection so callers across different graph states (code /
 * design / planner / visual) can invoke without importing this module's
 * types.
 */
export interface GetExecutionTierInput {
  executionTier?: ExecutionTierId;
  resolvedAction?: { mode?: Mode };
}

export function getExecutionTier(state: GetExecutionTierInput): ExecutionTier {
  const executionTierId = state.executionTier ?? ExecutionTierId.Reflex;
  const mode = state.resolvedAction?.mode ?? 'generate';
  switch (executionTierId) {
    case ExecutionTierId.Reflex:
      return Tier0Reflex.instance;
    case ExecutionTierId.OneShot:
      return Tier1OneShot.instance;
    case ExecutionTierId.Exploratory:
      return Tier2Exploratory.instance;
    case ExecutionTierId.Task:
      return new Tier3Task(mode);
    case ExecutionTierId.RefsGrounded:
      return new Tier4Plan(mode);
    default:
      return Tier0Reflex.instance;
  }
}
