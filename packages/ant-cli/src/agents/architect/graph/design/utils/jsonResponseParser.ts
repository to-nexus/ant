/**
 * Design decompose JSON response parser — thin wrapper over the
 * project-wide LLM response SSOT.
 *
 * Pure module — no state / deps / side effects. Lives in axis ⑧ per
 * NODE_GRAPH_LAYOUT §3 R3.
 *
 * The actual extraction (`<decompose>` tag → markdown fence → brace-
 * balanced raw) lives in `core/utils/llmResponseParser`. This wrapper
 * exists only to preserve the legacy throw-on-failure contract that
 * `uiDesignDecompose` / `systemDesignDecompose` / `gameArtDesignDecompose`
 * rely on.
 */

import { extractJsonFromLlmResponse } from '../../../../../core/utils/llmResponseParser';

/**
 * Parse LLM JSON response from a design decompose call.
 *
 * Tier order (delegated to the SSOT):
 *   1. `<decompose> ... </decompose>`
 *   2. `` ```json ... ``` ``
 *   3. Brace-balanced extraction of the first `{ ... }` from the raw text
 *
 * Every tier tolerates surrounding prose and incidental code fences,
 * which closes the same prose-leak class observed in code's per-`<task>`
 * decompose contract.
 */
export function parseLLMJsonResponse(textResponse: string): any {
  const parsed = extractJsonFromLlmResponse<any>(textResponse, {
    tag: 'decompose',
    sanitize: true,
  });
  if (parsed === null) {
    throw new Error('Could not parse task breakdown from LLM response');
  }
  return parsed;
}
