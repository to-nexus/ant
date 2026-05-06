/**
 * Intent Commit SSOT
 *
 * `isIntentCommitted(state)` is the single predicate that answers:
 *   "Has the upstream pipeline already committed to an intent?"
 *
 * Two observable signals express commitment:
 *   1. `state.actionMetadata.intent` is present — the UI or @-mention path
 *      handed the intent to the job as metadata, so triage/detect do not
 *      re-infer it. This is the authoritative commit channel.
 *   2. `state.resolvedAction.source === 'explicit'` — the legacy / parallel
 *      signal kept for back-compat. ActionsPanel "Start via Chat" sets this.
 *
 * Consumers of this predicate are places that must NOT re-adjudicate the
 * intent decision downstream — e.g. decompose's `<specClarify>` escape
 * hatch (which offers `redirect_to_design` = job switch, or
 * `proceed_without_spec` = skip the source contract). When intent is
 * committed, those re-adjudications have no standing.
 *
 * Content-level clarifications (planner PRD-gap questions, visual
 * sketch-variant selection, design spec content gaps, decompose
 * `CLARIFY_TOOL`) are NOT gated by this predicate — they ask about
 * content within the committed intent, not about the intent itself.
 *
 * See also: `AGENTS.md` "Retry Authority SSOT" — the class of bug
 * this predicate prevents is phase nodes overturning upstream decisions
 * with heuristics of their own.
 */

import type { ActionMetadata, ResolvedActionContext } from '@ant/shared';

export interface IntentCommittedState {
  actionMetadata?: ActionMetadata;
  resolvedAction?: Pick<ResolvedActionContext, 'source'> & Partial<ResolvedActionContext>;
}

/**
 * True when the upstream pipeline has already committed to an intent
 * (either via ActionMetadata or explicit RAC). Downstream nodes MUST NOT
 * re-adjudicate the intent when this returns true.
 */
export function isIntentCommitted(state: IntentCommittedState | undefined | null): boolean {
  if (!state) return false;
  if (state.actionMetadata?.intent) return true;
  if (state.resolvedAction?.source === 'explicit') return true;
  return false;
}

/**
 * Render-side flag for Handlebars templates. Every prompt that emits
 * an "intent-level clarify escape hatch" consumes the SAME variable
 * name (`intentClarifyDisabled`) so the gate cannot drift between
 * node wiring and template copy.
 */
export function buildIntentClarifyTemplateVars(
  state: IntentCommittedState | undefined | null,
): { intentClarifyDisabled: boolean } {
  return { intentClarifyDisabled: isIntentCommitted(state) };
}
