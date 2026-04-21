import type { Mode } from '@ant/shared';
import { BaseTier } from './base';
import {
  fullBreadcrumb,
  noopBreadcrumb,
  type BreadcrumbStrategy,
} from '../strategies/breadcrumb';
import {
  AutoCompleteBoundary,
  ExplainOnlyBoundary,
  type BoundaryStrategy,
} from '../strategies/boundary';
import { atBoundaryCollapse } from '../strategies/collapse';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 4 — RefsGrounded. Task-scale work where refs (artifacts with
 * `role='ref'`) are present as grounding source (spec / PRD /
 * system-design / user references).
 *
 * Strategy composition mirrors Tier 3 Task — the 5-tier enum is a
 * semantic label that says "this work had refs in play"; the actual
 * breadcrumb / boundary / compact / collapse logic is currently the
 * same as the directive-only task path. Future divergence (e.g.
 * refs-aware anchor pinning in breadcrumb or reference preservation in
 * compact) is opt-in without signature changes.
 *
 * **D11 invariant**: mode dispatch happens here, inside the constructor,
 * and NOWHERE else. Operation methods on this class do NOT inspect
 * `mode` literals.
 *
 * Like Tier 3, this class is NOT a singleton — each invocation returns
 * a new instance so the mode-specific strategy composition is stable.
 */
export class Tier4Plan extends BaseTier {
  readonly id = ExecutionTierId.RefsGrounded;
  readonly label = 'RefsGrounded' as const;

  constructor(mode: Mode) {
    const collapse = atBoundaryCollapse;
    let breadcrumb: BreadcrumbStrategy;
    let boundary: BoundaryStrategy;
    if (mode === 'explain') {
      breadcrumb = noopBreadcrumb;
      boundary = new ExplainOnlyBoundary(collapse);
    } else {
      breadcrumb = fullBreadcrumb;
      boundary = new AutoCompleteBoundary(collapse);
    }
    super({
      breadcrumb,
      boundary,
      collapse,
      compact: thresholdLLMCompact,
    });
  }
}
