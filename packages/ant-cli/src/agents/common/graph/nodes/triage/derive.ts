/**
 * Triage derive helpers — deterministic, matrix-only.
 *
 * Phase B v2: Triage LLM emits only `<intentId>X</intentId>`. Everything else
 * (group / mode / domain / continuationType) is computed from the matrix
 * (INTENT_DEFINITIONS) + workspaceState + actionMetadata. Pure functions, no
 * I/O, no LLM, no prereq judgement.
 */

import {
  deriveFromIntent,
  isValidIntentId,
  INTENT_DEFINITIONS,
  type IntentId,
  type IntentGroup,
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
 * Intent → IntentGroup. Used as the SSOT "job" identity for continuation
 * comparison. (Plan v2 §B "jobOf" — the 9 action groups map 1:1 to
 * IntentGroup; no separate `job` field needed on INTENT_DEFINITIONS.)
 */
export function jobOf(intentId: IntentId): IntentGroup | undefined {
  const def = INTENT_DEFINITIONS.find((d) => d.id === intentId);
  return def?.intentGroup;
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

/**
 * `'proceed'` when the prev/current pair stays inside the same intent group
 * (same job), `'switch'` when it crosses a job boundary, `undefined` when no
 * prior turn exists. Plan v2 §B — no LLM signal, intent identity is the
 * derivation source.
 */
export type ContinuationType = 'proceed' | 'switch';

export function deriveContinuationType(
  prev: IntentId | undefined,
  current: IntentId,
): ContinuationType | undefined {
  if (!prev) return undefined;
  if (prev === current) return 'proceed';
  const prevJob = jobOf(prev);
  const currJob = jobOf(current);
  if (prevJob && currJob && prevJob === currJob) return 'proceed';
  return 'switch';
}

/** Type guard wrapper — keeps the surface ergonomic for triage callers. */
export function validateIntentId(id: string): asserts id is IntentId {
  if (!isValidIntentId(id)) {
    throw new Error(`Invalid IntentId from LLM: "${id}"`);
  }
}
