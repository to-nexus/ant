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
 * Domain derivation (single SSOT — Game-Activation T1-a). Precedence:
 *
 *   1. `actionMetadata.domain` — explicit user selection (DomainToggle)
 *      always wins.
 *   2. Intent group — a `design-game-art` intent is game-only by
 *      construction (D28), so its presence pins the domain to `'game'`
 *      even on the infer path (chat-driven, no DomainToggle).
 *   3. Workspace-shape hint — a persisted game workspace is recognised
 *      by its canonical game artifacts: a `gdd.md` plan file or any
 *      `visual/game-art/ant/` design doc. Universal intents
 *      (`gen-spec` / `gen-sys-*` / `gen-code-*`) invoked in such a
 *      workspace resolve to `'game'` so downstream overlays / slots /
 *      catalogs pick the game branch instead of falling to service.
 *   4. Default `'service'`.
 *
 * This replaces the earlier metadata-only stub whose docstring promised a
 * workspaceState hint that was never implemented. With the hint wired here,
 * the game workarounds in `design/nodes/tool/handlers/assets.ts` and
 * `gameArtDesignDecompose.ts` (which re-derived game from the intent group
 * locally) become non-load-bearing.
 */
export function deriveTriageDomain(
  intentId: IntentId,
  workspaceState: WorkspaceState | undefined,
  actionMetadata: ActionMetadata | undefined,
): Domain {
  if (actionMetadata?.domain === 'game' || actionMetadata?.domain === 'service') {
    return actionMetadata.domain;
  }
  if (deriveFromIntent(intentId).intentGroup === 'design-game-art') {
    return 'game';
  }
  if (workspaceIsGameShaped(workspaceState)) {
    return 'game';
  }
  return 'service';
}

/**
 * Documented workspaceState → game hint. A workspace is treated as
 * game-shaped when it carries a canonical game artifact: the plan track
 * holds `gdd.md`, or any game-art design doc is present. UI (`ui-*.json`)
 * and PRD signals deliberately do NOT flip the domain — they are the
 * service default.
 */
function workspaceIsGameShaped(ws: WorkspaceState | undefined): boolean {
  if (!ws) return false;
  if (ws.hasVisualGameArt === true) return true;
  if (ws.planFileNames?.includes('gdd.md')) return true;
  return false;
}

/** Type guard wrapper — keeps the surface ergonomic for triage callers. */
export function validateIntentId(id: string): asserts id is IntentId {
  if (!isValidIntentId(id)) {
    throw new Error(`Invalid IntentId from LLM: "${id}"`);
  }
}
