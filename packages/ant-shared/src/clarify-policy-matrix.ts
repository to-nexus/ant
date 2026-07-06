/**
 * Clarify Policy Matrix
 *
 * Maps IntentId → clarify (ask-the-user-at-a-commitment-boundary) policy.
 * Sibling SSOT to prompt-policy-matrix.ts — NOT merged into
 * action-config-matrix.ts, whose identity is file-slot resolution consumed by
 * FE ActionConfigView + BE resolve. Clarify policy is a runtime-behavior
 * concern consumed by graph nodes + routing, a different axis.
 *
 * `Record<IntentId, ClarifyPolicy>` guarantees compile-time completeness:
 * adding a new IntentId without a policy entry causes a TS error.
 *
 * Clarify is a control-axis primitive (alongside <done>), orthogonal to
 * JobType / Intent / ExecutionTier. The one mechanism is turn-terminating:
 * the node emits <clarify>, the turn ends, a marker persists, and the user's
 * answer enqueues a continuation job that re-enters the emitting node. This
 * matrix is the only place that decides per-intent WHEN it is allowed, the
 * round budget, and what happens WHEN it fires.
 */

import type { IntentId } from './actions';
import { ExecutionTierId } from './session-log';

/**
 * The single-threaded, pre-fan-out node where a clarify gate may fire.
 * No post-fan-out (worker) phase is ever listed — workers must not clarify;
 * a worker that needs an answer fails its task and escalates to decompose.
 */
export type ClarifyPhase = 'detect' | 'decompose' | 'generate' | 'docgen' | 'direct';

export type ClarifyBlockingMode = 'user-choice-required' | 'proceed-if-sufficient';

export interface ClarifyPolicy {
  /** Master gate — false means the intent never surfaces clarify guidance. */
  clarifyEnabled: boolean;
  /** Phases at which clarify is allowed for this intent. */
  clarifyPhases: ClarifyPhase[];
  /** Max clarify ROUNDS across the whole job (0 = disabled). */
  clarifyBudget: number;
  /**
   * What happens WHEN clarify fires — NOT whether the model is forced to ask.
   * The model asks only when it genuinely cannot proceed with available info.
   * - proceed-if-sufficient: on budget exhaustion, inject a "proceed with the
   *   most reasonable default" note and continue (no dead-end).
   * - user-choice-required: the deliverable IS a user selection among options
   *   (e.g. visual sketch pick); the turn ends and the job waits for the pick.
   */
  blockingMode: ClarifyBlockingMode;
  /** Suppress clarify below this tier. Default 2 (Exploratory). */
  minTier?: ExecutionTierId;
}

/** Shared shape for intents where clarify is off. */
const DISABLED: ClarifyPolicy = {
  clarifyEnabled: false,
  clarifyPhases: [],
  clarifyBudget: 0,
  blockingMode: 'proceed-if-sufficient',
};

const CLARIFY_POLICY_MATRIX: Record<IntentId, ClarifyPolicy> = {
  // ── Plan (no tiers — minTier omitted) ──────
  'gen-plan': {
    clarifyEnabled: true,
    clarifyPhases: ['generate'],
    clarifyBudget: 2,
    blockingMode: 'proceed-if-sufficient',
  },
  'rev-plan': DISABLED,
  'explain-plan': DISABLED,

  // ── System Design ──────────────────────────
  // System-design gen routes through the design `decompose` node, which is
  // the single-threaded pre-fan-out seam (system design fans out to multiple
  // parallel doc-writing tasks in execute, so clarify MUST fire at decompose
  // — post-fan-out workers must never clarify). The `detect` phase gate is
  // still deferred. UI / game-art decompose gates are a future one-line
  // matrix change + handler wiring (same mechanism). `rev-sys` / `explain-sys`
  // stay off (explain is read-only; review has no ambiguity boundary).
  'gen-sys-fe': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 2,
    blockingMode: 'proceed-if-sufficient',
  },
  'gen-sys-be': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 2,
    blockingMode: 'proceed-if-sufficient',
  },
  'gen-sys-full': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 2,
    blockingMode: 'proceed-if-sufficient',
  },
  'rev-sys': DISABLED,
  'explain-sys': DISABLED,

  // ── UI Design (figma is source-grounded → off) ──
  'gen-ui-figma': DISABLED,
  'gen-ui-desc': DISABLED,
  'rev-ui': DISABLED,
  'explain-ui': DISABLED,

  // ── Game Art Design (figma → off) ──────────
  'gen-game-art-figma': DISABLED,
  'gen-game-art-desc': DISABLED,
  'rev-game-art': DISABLED,
  'explain-game-art': DISABLED,

  // ── Spec (docGen single-node; no tier gate) ─
  'gen-spec': {
    clarifyEnabled: true,
    clarifyPhases: ['docgen'],
    clarifyBudget: 3,
    blockingMode: 'proceed-if-sufficient',
  },
  'rev-spec': DISABLED,
  'explain-spec': DISABLED,

  // ── Code ───────────────────────────────────
  'gen-code-sys': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 1,
    blockingMode: 'proceed-if-sufficient',
    minTier: ExecutionTierId.Task,
  },
  'gen-code-spec': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 1,
    blockingMode: 'proceed-if-sufficient',
    minTier: ExecutionTierId.Task,
  },
  'gen-code-directive': {
    clarifyEnabled: true,
    // `detect` phase gate is deferred (shared pre-RAC factory) — only the
    // pre-fan-out `decompose` gate is wired today.
    clarifyPhases: ['decompose'],
    clarifyBudget: 2,
    blockingMode: 'proceed-if-sufficient',
    minTier: ExecutionTierId.Exploratory,
  },
  'rev-code': {
    clarifyEnabled: true,
    clarifyPhases: ['decompose'],
    clarifyBudget: 1,
    blockingMode: 'proceed-if-sufficient',
    minTier: ExecutionTierId.Exploratory,
  },
  'explain-code': DISABLED,

  // ── Visual ─────────────────────────────────
  // Visual `direct` is a JSON-route state machine (sketch/render/clarify/
  // deliver) with its own `clarifyCount`/MAX_CLARIFY, NOT a `<clarify>`-tag
  // surface. Converting it to the shared tag gate needs a prompt + route-model
  // rewrite; deferred. Declared DISABLED so the SSOT matches what's wired —
  // visual keeps its own working clarify (no regression). Intended:
  // blockingMode 'user-choice-required', phase 'direct', budget 5.
  'gen-visual-logo': DISABLED,
  'gen-visual-icon': DISABLED,
  'gen-visual-hero': DISABLED,
  'gen-visual-illustration': DISABLED,
  'explain-visual': DISABLED,

  // ── Learn / Ask ────────────────────────────
  'gen-learn': DISABLED,
  'ask-evaluate': DISABLED,
  'ask-ant': DISABLED,
  'ask-general': DISABLED,
};

/** Default tier floor — Tier 0/1 are unambiguous-enough-to-one-shot. */
const DEFAULT_MIN_TIER = ExecutionTierId.Exploratory;

export function getClarifyPolicy(intent: IntentId): ClarifyPolicy {
  return CLARIFY_POLICY_MATRIX[intent];
}

/**
 * The single predicate every clarify site calls. Composes the master gate,
 * the phase list, the round budget, and the tier floor. `tier` is optional
 * because plan/visual jobs have no execution tier — when omitted the tier
 * check passes (only enabled/phase/budget gate).
 */
export function isClarifyActive(
  intent: IntentId,
  phase: ClarifyPhase,
  tier?: ExecutionTierId,
): boolean {
  const policy = CLARIFY_POLICY_MATRIX[intent];
  if (!policy.clarifyEnabled) return false;
  if (!policy.clarifyPhases.includes(phase)) return false;
  if (policy.clarifyBudget <= 0) return false;
  if (tier !== undefined) {
    const floor = policy.minTier ?? DEFAULT_MIN_TIER;
    if (tier < floor) return false;
  }
  return true;
}
