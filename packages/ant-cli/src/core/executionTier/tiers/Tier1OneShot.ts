import { BaseTier } from './base';
import { fullBreadcrumb } from '../strategies/breadcrumb';
import { thresholdLLMCompact } from '../strategies/compact';
import { ExecutionTierId } from '../types';

/**
 * Tier 1 — any × oneshot (One-shot). Direct ReAct with 1–2 steps.
 *
 * BC emit on every code change (job-context-bridge T3): even a 1–2 step
 * write turn produces anchor information the next job needs. The previous
 * `noopBreadcrumb` choice was the strongest contributor to "next turn
 * sees nothing" symptoms because most narrow directives route here.
 * `fullBreadcrumb` self-skips for explain mode and touched=0.
 */
export class Tier1OneShot extends BaseTier {
  readonly id = ExecutionTierId.OneShot;
  readonly label = 'OneShot' as const;

  static readonly instance: Tier1OneShot = new Tier1OneShot({
    breadcrumb: fullBreadcrumb,
    compact: thresholdLLMCompact,
  });

  private constructor(strategies: ConstructorParameters<typeof BaseTier>[0]) {
    super(strategies);
  }
}
