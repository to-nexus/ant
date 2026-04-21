import { BaseTier } from './base';
import { noopBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { thresholdLLMCompact } from '../strategies/compact';

/**
 * Tier 1 — any × oneshot (One-shot). Direct ReAct with 1–2 steps.
 * Compact runs (T2 may accumulate across sessions); breadcrumb / boundary
 * are off because the directive's scope is narrow.
 */
export class Tier1OneShot extends BaseTier {
  readonly id = 1 as const;
  readonly label = 'OneShot' as const;

  static readonly instance: Tier1OneShot = new Tier1OneShot({
    breadcrumb: noopBreadcrumb,
    boundary: noopBoundary,
    collapse: noopCollapse,
    compact: thresholdLLMCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
