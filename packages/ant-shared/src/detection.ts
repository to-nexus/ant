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
  | 'design-spec'
  | 'code'
  | 'visual'
  | 'learn-codebase'
  | 'ask';

/** Domain (System Design only) */
export type DesignDomain = 'game' | 'service';

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

  /** Domain classification — design-system only (game | service) */
  domain?: DesignDomain;

  /** Transient reasoning for chat display. Never persisted in RAC. */
  reasoning?: {
    intent?: string;
    domain?: string;
  };

  sourceJob: string;
}
