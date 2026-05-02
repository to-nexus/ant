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
 * Tier 4 — RefsGrounded. Task-scale work where refs (artifacts with
 * `role='ref'`) are present as grounding source.
 *
 * Strategy composition mirrors Tier 3 Task — the 5-tier enum is a
 * semantic label that says "this work had refs in play"; the actual
 * breadcrumb / compact logic is currently the same as the directive-only
 * task path.
 *
 * Auto boundary is gone (job-context-bridge T2). Hard Reset is recorded
 * outside this strategy chain.
 */
export class Tier4Plan extends BaseTier {
  readonly id = ExecutionTierId.RefsGrounded;
  readonly label = 'RefsGrounded' as const;

  constructor(mode: Mode) {
    const breadcrumb: BreadcrumbStrategy =
      mode === 'explain' ? noopBreadcrumb : fullBreadcrumb;
    super({
      breadcrumb,
      compact: thresholdLLMCompact,
    });
  }
}
