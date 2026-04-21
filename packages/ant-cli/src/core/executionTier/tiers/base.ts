/**
 * Shared tier implementation skeleton.
 *
 * Every tier composes a `{breadcrumb, boundary, collapse, compact}` quad
 * in its constructor. The operation methods are uniform across tiers —
 * they simply delegate. The constructor is the ONE and ONLY site where
 * tier-specific behaviour is wired; neither the base class nor the
 * operation methods may inspect `mode` / `complexity` literals (D11
 * invariant, see 18-session-redesign §2.4).
 */

import type { FeatureBoundaryLine } from '@ant/shared';
import type { SessionPort } from '../../ports/session';
import type { FeatureContext, CompactFeatureContextDeps } from '../../context/featureContextBuilder';
import type { TouchedFromTrace } from '../../context/breadcrumb';
import type { ExecutionTier, ExecutionTierState, ExecutionTierId } from '../types';
import type { BreadcrumbStrategy } from '../strategies/breadcrumb';
import type { BoundaryStrategy } from '../strategies/boundary';
import type { CollapseStrategy } from '../strategies/collapse';
import type { CompactStrategy } from '../strategies/compact';

export interface TierComposition {
  breadcrumb: BreadcrumbStrategy;
  boundary: BoundaryStrategy;
  collapse: CollapseStrategy;
  compact: CompactStrategy;
}

export abstract class BaseTier implements ExecutionTier {
  abstract readonly id: ExecutionTierId;
  abstract readonly label: ExecutionTier['label'];

  constructor(protected readonly strategies: TierComposition) {}

  breadcrumb(state: ExecutionTierState, touched?: TouchedFromTrace): Promise<void> {
    return this.strategies.breadcrumb.apply(state, touched);
  }

  boundary(state: ExecutionTierState): Promise<void> {
    return this.strategies.boundary.apply(state);
  }

  compact(ctx: FeatureContext, deps: CompactFeatureContextDeps): Promise<FeatureContext> {
    return this.strategies.compact.apply(ctx, deps);
  }

  collapse(session: SessionPort, boundary: FeatureBoundaryLine): Promise<void> {
    return this.strategies.collapse.apply(session, boundary);
  }
}
