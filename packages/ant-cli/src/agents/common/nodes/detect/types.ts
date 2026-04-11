/**
 * Detect Node Types
 *
 * Common types for the unified detect node (replaces detectEnvironment/classify per job).
 *
 * State chain: ResolvableState → TriageableState → DetectableState
 * detect node consumes DetectableState and populates detectionReport + resolvedAction.
 */

import type { TriageableState } from '../triage/types.js';
import type {
  DetectionReport,
  ResolvedActionContext,
  IntentId,
  EnvironmentHints,
  CodebaseProfileLike,
} from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectableState — extends TriageableState with detect outputs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectableState extends TriageableState {
  detectionReport?: DetectionReport;
  resolvedAction?: ResolvedActionContext;
  // recursionCount/recursionLimit: inherited from ResolvableState
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectResult — strategy run() output
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectResult<T extends DetectableState = DetectableState> {
  /** LLM-produced detection report. Undefined signals early return (clarify/error). */
  detectionReport?: DetectionReport;
  /** Job-specific state updates (merged into graph state alongside common fields) */
  stateUpdates?: Partial<T>;
  /**
   * When true, the factory skips common RAC creation and returns stateUpdates as-is.
   * Use for: clarify pauses, error exits, any case where RAC shouldn't be built yet.
   */
  skipRACCreation?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectStrategy — job-specific strategy injected into createDetectNode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DetectStrategy<T extends DetectableState = DetectableState> {
  /** Job-specific LLM detection (prompt build → call → parse → DetectionReport) */
  run(state: T): Promise<DetectResult<T>>;

  /** Fallback intent synthesis when LLM intentId is invalid or missing */
  synthesizeFallback(report: DetectionReport, state: T): IntentId;

  /** Codebase profile for RAC tech context (code/design have it, plan/visual don't) */
  getCodebaseProfile?(state: T): CodebaseProfileLike | undefined;

  /** Environment hints for RAC creation fallback (e.g., designDocPath for code job) */
  getExplicitHints?(state: T): EnvironmentHints | undefined;

  /** Job-specific state updates when resuming with an existing detectionReport */
  onResume?(state: T): Partial<T>;

  /**
   * When true, the factory skips the resume fast path and calls run() instead.
   * Used by Design strategy to handle awaitingDetectClarify → resume must
   * go through strategy.run(), not the factory's Phase 2.
   */
  isAwaitingInput?(state: T): boolean;
}

export type { DetectionReport, ResolvedActionContext, IntentId };
