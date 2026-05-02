import { BaseTier } from './base';
import { fullBreadcrumb } from '../strategies/breadcrumb';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 2 Exploratory — single unit of work executed through the task
 * pipeline (n=1 task with `selfVerifyOnDone`). The sole task runs a
 * two-cycle lifecycle: apply phase (task-type plan/execute applies fixes)
 * → reverify phase (`tasks/_shared/verify/` runs install/typecheck/
 * build/test gates) → done.
 *
 * BC emit on every code change (job-context-bridge T3 — replaces the
 * legacy `MINI_BREADCRUMB_TOUCHED_THRESHOLD = 3` gate). Small touches
 * still carry useful pointer info for the next turn; the only no-info
 * case (touched=0) is filtered inside `fullBreadcrumb`.
 */
export class Tier2Exploratory extends BaseTier {
  readonly id = ExecutionTierId.Exploratory;
  readonly label = 'Exploratory' as const;

  static readonly instance: Tier2Exploratory = new Tier2Exploratory({
    breadcrumb: fullBreadcrumb,
    compact: thresholdLLMCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
