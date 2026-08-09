/**
 * Detect-output parser for the universal detect node — `<intents>` +
 * `<executionTier>`.
 *
 * NOT registered in OutputTagRegistry — detect is a non-streaming invoke,
 * so the tags never reach the chat stream (same precedent as the canonical
 * triage `<intentId>` tag). The tier half reuses the shared
 * `parseExecutionTierTag` (core/executionTier SSOT) — never a bespoke regex.
 */

import { GENERAL_INTENT, type ExecutionTierId } from '@ant/shared';
import { parseExecutionTierTag } from '../../../../../core/executionTier';

const INTENTS_TAG = /<intents>([\s\S]*?)<\/intents>/;

export interface ParsedDetectResponse {
  /** Validated intent ids, or null when missing/all-unknown (caller retries). */
  intents: string[] | null;
  /** Parsed tier, or undefined when the tag is missing/malformed (caller retries). */
  executionTier: ExecutionTierId | undefined;
}

/**
 * Parse + validate the intent labels against the job's catalog vocabulary.
 * Returns null when the tag is missing or every listed id is unknown (caller
 * retries once, then falls back to `['general']` — detection failure must
 * never kill the turn).
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
      console.warn(`⚠️ [Universal:Detect] Dropping unknown intent id from LLM output: "${id}"`);
    }
  }
  if (valid.length === 0) return null;

  // A concrete match makes the implicit fallback redundant.
  const concrete = valid.filter((id) => id !== GENERAL_INTENT);
  return concrete.length > 0 ? concrete : [GENERAL_INTENT];
}

/** Parse both halves of the detect output in one pass. */
export function parseDetectResponse(
  raw: string,
  catalogIds: ReadonlySet<string>,
  opts: { needsIntents: boolean },
): ParsedDetectResponse {
  return {
    intents: opts.needsIntents ? parseIntentsTag(raw, catalogIds) : null,
    executionTier: parseExecutionTierTag(raw),
  };
}
