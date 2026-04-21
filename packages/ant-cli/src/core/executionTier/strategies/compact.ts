/**
 * Compact operation strategies.
 *
 * {@link NoopCompact}        — Tier 0 Reflex (no LLM cost for read-only).
 * {@link ThresholdLLMCompact} — Tiers 1 / 2 / 3; runs `compactFeatureContext`
 *                               when the user_turn token budget exceeds
 *                               FEATURE_CONTEXT_THRESHOLD (§13).
 *
 * The {@link ThresholdLLMCompact} implementation is a thin adapter — the
 * actual compaction logic still lives in
 * `core/context/featureContextBuilder.ts::compactFeatureContext` so the
 * well-tested helper keeps its single owner.
 */

import {
  compactFeatureContext,
  type FeatureContext,
  type CompactFeatureContextDeps,
  type CompactFeatureContextOptions,
} from '../../context/featureContextBuilder';

export interface CompactStrategy {
  apply(
    ctx: FeatureContext,
    deps: CompactFeatureContextDeps,
    options?: CompactFeatureContextOptions,
  ): Promise<FeatureContext>;
}

export class NoopCompact implements CompactStrategy {
  async apply(ctx: FeatureContext): Promise<FeatureContext> {
    return ctx;
  }
}

export class ThresholdLLMCompact implements CompactStrategy {
  async apply(
    ctx: FeatureContext,
    deps: CompactFeatureContextDeps,
    options?: CompactFeatureContextOptions,
  ): Promise<FeatureContext> {
    return compactFeatureContext(ctx, deps, options);
  }
}

export const noopCompact = new NoopCompact();
export const thresholdLLMCompact = new ThresholdLLMCompact();
