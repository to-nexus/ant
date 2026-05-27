/**
 * Choice resolution — Phase 12 chat-SSOT unified endpoint.
 *
 * The legacy `/chat/triage-choice`, `/chat/eval-save`, and
 * `/chat/dismiss-choice` endpoints were retired by Phase 9. Every
 * choice card now resolves through `POST /chat/choice-resolved`.
 *
 * The legacy helpers below are thin shims that delegate to
 * `resolveChoice` so existing call sites (TriageChoiceVariant,
 * EvalSaveVariant, ClarifyingVariant, CancelledVariant, dismiss
 * buttons) keep working until Phase 12's component migration is
 * complete. The shims are kept narrow — they translate (cardType,
 * choiceAction) into the unified `(cardId, choiceSelected,
 * resolvedLabel, answer?)` triple via `findCardId` (caller-supplied
 * cardId) — and will be deleted once every variant calls
 * `resolveChoice` directly.
 */

import { API_BASE, apiPost } from './client';

export type TriageChoiceAction = 'proceed' | 'proceedAnyway' | 'redirect' | 'guide' | 'dismiss';

export interface ChoiceResolveResponse {
  success: boolean;
  resolved: boolean;
  routing?: TriageRoutingResponse;
}

export interface TriageRoutingResponse {
  type: 'guide' | 'continue' | 'dismiss';
  message?: string;
  action?: TriageChoiceAction;
  suggestedAgent?: string;
  suggestedJob?: string;
  switchIntentId?: string;
  directive?: string;
}

/**
 * Unified choice-resolved POST. Idempotent at the BE via the per-cardId
 * NX flag; duplicate clicks no-op. The BE emits a `choice_resolved`
 * SSE event so the FE projector folds the card into its resolved state
 * automatically — callers do not need to mutate the local store.
 */
export function resolveChoice(
  projectId: string,
  featureName: string,
  args: {
    cardId: string;
    choiceSelected: string;
    resolvedLabel: string;
    answer?: Record<string, unknown>;
  },
): Promise<ChoiceResolveResponse> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/choice-resolved`,
    args,
  );
}

// ── Legacy shims (Phase 12 transitional) ────────────────────────────

export interface TriageChoiceResponse {
  type: 'guide' | 'continue' | 'dismiss';
  message?: string;
  action?: TriageChoiceAction;
  suggestedAgent?: string;
  suggestedJob?: string;
  switchIntentId?: string;
  directive?: string;
}

/**
 * Legacy triage-choice shim. Resolves the previously-presented triage
 * card via `resolveChoice`. The caller must supply the card's `cardId`.
 */
export async function submitTriageChoice(
  projectId: string,
  featureName: string,
  cardId: string,
  choice: TriageChoiceAction,
): Promise<TriageChoiceResponse> {
  const result = await resolveChoice(projectId, featureName, {
    cardId,
    choiceSelected: choice,
    resolvedLabel: choiceLabelForTriage(choice),
  });
  if (result.routing) return result.routing as TriageChoiceResponse;
  return { type: 'continue', action: choice };
}

export async function submitEvalSave(
  projectId: string,
  featureName: string,
  cardId: string,
  evalType: string,
  content: string,
): Promise<{ success: boolean; path?: string; resolvedLabel?: string }> {
  const result = await resolveChoice(projectId, featureName, {
    cardId,
    choiceSelected: 'save',
    resolvedLabel: 'Saved',
    answer: { evalType, content },
  });
  return { success: result.success, resolvedLabel: 'Saved' };
}

function choiceLabelForTriage(choice: TriageChoiceAction): string {
  switch (choice) {
    case 'proceed':
      return 'Proceeded';
    case 'proceedAnyway':
      return 'Proceeded anyway';
    case 'redirect':
      return 'Redirected';
    case 'guide':
      return 'Guidance shown';
    case 'dismiss':
      return 'Dismissed';
    default:
      return 'Resolved';
  }
}
