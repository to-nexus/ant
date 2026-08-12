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
 * Workspace domain resolution — the single SSOT. Precedence:
 *
 *   1. `configDomain` — `WorkspaceConfig.domain` from the project's
 *      `config.json`. Domain is a project-level property set at creation and
 *      changed only in project settings, so an explicit value is ABSOLUTE:
 *      nothing infers, guesses, or overrides it.
 *   2. `actionMetadata.domain` — the FE's mirror of the same `config.json`
 *      field. A per-turn buffer, so it is absent on plain chat turns; consulted
 *      only while (1) is absent.
 *   3. Workspace-shape hint — legacy fallback for projects that predate a
 *      persisted `domain`. A game workspace is recognised by a game-art design
 *      surface. Plan filenames are NOT a domain signal — `plan/prd.md` is
 *      domain-neutral in every domain.
 *   4. Default `'service'`.
 *
 * `intentId` is deliberately NOT an input. The earlier ladder pinned the domain
 * to `'game'` whenever the intent group was `design-game-art`, which inverted
 * the axis: the intent is chosen by the triage LLM *from a domain-scoped
 * candidate set*, so treating it as domain evidence let a mis-picked intent
 * overrule the project's own setting. Candidate scoping now lives at the one
 * place that owns it — `isIntentVisibleForDomain` filters the catalog before
 * the LLM ever sees it — which makes that rung both redundant and circular.
 *
 * This order matches `pickAssetsRoot` (`workspaceDomain` first), so the two
 * consumers of the axis no longer disagree about who owns it.
 */
export function resolveWorkspaceDomain(input: {
  configDomain?: Domain | string;
  actionMetadata?: ActionMetadata;
  workspaceState?: WorkspaceState;
}): Domain {
  if (isDomain(input.configDomain)) return input.configDomain;
  if (isDomain(input.actionMetadata?.domain)) return input.actionMetadata.domain;
  if (workspaceIsGameShaped(input.workspaceState)) return 'game';
  return 'service';
}

function isDomain(v: unknown): v is Domain {
  return v === 'game' || v === 'service';
}

/**
 * Legacy workspaceState → game hint (rung 3). A workspace is treated as
 * game-shaped when a game-art design surface holds real content. `analyzeWorkspace`
 * owns that predicate — note it must test populated content, not mere file
 * presence: `ensureCanonicalStructure` scaffolds an empty `game-art/figma/figma.json`
 * into every project, which once made every workspace game-shaped.
 */
function workspaceIsGameShaped(ws: WorkspaceState | undefined): boolean {
  if (!ws) return false;
  return ws.hasVisualGameArt === true;
}

/** Type guard wrapper — keeps the surface ergonomic for triage callers. */
export function validateIntentId(id: string): asserts id is IntentId {
  if (!isValidIntentId(id)) {
    throw new Error(`Invalid IntentId from LLM: "${id}"`);
  }
}
