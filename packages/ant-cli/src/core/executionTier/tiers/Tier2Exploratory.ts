import { BaseTier } from './base';
import { miniBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 2 — any × exploratory. ReAct up to ANT_DIRECT_MAX_STEPS.
 * Mini-breadcrumb fires when ≥ 3 files were touched; no boundary (the
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
