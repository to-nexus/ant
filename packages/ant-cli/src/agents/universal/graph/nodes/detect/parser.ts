/**
 * `<intents>` tag parser for the universal classify node.
 *
 * NOT registered in OutputTagRegistry — classify is a non-streaming invoke,
 * so the tag never reaches the chat stream (same precedent as the canonical
 * triage `<intentId>` tag).
 */

import { GENERAL_INTENT } from '@ant/shared';

const INTENTS_TAG = /<intents>([\s\S]*?)<\/intents>/;

/**
 * Parse + validate the classify output against the job's catalog vocabulary.
 * Returns null when the tag is missing or every listed id is unknown (caller
 * retries once, then falls back to `['general']` — classification failure
 * must never kill the turn).
 */
export function parseIntentsTag(raw: string, catalogIds: ReadonlySet<string>): string[] | null {
  const match = INTENTS_TAG.exec(raw);
  if (!match) return null;

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const token of match[1].split(',')) {
    const id = token.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === GENERAL_INTENT || catalogIds.has(id)) {
      valid.push(id);
    } else {
      console.warn(`⚠️ [Universal:Classify] Dropping unknown intent id from LLM output: "${id}"`);
    }
  }
  if (valid.length === 0) return null;

  // A concrete match makes the implicit fallback redundant.
  const concrete = valid.filter((id) => id !== GENERAL_INTENT);
  return concrete.length > 0 ? concrete : [GENERAL_INTENT];
}
