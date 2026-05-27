/**
 * Triage Response Parser — single-tag intent lookup.
 *
 * Triage LLM emits ONE tag: `<intentId>X</intentId>`. The parser extracts
 * the intent id, validates it against INTENT_DEFINITIONS, and returns it.
 * Everything else (group / mode / domain / continuation) is derived by the
 * caller via `./derive.ts`.
 */

import { isValidIntentId, type IntentId } from '@ant/shared';

const INTENT_TAG_RE = /<intentId>\s*([a-zA-Z][\w-]*)\s*<\/intentId>/;

/**
 * Extract `<intentId>X</intentId>` from LLM output. Tolerant of surrounding
 * whitespace and unrelated text (the LLM may also explain its choice). The
 * caller (triage/index.ts) handles retry on `null` / invalid id.
 */
export function parseIntentIdTag(llmOutput: string): IntentId | null {
  if (!llmOutput) return null;

  const match = llmOutput.match(INTENT_TAG_RE);
  if (!match) {
    console.warn('[TriageParser] <intentId> tag not found in response');
    return null;
  }

  const raw = match[1].trim();
  if (!isValidIntentId(raw)) {
    console.warn(`[TriageParser] LLM emitted invalid IntentId: "${raw}"`);
    return null;
  }
  return raw as IntentId;
}

/**
 * Debug helper — return the raw inner string of `<intentId>...</intentId>`
 * without validation. Used by prompt log dumps.
 */
export function extractIntentIdRaw(llmOutput: string): string | null {
  const m = llmOutput?.match(INTENT_TAG_RE);
  return m ? m[1].trim() : null;
}
