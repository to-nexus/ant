/**
 * Triage derive helpers — deterministic, matrix-only.
 *
 * Phase B v2: Triage LLM emits only `<intentId>X</intentId>`. Everything else
 * (group / mode / domain) is computed from the matrix
 * (INTENT_DEFINITIONS) + workspaceState + actionMetadata. Pure functions, no
 * I/O, no LLM, no prereq judgement.
 */

import {
  deriveFromIntent,
  isValidIntentId,
  INTENT_DEFINITIONS,
  type IntentId,
  type Mode,
  type Domain,
  type ActionMetadata,
} from '@ant/shared';
import type { WorkspaceState } from './types.js';

/** `'work'` vs `'ask'` — derived purely from the intent's group. */
export function deriveTriageGroup(intentId: IntentId): 'ask' | 'work' {
  const def = INTENT_DEFINITIONS.find((d) => d.id === intentId);
  if (!def) return 'work';
  return def.intentGroup === 'ask' ? 'ask' : 'work';
}

/** Intent → universal Mode (generate / refactor / explain). */
export function deriveTriageMode(intentId: IntentId): Mode {
  return deriveFromIntent(intentId).mode;
}

/**
 * Domain derivation: actionMetadata.domain wins, else workspaceState hint,
 * else default `'service'`. (Plan v2 §B — workspaceState.monorepo /
 * canonical files do NOT determine domain; only explicit metadata or
 * inferred project shape does. Phase B SSOT keeps it simple.)
 */
export function deriveTriageDomain(
  _intentId: IntentId,
  _workspaceState: WorkspaceState | undefined,
  actionMetadata: ActionMetadata | undefined,
): Domain {
  if (actionMetadata?.domain === 'game' || actionMetadata?.domain === 'service') {
    return actionMetadata.domain;
  }
  return 'service';
}

/** Type guard wrapper — keeps the surface ergonomic for triage callers. */
export function validateIntentId(id: string): asserts id is IntentId {
  if (!isValidIntentId(id)) {
    throw new Error(`Invalid IntentId from LLM: "${id}"`);
  }
}
