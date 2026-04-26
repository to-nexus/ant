/**
 * Prompt Policy Matrix
 *
 * Maps IntentId → prompt injection policies.
 * Record<IntentId, ...> guarantees compile-time completeness:
 * adding a new IntentId without a matrix entry causes a TS error.
 *
 * Tier I (Intent): `policies` — static policies applied unconditionally for an intent.
 * Tier N (Artifact): `conditionalPolicies` — applied only when the matching
 *   config-matrix slot has been materialized as an artifact.
 *
 * `refMediaHints` declares expected media types in ref artifacts,
 * enabling PromptBuilder to handle multimodal content (future).
 */

import type { IntentId } from './actions';

// ============================================
// PolicyKey — named injection policies
// ============================================

export type PolicyKey =
  | 'ui-design-policy'
  | 'visual-source-authority'
  | 'frontend-guide'
  | 'backend-guide'
  | 'api-contract-guide';

/**
 * Maps PolicyKey to the Handlebars injection template path
 * (relative to templates/ root, without .md extension).
 */
export const POLICY_TEMPLATE_MAP: Record<PolicyKey, string> = {
  'ui-design-policy': 'jobs/shared/injections/ui-design-policy',
  'visual-source-authority': 'jobs/shared/injections/visual-source-authority',
  'frontend-guide': 'jobs/design/base/injections/frontend-guide',
  'backend-guide': 'jobs/design/base/injections/backend-guide',
  'api-contract-guide': 'jobs/design/base/injections/api-contract-guide',
};

// ============================================
// IntentPromptPolicy
// ============================================

export interface IntentPromptPolicy {
  /** Static policies — always applied for this intent (Tier I). */
  policies: PolicyKey[];
  /** Artifact-conditional policies — applied when the slot's artifact is present (Tier N). */
  conditionalPolicies?: ConditionalPolicy[];
  /** Expected media types in ref artifacts (text, image). Informational for builder. */
  refMediaHints: ('text' | 'image')[];
}

export interface ConditionalPolicy {
  /** Must match a SlotDef.path from action-config-matrix. */
  slotPath: string;
  /** Applied when the slotPath's artifact is assembled. */
  policy: PolicyKey;
}

// ============================================
// Matrix Data
// ============================================

const PROMPT_POLICY_MATRIX: Record<IntentId, IntentPromptPolicy> = {
  // ── Plan ──────────────────────────────────
  'gen-plan': { policies: [], refMediaHints: ['text'] },
  'rev-plan': { policies: [], refMediaHints: ['text'] },
  'explain-plan': { policies: [], refMediaHints: ['text'] },

  // ── System Design: Gen ─────────────────────
  'gen-sys-fe': { policies: ['frontend-guide'], refMediaHints: ['text'] },
  'gen-sys-be': { policies: ['backend-guide'], refMediaHints: ['text'] },
  'gen-sys-full': {
    policies: ['frontend-guide', 'backend-guide', 'api-contract-guide'],
    refMediaHints: ['text'],
  },

  // ── System Design: Rev / Explain ───────────
  'rev-sys': { policies: [], refMediaHints: ['text'] },
  'explain-sys': { policies: [], refMediaHints: ['text'] },

  // ── UI Design ──────────────────────────────
  'gen-ui-figma': {
    policies: ['ui-design-policy'],
    refMediaHints: [],
  },
  'gen-ui-desc': {
    policies: ['ui-design-policy'],
    refMediaHints: ['text'],
  },
  'rev-ui': { policies: ['ui-design-policy'], refMediaHints: ['text'] },
  'explain-ui': { policies: [], refMediaHints: ['text'] },

  // ── Game Art Design (Phase 2 — D17) ────────
  // Phase 2 reuses `ui-design-policy` as the closest existing policy. The
  // dedicated game-art-design-policy partial set is a Phase 2 follow-up
  // (`p2-game-art-decompose-prompts`); for now this slot guarantees the
  // intents are matrix-recognised and routable.
  'gen-art-figma': { policies: ['ui-design-policy'], refMediaHints: [] },
  'gen-art-desc': { policies: ['ui-design-policy'], refMediaHints: ['text'] },
  'rev-art': { policies: ['ui-design-policy'], refMediaHints: ['text'] },
  'explain-art': { policies: [], refMediaHints: ['text'] },

  // ── Spec ───────────────────────────────────
  'gen-spec': { policies: [], refMediaHints: ['text'] },
  'rev-spec': { policies: [], refMediaHints: ['text'] },
  'explain-spec': { policies: [], refMediaHints: ['text'] },

  // ── Code ───────────────────────────────────
  'gen-code-sys': {
    policies: [],
    conditionalPolicies: [
      { slotPath: 'outputs/design/ui', policy: 'ui-design-policy' },
    ],
    refMediaHints: ['text'],
  },
  'gen-code-spec': {
    policies: [],
    conditionalPolicies: [
      { slotPath: 'outputs/design/ui', policy: 'ui-design-policy' },
    ],
    refMediaHints: ['text'],
  },
  'gen-code-directive': {
    policies: [],
    // UI source context is now selectable for directive-only code jobs too
    // (matches action-config-matrix's `uiSourceCtx()` slot). Keep the
    // conditional so the policy fires only when the user actually selects
    // a UiSource — directive-only jobs without UI input must not receive it.
    conditionalPolicies: [
      { slotPath: 'outputs/design/ui', policy: 'ui-design-policy' },
    ],
    refMediaHints: ['text'],
  },
  'rev-code': {
    policies: [],
    conditionalPolicies: [
      { slotPath: 'outputs/design/ui', policy: 'ui-design-policy' },
    ],
    refMediaHints: ['text'],
  },
  'explain-code': { policies: [], refMediaHints: ['text'] },

  // ── Visual ─────────────────────────────────
  'gen-visual-logo': { policies: [], refMediaHints: [] },
  'gen-visual-icon': { policies: [], refMediaHints: [] },
  'gen-visual-hero': { policies: [], refMediaHints: [] },
  'gen-visual-illustration': { policies: [], refMediaHints: [] },
  'explain-visual': { policies: [], refMediaHints: [] },

  // ── Learn ──────────────────────────────────
  'gen-learn': { policies: [], refMediaHints: [] },

  // ── Ask ────────────────────────────────────
  'ask-evaluate': { policies: [], refMediaHints: [] },
  'ask-ant': { policies: [], refMediaHints: [] },
  'ask-general': { policies: [], refMediaHints: [] },
};

// ============================================
// Public API
// ============================================

/**
 * Get prompt policies for a given intent.
 * Returns the IntentPromptPolicy from the matrix.
 */
export function getPromptPolicies(intent: IntentId): IntentPromptPolicy {
  return PROMPT_POLICY_MATRIX[intent];
}

/**
 * Get all PolicyKey values that apply for an intent (static only, no conditionals).
 */
export function getStaticPolicies(intent: IntentId): PolicyKey[] {
  return PROMPT_POLICY_MATRIX[intent].policies;
}
