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
 * Tier 3 — any mode × complexity=task. Full pipeline:
 *   - generate / refactor: Full breadcrumb + AutoComplete boundary
 *   - explain:             Noop breadcrumb + ExplainOnly boundary
 *
 * **D11 invariant**: the mode dispatch happens here, inside the constructor,
 * and NOWHERE else. Operation methods (breadcrumb / boundary / compact /
 * collapse) on this class do NOT inspect `mode`/`complexity` literals.
 * Enforcement: `rg "mode === '(explain|generate|refactor)'"
 *   packages/ant-cli/src/core/executionTier/tiers/ --glob '!Tier3Task.ts'` → 0 matches.
 *
 * Unlike Tier 0-2-4, Tier3 is NOT a singleton — each invocation returns a
 * new instance so the mode-specific strategy composition is stable for the
 * lifetime of that tier reference (avoids a stale singleton if the same
 * process handles back-to-back jobs with different modes).
 */
export class Tier3Task extends BaseTier {
  readonly id = ExecutionTierId.Task;
  readonly label = 'Task' as const;

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
