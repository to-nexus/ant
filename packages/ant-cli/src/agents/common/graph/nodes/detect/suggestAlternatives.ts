/**
 * Alternative intent suggester — Phase C SSOT.
 *
 * Pure matrix + workspaceState lookup, NO LLM. Called by
 * `inferRacWithTools` when the LLM reports `<missingPrereq>`:
 *
 *   - `gen-code-spec` + spec dir empty   → suggest `[gen-spec, gen-code-directive]`
 *   - `gen-code-sys`  + design dir empty → suggest `[gen-sys-fe, gen-sys-be, gen-sys-full, gen-code-directive]`
 *   - `rev-*`         + target dir empty → suggest the same-job `gen-*` variant
 *
 * Returns an empty array when no usable alternative exists — the caller
 * surfaces `status='blocked'` instead of `'redirect-suggested'`.
 *
 * Reasons are short, locale-neutral English so they pass through the chat
 * pipeline unchanged. The choice-card label (Korean) is produced by the
 * caller via `buildChoiceFromAlternatives`.
 */

import type { IntentId } from '@ant/shared';
import { INTENT_DEFINITIONS } from '@ant/shared';
import type { WorkspaceState } from '../triage/types.js';
import type { SuggestedAlternative } from './types.js';

interface SuggestRule {
  /** When this intent is requested … */
  intentId: IntentId;
  /** … and this predicate over workspaceState is true … */
  when: (ws?: WorkspaceState) => boolean;
  /** … offer these alternatives (in order, first preferred). */
  alternatives: ReadonlyArray<{ intentId: IntentId; reason: string }>;
}

const RULES: ReadonlyArray<SuggestRule> = [
  // gen-code-spec: requires spec docs. If none, offer to write a spec first
  // or fall back to directive-only codegen.
  {
    intentId: 'gen-code-spec',
    when: ws => !ws?.hasArchitectureSpec,
    alternatives: [
      { intentId: 'gen-spec', reason: 'Create a spec document first' },
      { intentId: 'gen-code-directive', reason: 'Generate code directly from the directive' },
    ],
  },
  // gen-code-sys: requires system-design docs. Offer to design first or
  // fall back to directive-only codegen.
  {
    intentId: 'gen-code-sys',
    when: ws => !ws?.hasArchitectureSystem,
    alternatives: [
      { intentId: 'gen-sys-fe', reason: 'Design the frontend system first' },
      { intentId: 'gen-sys-be', reason: 'Design the backend system first' },
      { intentId: 'gen-sys-full', reason: 'Design the full-stack system first' },
      { intentId: 'gen-code-directive', reason: 'Generate code directly from the directive' },
    ],
  },
  // rev-* without a matching artifact: suggest the gen-* variant.
  {
    intentId: 'rev-spec',
    when: ws => !ws?.hasArchitectureSpec,
    alternatives: [{ intentId: 'gen-spec', reason: 'No spec to revise — create one' }],
  },
  {
    intentId: 'rev-sys',
    when: ws => !ws?.hasArchitectureSystem,
    alternatives: [
      { intentId: 'gen-sys-fe', reason: 'No frontend system doc — create one' },
      { intentId: 'gen-sys-be', reason: 'No backend system doc — create one' },
      { intentId: 'gen-sys-full', reason: 'No system design — create the full-stack doc' },
    ],
  },
  {
    intentId: 'rev-plan',
    when: ws => !ws?.hasPlan,
    alternatives: [{ intentId: 'gen-plan', reason: 'No plan to revise — create one' }],
  },
  {
    intentId: 'rev-ui',
    when: ws => !ws?.hasVisualUi,
    alternatives: [
      { intentId: 'gen-ui-figma', reason: 'No UI design — start from a Figma file' },
      { intentId: 'gen-ui-desc', reason: 'No UI design — describe the desired UI in text' },
    ],
  },
  {
    intentId: 'rev-game-art',
    when: ws => !ws?.hasVisualGameArt,
    alternatives: [
      { intentId: 'gen-game-art-figma', reason: 'No game-art doc — start from a Figma file' },
      { intentId: 'gen-game-art-desc', reason: 'No game-art doc — describe the desired art in text' },
    ],
  },
];

const VALID_INTENT_IDS = new Set<IntentId>(INTENT_DEFINITIONS.map(d => d.id));

function isValidIntentId(id: string): id is IntentId {
  return VALID_INTENT_IDS.has(id as IntentId);
}

/**
 * Return the list of alternative intent suggestions matching the active
 * intent + workspace state. Empty array when no rule applies → caller
 * should emit `status='blocked'`.
 *
 * All returned `intentId` values are validated against the matrix so
 * unknown ids never propagate downstream.
 */
export function suggestAlternativeIntents(
  intentId: IntentId,
  workspaceState?: WorkspaceState,
): SuggestedAlternative[] {
  const matched = RULES.find(r => r.intentId === intentId && r.when(workspaceState));
  if (!matched) return [];
  return matched.alternatives
    .filter(a => isValidIntentId(a.intentId))
    .map(a => ({ intentId: a.intentId, reason: a.reason }));
}
