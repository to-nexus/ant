/**
 * RAC (Resolved Action Context) whitelist gate for decompose tool calls.
 *
 * Closure for the `discovery-tool RAC bypass (2026-04)` regression: when the resolved
 * action is `explicit` and carries a non-empty RAC, decompose's
 * `read_file` / `list_files` tool calls MUST be limited to the union of
 * `refs ∪ context`. Without this gate, the prompt's
 * `fe-main → fe-system-main.md` mapping table tempts the LLM to
 * side-load architecture/system docs the user explicitly excluded.
 *
 * The gate is decompose-specific. Common `read_file`/`list_files`
 * handlers stay RAC-orthogonal — workers and other callers don't have a
 * RAC to honor — so the policy lives here as a wrapper around the
 * common handlers, not inside them.
 *
 * Lifted verbatim from the deleted `discoveryTools.ts`. Same predicate,
 * same deny message, same orthogonality contract.
 */

import type { ResolvedActionContext } from '@ant/shared';
import { ARTIFACT_PREFIX } from '@ant/shared';
import { normalizeToCodebasePath } from '../../../../../../core/utils/pathNormalizer';
import { toNfc } from '../../../../../../core/utils/unicodePath';

export const RAC_DENY_MESSAGE =
  'Path is outside the RAC selection (refs/context). Decompose with explicit ' +
  'RAC must rely only on user-selected sources — do not read or list files ' +
  'the user did not include in this turn.';

export interface RacScope {
  refs: string[];
  context: string[];
}

/**
 * Derive the active RAC scope from a resolved action. Pure function shared by
 * every code-job phase that gates `read_file` / `list_files` (decompose inline
 * dispatch + the shared code `tool` node serving plan/execute).
 *
 * Returns a `RacScope` only for the explicit pipeline (user pinned the RAC):
 * `source === 'explicit'` AND `hasExplicitFields` AND `refs ∪ context` non-empty.
 * Infer pipelines return `undefined` → `decideRacGate` allows everything
 * (the LLM legitimately needs to discover anchors).
 */
export function computeRacScope(
  resolvedAction: ResolvedActionContext | undefined,
): RacScope | undefined {
  const refs = resolvedAction?.refs ?? [];
  const context = resolvedAction?.context ?? [];
  const isExplicit =
    resolvedAction?.source === 'explicit'
    && (resolvedAction?.hasExplicitFields ?? false)
    && (refs.length + context.length > 0);
  return isExplicit ? { refs, context } : undefined;
}

/**
 * Is `requestedPath` inside the RAC whitelist?
 *
 * A request matches an entry when:
 *   - the entry equals the requested path (exact file slot), OR
 *   - the requested path starts with `entry + '/'` (directory slot), OR
 *   - the entry starts with `requestedPath + '/'` (listing a parent of
 *     a RAC entry — needed so `list_files('architecture')` succeeds when
 *     the RAC carries `architecture/spec/` as a directory slot).
 *
 * Returns `true` when no `racScope` is configured (= infer pipeline) or
 * the scope is empty. The caller is responsible for orthogonality
 * between codebase paths (always allowed) and sibling-artifact paths
 * (gated here when racScope is set).
 */
export function isWithinRacWhitelist(
  requestedPath: string,
  racScope: RacScope | undefined,
): boolean {
  if (!racScope) return true;

  // toNfc both sides: RAC entries derive from disk enumeration (NFD on Linux
  // for macOS uploads) while the LLM re-emits requested paths in NFC.
  const entries = [...(racScope.refs ?? []), ...(racScope.context ?? [])]
    .map(p => toNfc(p.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '')));
  if (entries.length === 0) return true;

  const target = toNfc(requestedPath.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, ''));

  for (const entry of entries) {
    if (entry === target) return true;
    if (target.startsWith(entry + '/')) return true;
    if (entry.startsWith(target + '/')) return true;
    if (target === '') return true;
  }
  return false;
}

/**
 * Is `target` inside (or a parent of) an asset pool root?
 *
 * The gate protects *authority documents* — PRD, system design, spec — from
 * side-loading. Asset pools are not authority: they enter the artifact pool
 * as existence-only path stubs and already ride along with every selection
 * regardless of `task.include` (`ArtifactPipeline.ridesAlongRegardlessOfInclude`). Gating
 * the READ side while the injection side exempts them left the two layers
 * disagreeing — a task told "the spec requires assets/game/models/X.glb"
 * could not `list_files` it, and fell back to whole-filesystem `find`
 * sweeps that time out. `run_command` was never gated, so the containment
 * this denial bought was zero.
 *
 * Parent-of match mirrors `isWithinRacWhitelist`'s directory-listing rule so
 * `list_files('assets')` can reach the pool roots.
 */
function isAssetPoolReach(target: string): boolean {
  const t = target.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
  if (!t) return false;
  for (const root of [
    ARTIFACT_PREFIX.ASSETS_SERVICE,
    ARTIFACT_PREFIX.ASSETS_GAME,
    // Visual-job output. A canonical pool of real files that the read gate
    // denied while the injection layer happily listed it — the same two-layer
    // disagreement the service/game pools were exempted for.
    ARTIFACT_PREFIX.ASSETS_GEN,
  ]) {
    const r = root.replace(/\/$/, '');
    if (t === r || t.startsWith(r + '/') || r.startsWith(t + '/')) return true;
  }
  return false;
}

/**
 * Decide whether a `read_file` / `list_files` tool call is allowed under
 * the active RAC scope.
 *
 * Two RAC-orthogonal families are always reachable:
 *   - codebase-tree paths (anything that normalizes under `codebase/`) —
 *     the user's source code;
 *   - asset pools (`assets/{service,game,gen}/**`) — see `isAssetPoolReach`.
 *
 * Every other sibling artifact path (`plan/`, `architecture/`, `visual/`,
 * `meta/`, `sessions/`) is gated through `isWithinRacWhitelist` when
 * `racScope` is set; infer pipelines (no `racScope`) allow everything.
 *
 * The codebase decision is derived from `normalizeToCodebasePath` — the SAME
 * SSOT every other tool callsite uses for sibling-vs-codebase classification
 * — so the gate stays in lockstep with `CANONICAL_FEATURE_DIRS` instead of
 * carrying its own prefix list.
 */
export function decideRacGate(
  target: string,
  racScope: RacScope | undefined,
): { allowed: true } | { allowed: false; error: string } {
  if (!racScope || !target) return { allowed: true };

  const normalized = normalizeToCodebasePath(target).normalized;
  const isCodebase = normalized === 'codebase' || normalized.startsWith('codebase/');
  if (isCodebase) return { allowed: true };

  if (isAssetPoolReach(target)) return { allowed: true };

  if (isWithinRacWhitelist(target, racScope)) return { allowed: true };
  return { allowed: false, error: RAC_DENY_MESSAGE };
}

