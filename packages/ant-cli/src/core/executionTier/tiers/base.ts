/**
 * Shared tier implementation skeleton.
 *
 * job-context-bridge T8: boundary / collapse strategy slots removed
 * from the tier facade. Auto boundary is gone (T2) and the only
 * remaining boundary is `reason: 'user_reset'`, recorded directly by
 * SessionPersistence — the tier chain has nothing to do with boundary
 * any more. The remaining slots are:
 *   - breadcrumb: { FullBreadcrumb } single dispatch (mode/touched
 *                 gating happens inside writeBreadcrumb)
 *   - compact:    { ThresholdLLMCompact, NoopCompact (Tier 0 only) }
 *
 * Mode dispatch still lives ONLY inside the tier constructors
 * (Tier3Task, Tier4Plan) — D11 invariant.
 */

import type { FeatureContext, CompactFeatureContextDeps } from '../../context/featureContextBuilder';
import type { TouchedFromChatLog } from '../../context/breadcrumb';
import type { ExecutionTier, ExecutionTierState, ExecutionTierId } from '../types';
import type { BreadcrumbEmitOptions, BreadcrumbStrategy } from '../strategies/breadcrumb';
import type { CompactStrategy } from '../strategies/compact';

export interface TierComposition {
  breadcrumb: BreadcrumbStrategy;
  compact: CompactStrategy;
}

export abstract class BaseTier implements ExecutionTier {
  abstract readonly id: ExecutionTierId;
  abstract readonly label: ExecutionTier['label'];

  constructor(protected readonly strategies: TierComposition) {}

  breadcrumb(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
    options?: BreadcrumbEmitOptions,
  ): Promise<void> {
    return this.strategies.breadcrumb.apply(state, touched, options);
  }

  compact(ctx: FeatureContext, deps: CompactFeatureContextDeps): Promise<FeatureContext> {
    return this.strategies.compact.apply(ctx, deps);
  }
}
