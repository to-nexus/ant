import { BaseTier } from './base';
import { miniBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 2 Exploratory — single unit of work executed through the task
 * pipeline (n=1 task with `selfVerifyOnDone`). The sole task runs a
 * two-cycle lifecycle: apply phase (task-type plan/execute applies fixes)
 * → reverify phase (`tasks/_shared/verify/` runs install/typecheck/
 * build/test gates) → done. Phase mode dispatch is task-type-blind: any
 * task whose `requiresVerification(task)` predicate returns true (Tier
 * 3/4 verification task OR Tier 2 self-verify) shares the verify-mode
 * hook surface.
 *
 * Mini-breadcrumb fires when >= 3 files were touched; no boundary (the
 * user_turn stays in T2 so follow-up questions keep their context).
 */
export class Tier2Exploratory extends BaseTier {
  readonly id = ExecutionTierId.Exploratory;
  readonly label = 'Exploratory' as const;

  static readonly instance: Tier2Exploratory = new Tier2Exploratory({
    breadcrumb: miniBreadcrumb,
    boundary: noopBoundary,
    collapse: noopCollapse,
    compact: thresholdLLMCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
