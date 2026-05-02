import { BaseTier } from './base';
import { fullBreadcrumb } from '../strategies/breadcrumb';
import { noopCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 0 — explain × oneshot (read-only Reflex). No side-effects, no compact.
 *
 * Uses {@link fullBreadcrumb} like every other tier (job-context-bridge T3).
 * FullBreadcrumb internally skips when `mode='explain'` so this tier
 * never produces a BC line in practice; unifying on a single strategy
 * keeps the tier facade flat and removes the historical Mini/Full/Noop
 * fork.
 */
export class Tier0Reflex extends BaseTier {
  readonly id = ExecutionTierId.Reflex;
  readonly label = 'Reflex' as const;

  static readonly instance: Tier0Reflex = new Tier0Reflex({
    breadcrumb: fullBreadcrumb,
    compact: noopCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
