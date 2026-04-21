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
 * Phase code MUST NOT compare `mode` / `complexity` literals; routing is
 * encapsulated behind {@link selectExecutionTier} and the tier facades. The
 * Tier 3 constructor is the only place that branches on `mode` (D11
 * invariant).
 */

import type { Mode, Complexity } from '@ant/shared';
import type { ExecutionTier, ExecutionTierId } from './types';
import { selectExecutionTier } from './selectExecutionTier';
import { Tier0Reflex } from './tiers/Tier0Reflex';
import { Tier1OneShot } from './tiers/Tier1OneShot';
import { Tier2Exploratory } from './tiers/Tier2Exploratory';
import { Tier3Task } from './tiers/Tier3Task';
import { Tier4Plan } from './tiers/Tier4Plan';

export type { ExecutionTier, ExecutionTierId, ExecutionTierState } from './types';
export { selectExecutionTier } from './selectExecutionTier';

/**
 * Minimal state shape consumed by {@link getExecutionTier}. We accept a loose
 * projection so callers across different graph states (code / design /
 * planner) can invoke without importing this module's types.
 */
export interface GetExecutionTierInput {
  executionTier?: ExecutionTierId;
  complexity?: Complexity;
  resolvedAction?: { mode?: Mode };
}

export function getExecutionTier(state: GetExecutionTierInput): ExecutionTier {
  const executionTierId: ExecutionTierId =
    state.executionTier ??
    selectExecutionTier(state.resolvedAction?.mode, state.complexity);
  const mode = state.resolvedAction?.mode;
  switch (executionTierId) {
    case 0:
      return Tier0Reflex.instance;
    case 1:
      return Tier1OneShot.instance;
    case 2:
      return Tier2Exploratory.instance;
    case 3:
      return new Tier3Task(mode ?? 'generate');
    case 4:
    default:
      return Tier4Plan.instance;
  }
}
