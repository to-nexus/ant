/**
 * Plan hash helpers — stable SHA-1 hashing of plan JSON bodies.
 *
 * Used by the Session to answer "has the LLM produced the same plan again
 * without making progress?". Whitespace and key ordering are normalised so
 * the detector does not false-fire on cosmetic drift.
 *
 * This module is pure (no state, no I/O). R2 compliant.
 */

import * as crypto from 'node:crypto';

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
}

/**
 * Stable SHA-1 hash for a plan JSON body. On unparseable input, falls back
 * to a whitespace-collapsed hash so the comparison still works (just less
 * tolerant of formatting drift).
 */
export function normalizePlanForHash(planText: string): string {
  const body = stripFences(planText);
  try {
    const parsed = JSON.parse(body);
    const stable = JSON.stringify(parsed, (_k, v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        return Object.keys(v)
          .sort()
          .reduce((acc: Record<string, unknown>, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {});
      }
      return v;
    });
    return crypto.createHash('sha1').update(stable).digest('hex');
  } catch {
    const collapsed = body.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha1').update(collapsed).digest('hex');
  }
}

/**
 * Count trailing history hashes that match the candidate hash directly.
 *
 * Consumers should hash the candidate plan once via `normalizePlanForHash`
 * and compare against the pre-hashed `snapshot.planHistoryHashes`. The
 * body-based detector that used to live here has been removed — `Session`
 * already holds the hashed history and exposes
 * `isPlanRepeated(planText)` as the single model-side entry point; a
 * second helper that rehashes every body on every call was dead weight.
 */
export function countRepeatedHash(
  historyHashes: readonly string[] | undefined,
  candidateHash: string,
): number {
  if (!historyHashes || historyHashes.length === 0) return 0;
  let count = 0;
  for (let i = historyHashes.length - 1; i >= 0; i--) {
    if (historyHashes[i] === candidateHash) count++;
    else break;
  }
  return count;
}
