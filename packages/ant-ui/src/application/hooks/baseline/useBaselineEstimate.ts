/**
 * useBaselineEstimate — Phase-3 STUB.
 *
 * Phase 2 will wire this hook to `GET /api/jobs/baseline-estimate` with
 * debounced refetch on (intent, refs, context, draft) change and writes
 * the result into the `kanban.baselinePhaseTokenUsage` slice so the
 * chat-input gauge can render the predicted next-call floor.
 *
 * For now the hook is a no-op so we can land the schema + UI plumbing
 * (PhaseTokenUsage.mode='baseline', gauge priority selector, broadcast
 * field) ahead of the endpoint. Consumers can mount this hook today; it
 * does nothing until Phase 2.
 *
 * Intentionally has NO side effects — does not subscribe, does not fetch.
 * Returning `undefined` keeps the gauge in its default (no baseline) state.
 */

import type { BaselineEstimate } from '@ant/shared';

export interface UseBaselineEstimateInput {
  /** Currently selected intent (from action card). */
  intent?: string;
  /** Explicit ref paths from action card. */
  refs?: readonly string[];
  /** Explicit context paths from action card. */
  context?: readonly string[];
  /** Current chat-input draft text (Phase 2 will char-count it). */
  draftText?: string;
}

export interface UseBaselineEstimateResult {
  estimate: BaselineEstimate | undefined;
  isLoading: boolean;
  error: Error | undefined;
}

export function useBaselineEstimate(
  _input: UseBaselineEstimateInput = {},
): UseBaselineEstimateResult {
  // Phase 3 stub — no network call. Phase 2 swaps this body for a real
  // debounced fetcher (React Query or equivalent) keyed on the input.
  return { estimate: undefined, isLoading: false, error: undefined };
}
