/**
 * loadResolvedArtifacts — Load file contents for RAC file slots
 *
 * Loads file contents for paths listed in RAC.refs[] and RAC.context[],
 * assigning artifact roles based on array membership.
 * Returns ResolvedArtifact[] to be stored on state.resolvedArtifacts (NOT in RAC).
 *
 * Path semantics:
 *   - File paths → loaded as a single artifact.
 *   - Directory paths → recursively scanned; every file beneath is loaded as a
 *     separate artifact keeping the original role. Used for UiSource subgroups
 *     in general.
 *
 * Handoff special case:
 *   - Paths under `visual/ui/handoff/` are NEVER eager-loaded. Each
 *     file becomes a STUB artifact (path + size + kind + read_file hint).
 *     The downstream LLM is expected to invoke `read_file` on the text
 *     entries it actually needs and reference binaries by path only. This
 *     mirrors how source code is handled elsewhere and avoids dumping large
 *     html/css/png bundles into the prompt.
 *
 * Invariants enforced here:
 *   - Hard-exclusive UiSource: a RAC must not mix artifacts from more than one
 *     of `ui/ant`, `ui/figma`, `ui/handoff` (across refs+context). Violations
 *     throw immediately so the caller bails before producing a confused prompt.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedActionContext, ResolvedArtifact, UiSource } from '@ant/shared';
import { ARTIFACT_PREFIX, uiSourceOfPath } from '@ant/shared';
import { normalizeTemplateDoc } from '../../../core/utils/templateDetector';
import { isBinaryPath } from '../../../core/utils/binaryExtensions';

export function loadResolvedArtifacts(
  resolvedAction: ResolvedActionContext,
  featurePath: string,
): ResolvedArtifact[] {
  validateUiSourceExclusivity(resolvedAction);

  const artifacts: ResolvedArtifact[] = [];

  for (const refPath of resolvedAction.refs ?? []) {
    appendPath(artifacts, featurePath, refPath, 'ref');
  }

  for (const ctxPath of resolvedAction.context ?? []) {
    appendPath(artifacts, featurePath, ctxPath, 'context');
  }

  return artifacts;
}

/**
 * Safety net for the hard-exclusive UiSource invariant.
 *
 * The invariant is enforced upstream by `normalizeUiSourceRefs`
 * (`@ant/shared/canonical.ts`) — every funnel that produces a RAC
 * (`resolveToRAC` / `mergeWithMetadata`) and every funnel that mutates the
 * FE pre-RAC state (`useStore.updateActionMetadata`, `ActionConfigView`
 * auto-fill via `pickDefaultUiSourceRefs`) routes through it. On the happy
 * path this function therefore NEVER throws.
 *
 * If it does throw, a caller has bypassed the SSOT funnel and produced a
 * mixed-UiSource RAC. That is the canonical regression signal for this
 * domain rule — fix the bypassing caller, do not relax this guard.
 */
export function validateUiSourceExclusivity(resolvedAction: ResolvedActionContext): void {
  const present = new Set<UiSource>();
  const all = [...(resolvedAction.refs ?? []), ...(resolvedAction.context ?? [])];
  for (const p of all) {
    const src = uiSourceOfPath(p);
    if (src !== null) present.add(src);
  }
  if (present.size > 1) {
    const sources = Array.from(present).join(', ');
    throw new Error(
      `RAC contains mixed UiSource paths (${sources}); only one ui-source slot may be selected per intent.`,
    );
  }
}

function appendPath(
  out: ResolvedArtifact[],
  featurePath: string,
  relativePath: string,
  role: 'ref' | 'context',
): void {
  const absolute = path.join(featurePath, relativePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    // Defense-in-depth for the hard-exclusive UiSource invariant: a directory
    // ref must never span more than one subgroup. `validateUiSourceExclusivity`
    // checks RAC paths only and is blind to an un-narrowed parent `visual/ui`
    // (which classifies as null) — but walking it sweeps ant/figma/handoff into
    // one pool. Narrowing is owned upstream (inferRacWithTools /
    // pickUiSourceSubgroupDir); this throw fires only if a caller bypassed it.
    const seenUiSources = new Set<UiSource>();
    for (const child of walkDir(absolute)) {
      const rel = path.relative(featurePath, child).split(path.sep).join('/');
      const childSrc = uiSourceOfPath(rel);
      if (childSrc) {
        seenUiSources.add(childSrc);
        if (seenUiSources.size > 1) {
          throw new Error(
            `loadResolvedArtifacts: directory ref "${relativePath}" spans multiple UI sources ` +
              `(${Array.from(seenUiSources).join(', ')}); a ui-source ref must be narrowed to one ` +
              `subgroup before RAC resolution (see inferRacWithTools / pickUiSourceSubgroupDir).`,
          );
        }
      }
      if (isHandoffPath(rel)) {
        try {
          const s = fs.statSync(child);
          out.push({ path: rel, content: buildHandoffStub(rel, s.size), role });
        } catch { /* unreadable child — skip */ }
        continue;
      }
      const content = readAndNormalize(child);
      if (content) out.push({ path: rel, content, role });
    }
    return;
  }

  if (isHandoffPath(relativePath)) {
    out.push({ path: relativePath, content: buildHandoffStub(relativePath, stat.size), role });
    return;
  }
  const content = readAndNormalize(absolute);
  if (content) out.push({ path: relativePath, content, role });
}

/**
 * Handoff paths are not eager-loaded. Rather than embedding content, we emit
 * a stub so the downstream prompt surfaces a manifest-style entry and the
 * execute-phase LLM picks up files on demand via `read_file`. Binaries are
 * tagged path-only (utf-8 reads would be garbage).
 */
function isHandoffPath(rel: string): boolean {
  const handoffRoot = ARTIFACT_PREFIX.UI_HANDOFF.replace(/\/$/, '');
  return rel === handoffRoot || rel.startsWith(ARTIFACT_PREFIX.UI_HANDOFF);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildHandoffStub(relPath: string, sizeBytes: number): string {
  const kind = isBinaryPath(relPath) ? 'binary' : 'text';
  const size = formatSize(sizeBytes);
  if (kind === 'binary') {
    return [
      `[handoff asset] ${relPath}`,
      `size: ${size}, kind: binary`,
      `Reference this path from code output; do NOT call read_file on it.`,
    ].join('\n');
  }
  return [
    `[handoff file] ${relPath}`,
    `size: ${size}, kind: text`,
    `Call read_file("${relPath}") — optionally with startLine/endLine — to observe contents on demand.`,
  ].join('\n');
}

function* walkDir(dirAbs: string): Iterable<string> {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const childAbs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      yield* walkDir(childAbs);
    } else if (e.isFile()) {
      yield childAbs;
    }
  }
}

function readAndNormalize(absolute: string): string | null {
  try {
    const raw = fs.readFileSync(absolute, 'utf-8');
    return normalizeTemplateDoc(raw);
  } catch {
    return null;
  }
}
