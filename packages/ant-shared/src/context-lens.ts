/**
 * Context Lens HTTP contracts (E2-4 — cross-job context visibility).
 *
 * BE routes: packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts
 * FE consumer: featureLog slice + Context panel / carry-over gauge.
 *
 * These describe the ASSEMBLED FeatureContext bands (post-checkpoint fold),
 * not raw feature.jsonl lines — see docs/internals/37-context-management.md.
 */

import type { TurnDigest, FeatureBreadcrumbLine } from './session-log';

/** GET /projects/:id/features/:feature/context/estimate */
export interface ContextCarryoverEstimate {
  /** Band-1 exchange count. */
  exchanges: number;
  /** Band-2 digest count. */
  digests: number;
  /** Standing Constraints — verbatim ledger entries. */
  ledger: string[];
  /** Band-3 rolling-summary checkpoint exists. */
  summaryPresent: boolean;
  /**
   * Carry-over reservoir tokens (estimateCarryoverTokens — all channels,
   * 2.8 chars/tok). May exceed `capTokens` between jobs.
   */
  estimatedTokens: number;
  /**
   * FEATURE_CONTEXT_THRESHOLD — the compaction trigger evaluated at the
   * next job's hydrate. A fold point, NOT a hard cap on the estimate.
   */
  capTokens: number;
}

/** One band-1 exchange body as served by GET context/lens. */
export interface ContextLensExchange {
  turnId: string;
  ts: string;
  jobType?: string;
  userText: string;
  assistantFinalText?: string;
  /** This turn's breadcrumb anchors. */
  anchors?: FeatureBreadcrumbLine['anchors'];
  /** ask/inline-ask — first to demote, never enters band 2. */
  ephemeral?: boolean;
}

/** One band-2 digest body as served by GET context/lens. */
export interface ContextLensDigest {
  turnId: string;
  ts: string;
  jobType?: string;
  digest: TurnDigest;
}

/** GET /projects/:id/features/:feature/context/lens */
export interface ContextLensResponse {
  exchanges: ContextLensExchange[];
  digests: ContextLensDigest[];
  ledger: string[];
  /** Band-3 rolling summary (folded older turns), null when no checkpoint. */
  summary: string | null;
}

