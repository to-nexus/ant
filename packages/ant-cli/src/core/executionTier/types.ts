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
import type { SessionPort } from '../ports/session';
import type { LLMClient } from '../ports/llm';
import type { PromptPort } from '../ports/prompt';
import type { FeatureContext, CompactFeatureContextDeps } from '../context/featureContextBuilder';
import type { TouchedFromChatLog } from '../context/breadcrumb';
import type { BreadcrumbEmitOptions } from './strategies/breadcrumb';

export { ExecutionTierId };

/**
 * Lightweight view of the graph state that tier strategies are allowed to
 * observe. We intentionally avoid importing `ArchitectGraphState` here so
 * the `core/executionTier/` module does not depend on any single agent's graph
 * (tiers are cross-agent). Consumers pass the subset they need.
 *
 * `deps.llm` and `deps.promptBuilder` are optional — when present, the
 * BC emit path uses them to produce an LLM-generated summary; when absent
 * (test harness, ask flow), the fallback paraphrase is used. Either way
 * the BC line is still written.
 */
export interface ExecutionTierState {
  jobId?: string;
  turnId?: string;
  directive?: string;
  resolvedAction?: { mode?: 'explain' | 'generate' | 'refactor' | string };
  deps?: {
    session?: SessionPort;
    llm?: LLMClient;
    promptBuilder?: PromptPort;
  };
}

export interface ExecutionTier {
  readonly id: ExecutionTierId;
  readonly label: 'Reflex' | 'OneShot' | 'Exploratory' | 'Task' | 'RefsGrounded';

  /**
   * Append a breadcrumb (§12 Breadcrumb). Skip semantics live in
   * `writeBreadcrumb` (mode='explain' / touched=0). Callers can pass
   * {@link BreadcrumbEmitOptions.forceEmit} to record failure breadcrumbs
   * even when those default gates would skip.
   *
   * Side-effect only; caller's responsibility to log failures.
   */
  breadcrumb(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
    options?: BreadcrumbEmitOptions,
  ): Promise<void>;

  /**
   * Compact `FeatureContext` (§13 compaction_policy). Returns the input
   * unchanged when the tier does not compact (e.g. Tier 0 Reflex —
   * read-only path skips the LLM safety net).
   */
  compact(ctx: FeatureContext, deps: CompactFeatureContextDeps): Promise<FeatureContext>;
}
