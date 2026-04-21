import { BaseTier } from './base';
import { noopBreadcrumb } from '../strategies/breadcrumb';
import { noopBoundary } from '../strategies/boundary';
import { noopCollapse } from '../strategies/collapse';
import { noopCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/** Tier 0 — explain × oneshot (read-only Reflex). No side-effects, no compact. */
export class Tier0Reflex extends BaseTier {
  readonly id = ExecutionTierId.Reflex;
  readonly label = 'Reflex' as const;

  static readonly instance: Tier0Reflex = new Tier0Reflex({
    breadcrumb: noopBreadcrumb,
    boundary: noopBoundary,
    collapse: noopCollapse,
    compact: noopCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
