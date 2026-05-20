/**
 * Baseline-estimate types shared between the Phase-2 backend endpoint
 * (`GET /api/jobs/baseline-estimate`) and the Phase-3 frontend hook
 * (`useBaselineEstimate`). Defines the predicted next-call floor that the
 * chat-input gauge shows when no `live` LLM call has run.
 *
 * Phase 3 lands the type SSOT alongside the gauge's `mode: 'baseline'`
 * branch; the endpoint that actually computes a value is wired in Phase 2.
 */

import type { JobType } from './job';

/**
 * Identifier for the graph node predicted to dominate the next LLM call.
 * Free-form string because the `node` namespace differs per job (`detect`,
 * `decompose`, `plan`, `execute`, `docGen`, `agent`, `generate`, …).
 */
export type HeaviestNodeId = string;

/**
 * Why this node was selected as the heaviest:
 *   - `static-max` — its static prompt floor was the largest among the
 *     intent's reachable nodes (default case for code/design with decompose).
 *   - `no-decompose` — the intent has no decompose stage (ask / explain),
 *     so the only-stage's floor is reported.
 */
export type HeaviestNodeReason = 'static-max' | 'no-decompose';

/**
 * Predicted next-LLM-call floor. Phase-3 callers only need this shape on
 * hand to type a stub fetcher; the Phase-2 endpoint produces the actual
 * values via `PromptBuilder` dryrun + Anthropic `count_tokens`.
 */
export interface BaselineEstimate {
  heaviestNode: {
    job: JobType;
    node: HeaviestNodeId;
    reason: HeaviestNodeReason;
  };
  staticFloor: { tokens: number };
  dynamic: {
    /** Sum of RAC ref+context body tokens (0 in infer mode). */
    racBodyTokens: number;
    /** Char→token estimate of the user's draft input (0 when empty). */
    userMessageTokens: number;
  };
  /** `staticFloor.tokens + dynamic.racBodyTokens + dynamic.userMessageTokens`. */
  total: number;
  /** From `getModelContextWindow(modelId)`. The gauge's denominator. */
  contextWindow: number;
  /** Active model id at estimation time. */
  modelId: string;
  /**
   *   - `T0` — submission time. Explicit-mode RAC fully known; infer-mode
   *     reports floor only (`racBodyTokens=0`).
   *   - `T1-post-detect` — after detect completes; all RAC bodies resolved.
   */
  timing: 'T0' | 'T1-post-detect';
}
