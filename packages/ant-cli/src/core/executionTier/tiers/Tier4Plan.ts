import { BaseTier } from './base';
import { noopBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { noopCompact } from '../strategies/compact';

/**
 * Tier 4 — `plan` / `design` job types. Mode × Complexity are not
 * applicable to planner/design graphs (see 18-session-redesign §2.1 D5)
 * so every operation strategy is Noop. The class exists to give those job
 * types a uniform {@link ExecutionTier} handle without forcing callers to
 * branch on jobType.
 */
export class Tier4Plan extends BaseTier {
  readonly id = 4 as const;
  readonly label = 'Plan' as const;

  static readonly instance: Tier4Plan = new Tier4Plan({
    breadcrumb: noopBreadcrumb,
    boundary: noopBoundary,
    collapse: noopCollapse,
    compact: noopCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
