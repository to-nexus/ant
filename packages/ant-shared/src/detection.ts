/**
 * Detection Types
 *
 * InferredAction — strategy.run() output (infer path only).
 * Contains intentId + file slots + domain. mode/intentGroup are NOT here —
 * they are derived from intentId via deriveFromIntent() in the unified funnel (resolveToRAC).
 *
 * Reasoning fields are transient: displayed in chat then discarded.
 * RAC is the immutable final output of detect.
 *
 * Removed types (RAC convergence):
 *   DetectionSummary, DetectionReport, ProjectProfile, JobEnvironment,
 *   JobMode, DesignWorkType, JobSource
 */

/** Universal mode — shared vocabulary across all jobs */
export type Mode = 'generate' | 'refactor' | 'explain';

/** Intent group — universal job identity enum */
export type IntentGroup =
  | 'plan'
  | 'design-system'
  | 'design-ui'
  | 'design-art'
  | 'design-spec'
  | 'code'
  | 'visual'
  | 'learn-codebase'
  | 'ask';

/**
 * Domain — top-level project domain classification.
 *
 * Used by all artifact-producing jobs (plan / design / code / spec) to gate
 * domain-specific basis injection. Phase 1 introduces game vs. service.
 * Phase 4+ may extend with `'3d'`, `'data-viz'`, `'interactive-art'` etc. —
 * adding a new domain is a single union edit + a row update in
 * `TIER_DOMAIN_MATRIX` ([packages/ant-shared/src/tier-matrix.ts]).
 */
export type Domain = 'game' | 'service';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// InferredAction — strategy.run() output type (infer path)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface InferredAction {
  /** Must be a valid IntentId. LLM must return this; invalid → retry with error feedback. */
  intentId: string;

  /** Target output file paths (e.g., ['fe-system-main.md'] for design-system) */
  target?: string[];
  /** Reference file paths identified by LLM */
  refs?: string[];
  /** Context file paths identified by LLM */
  context?: string[];

  /** Domain classification — universal across artifact-producing jobs (game | service). */
  domain?: Domain;

  /** Transient reasoning for chat display. Never persisted in RAC. */
  reasoning?: {
    intent?: string;
    domain?: string;
  };

  sourceJob: string;
}
