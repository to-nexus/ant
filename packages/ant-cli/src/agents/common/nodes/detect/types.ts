/**
 * Detect Node Types
 *
 * Common types for the unified detect node.
 *
 * State chain: ResolvableState → TriageableState → DetectableState
 * detect node consumes DetectableState and populates resolvedAction (RAC).
 *
 * Pipeline:
 *   explicit (metadata.explicit=true) → resolveToRAC directly
 *   infer → strategy.run() → InferredAction → merge with metadata → resolveToRAC
 */

import type { TriageableState } from '../triage/types.js';
import type {
  InferredAction,
  ResolvedActionContext,
  ResolvedArtifact,
  IntentId,
} from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectableState — extends TriageableState with detect outputs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectableState extends TriageableState {
  resolvedAction?: ResolvedActionContext;
  resolvedArtifacts?: ResolvedArtifact[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectResult — strategy run() output (infer path only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectResult<T extends DetectableState = DetectableState> {
  /** LLM-produced inference. Undefined signals early return (clarify/error). */
  inferred?: InferredAction;
  /** Job-specific state updates (merged into graph state alongside common fields) */
  stateUpdates?: Partial<T>;
  /**
   * When true, the factory skips RAC creation and returns stateUpdates as-is.
   * Use for: clarify pauses, error exits, any case where RAC shouldn't be built yet.
   */
  skipRACCreation?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectStrategy — job-specific strategy injected into createDetectNode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectStrategy<T extends DetectableState = DetectableState> {
  /** Job-specific LLM detection → InferredAction with valid intentId */
  run(state: T): Promise<DetectResult<T>>;

  /** Job-specific state updates when resuming with an existing resolvedAction */
  onResume?(state: T): Partial<T>;

  /**
   * When true, the factory skips the resume fast path and calls run() instead.
   * Used by Design strategy to handle awaitingDetectClarify → resume must
   * go through strategy.run(), not the factory's resume path.
   */
  isAwaitingInput?(state: T): boolean;
}

export type { InferredAction, ResolvedActionContext, ResolvedArtifact, IntentId };
