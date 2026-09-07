/**
 * Pure derivations for a completed step's `{{steps.<id>.*}}` output — the
 * seal reader (`pipelineRun/seals.ts`) applies them; tests exercise them here
 * without the coordinator's dependency chain.
 */

import { GLOB_PIN_TOTAL_CONTEXT_MAX } from '../scheduling/UniversalDispatchGate';
import { normalizeArtifactPath } from '../customAgents/stopHooks';
import { stripRegisteredTags } from '../streaming/OutputTagRegistry';

interface SealedHookCheck {
  hook?: { artifact?: string; action?: string };
  met?: boolean;
  matchedWrites?: string[];
}

/**
 * The files THIS step's job wrote that satisfy its artifact stop hooks — the
 * seal's own evidence (`lastTurnHooks[].matchedWrites`), never a tree walk. A
 * glob like `terms/*\/notice-period.md` matches every case in the tree, so
 * `{{steps.<id>.artifacts}}` is only a case-identity channel when it names
 * the run's own writes. Empty when the seal carries no artifact evidence (a
 * ledger-met hook, a pre-record session) — the caller falls back to the
 * bounded glob expansion in that case.
 */
export function stepArtifactsFromSeal(state: unknown): string[] | undefined {
  const hooks = (state as { lastTurnHooks?: unknown } | null)?.lastTurnHooks;
  if (!Array.isArray(hooks)) return undefined;
  const out = new Set<string>();
  for (const raw of hooks as SealedHookCheck[]) {
    if (!raw || typeof raw !== 'object' || raw.met !== true) continue;
    if (typeof raw.hook?.artifact !== 'string') continue;
    for (const w of raw.matchedWrites ?? []) {
      if (typeof w === 'string' && w.trim()) out.add(normalizeArtifactPath(w));
      if (out.size >= GLOB_PIN_TOTAL_CONTEXT_MAX) break;
    }
  }
  return out.size > 0 ? [...out] : undefined;
}

/**
 * The step's final answer as directive text: canonical tags (`<checklist>`,
 * `<verdict>`, …) are runtime channels, not prose — substituting them into a
 * downstream directive would hand the next step markup it must not echo.
 */
export function stepAnswerFromText(text: string): string {
  return stripRegisteredTags(text).trim();
}
