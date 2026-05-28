/**
 * Detect Node Types — unified detect node.
 *
 * State chain: ResolvableState → TriageableState → DetectableState
 * detect node consumes DetectableState and populates resolvedAction (RAC).
 *
 * Pipeline:
 *   explicit (metadata.explicit=true) → resolveToRAC directly
 *   infer (job-blind) → inferRacWithTools → resolveToRAC
 *   infer (visual)    → strategy.run() → InferredAction → resolveToRAC
 *
 * DetectResult is the SSOT for progressibility (status / missingPrerequisites
 * / suggestedAlternatives / displayMessage / choiceOptions). It also carries
 * job-specific channels — `inferred` (visual asset strategy), `stateUpdates`
 * (augment hooks), `skipRACCreation` (design clarify / error exits) — that
 * are part of the active SSOT for those code paths, not legacy shims.
 */

import type { TriageableState } from '../triage/types.js';
import type { ChoiceOptions } from '../triage/types.js';
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

/**
 * Progressibility status — single SSOT for whether the pipeline can continue.
 *
 * - `'proceed'`            : RAC built, decompose can run.
 * - `'blocked'`            : required prerequisite missing, no viable alternative.
 * - `'redirect-suggested'` : prerequisite missing but matrix offers an
 *                            alternative intent the user can switch to.
 */
export type DetectStatus = 'proceed' | 'blocked' | 'redirect-suggested';

/**
 * Missing prerequisite summary surfaced to the user when status !== 'proceed'.
 * `required` blocks the pipeline; `recommended` is informational.
 */
export interface MissingPrerequisites {
  required: string[];
  recommended?: string[];
}

/**
 * Matrix-derived alternative intent — emitted alongside `redirect-suggested`
 * so the chat UI can render a choice card. `reason` is short, human-readable
 * (English / Korean depending on locale) and originates from `suggestAlternativeIntents`.
 */
export interface SuggestedAlternative {
  intentId: IntentId;
  reason: string;
}

export interface DetectResult<T extends DetectableState = DetectableState> {
  /** Progressibility verdict. Omitted when a visual-style strategy emits `inferred` directly. */
  status?: DetectStatus;
  /** RAC built for the proceed path. */
  resolvedAction?: ResolvedActionContext;
  /** Materialized artifacts loaded via `loadResolvedArtifacts`. */
  artifacts?: ResolvedArtifact[];
  /** Required + recommended prerequisite filenames (status !== 'proceed'). */
  missingPrerequisites?: MissingPrerequisites;
  /** Matrix-derived intent suggestions (status === 'redirect-suggested'). */
  suggestedAlternatives?: SuggestedAlternative[];
  /** Pre-formatted message for chat surfacing (status !== 'proceed'). */
  displayMessage?: string;
  /** Choice card payload (status === 'redirect-suggested'). */
  choiceOptions?: ChoiceOptions;

  /** Visual asset-classification strategy emits this in place of `resolvedAction`. */
  inferred?: InferredAction;
  /** Job-specific state updates merged into graph state by the detect factory. */
  stateUpdates?: Partial<T>;
  /** When true the factory returns `stateUpdates` as-is (design clarify / error exits). */
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
   * Job-specific state updates when explicit branch fires (LLM classify
   * skipped because `actionMetadata.intent` is set). Symmetric to `onResume` —
   * "LLM skipped, here's job-specific state derived from intent". Visual
   * strategy uses this to derive `assetType` / `jobMode` / `executionTier`
   * from the intent name.
   */
  onExplicit?(state: T, intentId: string): Partial<T>;

  /**
   * When true, the factory skips the resume fast path and calls run() instead.
   * Used by Design strategy to handle awaitingDetectClarify → resume must
   * go through strategy.run(), not the factory's resume path.
   */
  isAwaitingInput?(state: T): boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DetectAugment — Phase C job-specific post-processing hook
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Phase C augment hook signature — applied after `inferRacWithTools` so the
 * job-blind common detect can still let planner-plan decide `executionTier`,
 * design check Figma MCP reachability, etc. The hook returns a partial
 * DetectResult that the factory shallow-merges (later wins).
 *
 * Hooks must:
 *   - Only read from the `state` / `detectResult` they receive.
 *   - Touch `stateUpdates` for job-specific state writes.
 *   - Not re-classify intent (that is triage's SSOT) or re-load artifacts
 *     (that is `inferRacWithTools`'s SSOT).
 */
export type DetectAugment<T extends DetectableState = DetectableState> = (input: {
  intentId: IntentId;
  detectResult: DetectResult<T>;
  state: T;
}) => Promise<Partial<DetectResult<T>>>;

export type { InferredAction, ResolvedActionContext, ResolvedArtifact, IntentId };
