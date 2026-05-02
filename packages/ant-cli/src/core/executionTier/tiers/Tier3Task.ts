import type { Mode } from '@ant/shared';
import { BaseTier } from './base';
import {
  fullBreadcrumb,
  noopBreadcrumb,
  type BreadcrumbStrategy,
} from '../strategies/breadcrumb';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 3 — any mode × complexity=task.
 *   - generate / refactor: Full breadcrumb (anchors + LLM summary)
 *   - explain:             Noop breadcrumb (read-only by definition)
 *
 * Auto boundary is gone (job-context-bridge T2). Hard Reset is recorded
 * directly by SessionPersistence — boundary / collapse slots are no
 * longer part of the tier facade.
 *
 * **D11 invariant**: the mode dispatch happens here, inside the constructor,
 * and NOWHERE else. Operation methods (breadcrumb / compact) on this class
 * do NOT inspect `mode`/`complexity` literals.
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
    const breadcrumb: BreadcrumbStrategy =
      mode === 'explain' ? noopBreadcrumb : fullBreadcrumb;
    super({
      breadcrumb,
      compact: thresholdLLMCompact,
    });
  }
}
