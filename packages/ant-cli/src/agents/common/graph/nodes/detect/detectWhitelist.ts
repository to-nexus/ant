/**
 * Detect-specific tool-call whitelist.
 *
 * Phase C SSOT — `inferRacWithTools` gates its `read_file` / `list_files`
 * calls through this helper. The whitelist is the union of:
 *
 *   1. Matrix slot directories (`slotDirs`) — the canonical surfaces the
 *      LLM is supposed to inspect to decide which file is `target` /
 *      `refs` / `context`.
 *   2. `featureContext.breadcrumbs[*].anchors.{specs, paths, files}` —
 *      cross-job artifact anchors so follow-up turns can re-read prior
 *      job outputs without re-classifying.
 *   3. `codebase/` — always allowed; the user's source tree is RAC-
 *      orthogonal (same contract as `decideRacGate`).
 *
 * Matching rules mirror `racGate.isWithinRacWhitelist` so the surface
 * stays consistent with decompose's gate. We allow parent-listing
 * (`list_files('architecture')` when the whitelist holds
 * `architecture/spec/`) so the LLM can do breadth-first discovery.
 *
 * Whitelist semantics: empty / undefined → allow everything (degrade-safe
 * for jobs that have not been migrated yet). A non-empty whitelist
 * enforces the union above.
 */

import type { FeatureContext } from '../../../../../core/context/featureContextBuilder';
import { normalizeToCodebasePath } from '../../../../../core/utils/pathNormalizer';

export interface DetectWhitelist {
  /** Normalized directory / file paths (trailing slash stripped). */
  paths: string[];
}

const CODEBASE_ROOT = 'codebase';

function normalize(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

/**
 * Build the union of slot directories + featureContext breadcrumb anchors +
 * `codebase/`. Duplicates are deduped. Empty inputs produce a single-entry
 * whitelist containing `codebase` so codebase reads always survive.
 */
export function buildDetectWhitelist(
  slotDirs: ReadonlyArray<string>,
  featureContext?: FeatureContext,
): DetectWhitelist {
  const set = new Set<string>();
  set.add(CODEBASE_ROOT);
  for (const dir of slotDirs) {
    if (!dir) continue;
    set.add(normalize(dir));
  }
  const bcs = featureContext?.breadcrumbs ?? [];
  for (const bc of bcs) {
    const a = bc.anchors;
    if (!a) continue;
    for (const arr of [a.specs, a.paths, a.files] as Array<string[] | undefined>) {
      if (!arr) continue;
      for (const p of arr) {
        if (typeof p === 'string' && p.length > 0) set.add(normalize(p));
      }
    }
  }
  return { paths: Array.from(set) };
}

/**
 * Decide whether a `read_file` / `list_files` call is allowed under the
 * active whitelist.
 *
 * Codebase-tree paths (anything normalized into `codebase/...`) are RAC-
 * orthogonal — always allowed. Sibling-tree paths must match an entry in
 * the whitelist exactly OR be a descendant / parent of one (parent
 * listings unlock breadth-first discovery).
 *
 * An empty whitelist or empty `requestedPath` is conservatively allowed
 * so callers that have not migrated yet keep working.
 */
export function isWithinDetectWhitelist(
  requestedPath: string,
  whitelist: DetectWhitelist | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!whitelist || whitelist.paths.length === 0) return { ok: true };
  if (!requestedPath) return { ok: true };

  const target = normalize(requestedPath);
  if (!target) return { ok: true };

  const normalizedTarget = normalizeToCodebasePath(target).normalized;
  if (normalizedTarget === CODEBASE_ROOT || normalizedTarget.startsWith(`${CODEBASE_ROOT}/`)) {
    return { ok: true };
  }

  for (const entry of whitelist.paths) {
    if (!entry) continue;
    if (entry === target) return { ok: true };
    if (target.startsWith(`${entry}/`)) return { ok: true };
    if (entry.startsWith(`${target}/`)) return { ok: true };
    if (entry === CODEBASE_ROOT && normalizedTarget === CODEBASE_ROOT) return { ok: true };
  }

  return {
    ok: false,
    reason:
      `Path '${target}' is outside the detect whitelist. ` +
      `Allowed surfaces: ${whitelist.paths.join(', ')}.`,
  };
}
