/**
 * Shared helpers for the `<executionTier>N</executionTier>` LLM contract.
 *
 * Every Tier Entry Node (code/design Decompose, plan/visual Detect)
 * asks the LLM to emit this tag. The helpers below keep parsing and the
 * safe-default policy consistent across nodes.
 *
 * - `parseExecutionTierTag`  — extract the tag value from a raw LLM
 *   response. Returns `undefined` when the tag is missing or malformed.
 * - `coerceExecutionTier`    — apply the hard-default policy (Reflex)
 *   when the LLM violated the prompt contract. Emits a single warn
 *   line so the operator can spot prompt drift in logs.
 *
 * Prompt contract (Phase B):
 *   `<executionTier>0</executionTier>` | `<executionTier>1</executionTier>`
 *   | `<executionTier>2</executionTier>` | `<executionTier>3</executionTier>`
 *   | `<executionTier>4</executionTier>`
 *
 * No heuristic fallback is allowed — when the tag is missing the caller
 * treats it as a prompt violation and degrades to Tier 0 (safe, read-only).
 */

import { ExecutionTierId } from './types';

export function parseExecutionTierTag(
  raw: string | undefined,
): ExecutionTierId | undefined {
  if (!raw) return undefined;
  const match = raw.match(/<executionTier>\s*([\s\S]*?)\s*<\/executionTier>/i);
  if (!match) return undefined;
  const value = (match[1] || '').trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) return undefined;
  return n as ExecutionTierId;
}

export function coerceExecutionTier(
  parsed: ExecutionTierId | undefined,
  nodeLabel: string,
): ExecutionTierId {
  if (parsed === undefined) {
    console.warn(
      `⚠️  [${nodeLabel}] LLM output missing <executionTier> tag — defaulting to Tier 0 (Reflex).`,
    );
    return ExecutionTierId.Reflex;
  }
  return parsed;
}
