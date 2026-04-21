/**
 * 5-Tier Execution Strategy — type SSOT
 *
 * The five tiers mirror the 18-session-redesign §2.1 matrix (Reflex /
 * OneShot / Exploratory / Task / RefsGrounded). Each tier is realized
 * as an {@link ExecutionTier} facade that composes four operation
 * strategies: `breadcrumb` / `boundary` / `compact` / `collapse`.
 *
 * Phase nodes MUST route through this interface; inspecting `mode`
 * literals inside phase code is explicitly forbidden (D11 invariant —
 * see 18-session-redesign §2.4 and NODE_GRAPH_LAYOUT R1). Mode dispatch
 * lives ONLY inside the tier constructors (Tier3Task, Tier4Plan).
 */

import { ExecutionTierId } from '@ant/shared';
import type { FeatureBoundaryLine } from '@ant/shared';
import type { SessionPort } from '../ports/session';
import type { FeatureContext, CompactFeatureContextDeps } from '../context/featureContextBuilder';
import type { TouchedFromTrace } from '../context/breadcrumb';

export { ExecutionTierId };

/**
 * Lightweight view of the graph state that tier strategies are allowed to
 * observe. We intentionally avoid importing `ArchitectGraphState` here so
 * the `core/executionTier/` module does not depend on any single agent's graph
 * (tiers are cross-agent). Consumers pass the subset they need.
 */
export interface ExecutionTierState {
  jobId?: string;
  turnId?: string;
  directive?: string;
  resolvedAction?: { mode?: 'explain' | 'generate' | 'refactor' | string };
  deps?: { session?: SessionPort };
}

export interface ExecutionTier {
  readonly id: ExecutionTierId;
  readonly label: 'Reflex' | 'OneShot' | 'Exploratory' | 'Task' | 'RefsGrounded';

  /**
   * Append a breadcrumb (§12 Breadcrumb). No-op when the tier does not
   * participate in breadcrumb recording.
   *
   * Side-effect only; caller's responsibility to log failures.
   */
  breadcrumb(state: ExecutionTierState, touched?: TouchedFromTrace): Promise<void>;

  /**
   * Append a boundary (§4.2 Boundary / primary Collapse trigger). Some
   * boundary variants also delegate to {@link ExecutionTier.collapse}
   * internally so the "boundary → collapse" chain stays atomic.
   */
  boundary(state: ExecutionTierState): Promise<void>;

  /**
   * Compact `FeatureContext` (§13 compaction_policy). Returns the input
   * unchanged when the tier does not compact (e.g. Reflex / Plan).
   */
  compact(ctx: FeatureContext, deps: CompactFeatureContextDeps): Promise<FeatureContext>;

  /**
   * Mark pre-boundary user_turn/user_turn_meta lines collapsed (§4.2).
   * Usually invoked transitively from a boundary strategy; exposed on the
   * facade so adapters / tests can call it directly if needed.
   */
  collapse(session: SessionPort, boundary: FeatureBoundaryLine): Promise<void>;
}
