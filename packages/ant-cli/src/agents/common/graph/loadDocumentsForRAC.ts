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
import { ARTIFACT_PREFIX, uiSourceOfPath, gameArtSourceOfPath } from '@ant/shared';
import { normalizeTemplateDoc } from '../../../core/utils/templateDetector';
import { sniffFd, formatByteSize } from '../../../core/utils/binaryExtensions';
import { isIgnoredWalkDir, isIgnoredWalkFile } from '../../../core/codebase/walkIgnore';
import { resolveCanonicalWithinRoot } from '../../../core/config/pathContainment';
import { statContained, withContainedFd, readTextContained } from '../../../core/config/containedIo';

export function loadResolvedArtifacts(
  resolvedAction: ResolvedActionContext,
  featurePath: string,
): ResolvedArtifact[] {
  validateUiSourceExclusivity(resolvedAction);
  validateGameArtSourceExclusivity(resolvedAction);

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
  validateSourceExclusivity(resolvedAction, uiSourceOfPath, 'UiSource');
}

/**
 * Game-art sibling of `validateUiSourceExclusivity` (WS2 §3). Same domain rule
 * on the `visual/game-art/{ant,figma,handoff}` sub-sources: a RAC must not mix
 * more than one. The two surfaces are domain-exclusive (D28), so in practice
 * only one of the two guards ever sees classified paths — running both is
 * cheap defense-in-depth.
 */
export function validateGameArtSourceExclusivity(resolvedAction: ResolvedActionContext): void {
  validateSourceExclusivity(resolvedAction, gameArtSourceOfPath, 'GameArtSource');
}

/** Generic exclusivity guard — single owner for both source surfaces. */
function validateSourceExclusivity(
  resolvedAction: ResolvedActionContext,
  sourceOf: (p: string) => UiSource | null,
  label: string,
): void {
  const present = new Set<UiSource>();
  const all = [...(resolvedAction.refs ?? []), ...(resolvedAction.context ?? [])];
  for (const p of all) {
    const src = sourceOf(p);
    if (src !== null) present.add(src);
  }
  if (present.size > 1) {
    const sources = Array.from(present).join(', ');
    throw new Error(
      `RAC contains mixed ${label} paths (${sources}); only one source slot may be selected per intent.`,
    );
  }
}

function appendPath(
  out: ResolvedArtifact[],
  featurePath: string,
  relativePath: string,
  role: 'ref' | 'context',
): void {
  // Codebase channel (token-cost-0 contract). The `codebaseSlot` path is `''`
  // and code-anchored intents also anchor on `codebase/`. The codebase is
  // NEVER eager-loaded into the pool: it is served via the codebase manifest
  // (`listFiles('codebase')` in decompose) + the `codebase-channel` partial +
  // on-demand `read_file` / `list_files` tools. Eager-walking it here both
  // duplicates that channel and (for installed deps) explodes the prompt — the
  // `fern-grading-knife` 7.85M-token crash walked 22,131 node_modules files.
  // A directory enters as a reference, not as exploded content.
  if (isCodebaseScopedPath(relativePath)) return;

  // RAC paths originate in the execute request's `actionMetadata`, so they are
  // caller-controlled. Everything below reads from disk and injects the content
  // into the decompose prompt (and thence to the model provider), so a path
  // that escapes the feature root would exfiltrate another workspace's files.
  // Skip rather than throw: the contract of this function is already
  // "unreadable path → skip" (the statSync catch below).
  //
  // Containment is bound to the file object, not to the name: a link swapped
  // between the check and the read used to redirect this at any file the
  // service account could reach (H-011).
  const entry = statContained(featurePath, relativePath);
  if (!entry.ok) return;
  const stat = entry.stat;
  // The walk below keeps the REQUESTED name: `rel` becomes
  // `ResolvedArtifact.path`, drives `uiSourceOfPath` classification and is the
  // literal the model is told to `read_file`. Canonicalising it would silently
  // change a UiSource verdict.
  const absolute = path.resolve(featurePath, relativePath);

  if (stat.isDirectory()) {
    // Defense-in-depth for the hard-exclusive UiSource invariant: a directory
    // ref must never span more than one subgroup. `validateUiSourceExclusivity`
    // checks RAC paths only and is blind to an un-narrowed parent `visual/ui`
    // (which classifies as null) — but walking it sweeps ant/figma/handoff into
    // one pool. Narrowing is owned upstream (inferRacWithTools /
    // pickUiSourceSubgroupDir); this throw fires only if a caller bypassed it.
    const seenSources = new Set<UiSource>();
    for (const child of walkDir(absolute)) {
      // Same containment check per entry: the directory itself is contained,
      // but a symlink inside it can still point out of the feature root.
      if (!resolveCanonicalWithinRoot(featurePath, child)) continue;
      const rel = path.relative(featurePath, child).split(path.sep).join('/');
      // Classify against BOTH surfaces (WS2 §3) — a game-art dir child
      // classifies via gameArtSourceOfPath (uiSourceOfPath returns null for it).
      const childSrc = uiSourceOfPath(rel) ?? gameArtSourceOfPath(rel);
      if (childSrc) {
        seenSources.add(childSrc);
        if (seenSources.size > 1) {
          throw new Error(
            `loadResolvedArtifacts: directory ref "${relativePath}" spans multiple sources ` +
              `(${Array.from(seenSources).join(', ')}); a source ref must be narrowed to one ` +
              `subgroup before RAC resolution (see inferRacWithTools / pickUiSourceSubgroupDir).`,
          );
        }
      }
      if (isStubLoadedPath(rel)) {
        // One open: kind and size must describe the same inode.
        const sniff = withContainedFd(featurePath, child, fd => sniffFd(fd, rel));
        if (sniff.ok) {
          out.push({
            path: rel,
            content: buildHandoffStub(rel, sniff.value.binary ? 'binary' : 'text', sniff.value.size),
            role,
          });
        }
        continue;
      }
      const content = readAndNormalize(featurePath, child);
      if (content) out.push({ path: rel, content, role });
    }
    return;
  }

  if (isStubLoadedPath(relativePath)) {
    const sniff = withContainedFd(featurePath, relativePath, fd => sniffFd(fd, relativePath));
    if (sniff.ok) {
      out.push({
        path: relativePath,
        content: buildHandoffStub(
          relativePath,
          sniff.value.binary ? 'binary' : 'text',
          sniff.value.size,
        ),
        role,
      });
    }
    return;
  }
  const content = readAndNormalize(featurePath, relativePath);
  if (content) out.push({ path: relativePath, content, role });
}

/**
 * Stub-loaded paths are NOT eager-read into the pool. Rather than embedding
 * content, we emit a stub so the downstream prompt surfaces a manifest-style
 * entry and the execute-phase LLM picks up files on demand via `read_file`
 * (binaries are tagged path-only — utf-8 reads would be garbage).
 *
 * Two families qualify:
 *   - handoff sub-sources (`visual/{ui,game-art}/handoff/**`) — WS2 §3C.
 *   - asset pools (`assets/{service,game}/**`) — real binary/asset files the
 *     code/spec job references and copies, never injects as content
 *     (state.artifacts Post-RAC SSOT; Asset Surface Boundary I6).
 */
function isStubLoadedPath(rel: string): boolean {
  const startsWithRoot = (prefix: string): boolean => {
    const root = prefix.replace(/\/$/, '');
    return rel === root || rel.startsWith(prefix);
  };
  return (
    startsWithRoot(ARTIFACT_PREFIX.UI_HANDOFF) ||
    startsWithRoot(ARTIFACT_PREFIX.GAME_ART_HANDOFF) ||
    startsWithRoot(ARTIFACT_PREFIX.ASSETS_SERVICE) ||
    startsWithRoot(ARTIFACT_PREFIX.ASSETS_GAME)
  );
}

/**
 * Codebase-scoped RAC paths: the empty `codebaseSlot` path (`''`, which would
 * `path.join` to the feature root) and anything under `codebase/`. These are
 * served by the codebase channel (manifest + tools), never the eager pool.
 */
function isCodebaseScopedPath(rel: string): boolean {
  const norm = rel.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  return norm === '' || norm === 'codebase' || norm.startsWith('codebase/');
}

// Path-only stub for handoff sub-sources AND asset pools. Binary entries are
// referenced by path (never read_file'd); text entries advertise on-demand read.
// Kind comes from the content sniff (extension fast-path + head bytes), so
// novel asset formats classify correctly without an extension whitelist.
function buildHandoffStub(relPath: string, kind: 'binary' | 'text', sizeBytes: number): string {
  const size = formatByteSize(sizeBytes);
  if (kind === 'binary') {
    return [
      `[asset] ${relPath}`,
      `size: ${size}, kind: binary`,
      `Reference this path from code output (copy it into the app's static-asset root); do NOT call read_file on it.`,
    ].join('\n');
  }
  return [
    `[reference file] ${relPath}`,
    `size: ${size}, kind: text`,
    `Call read_file("${relPath}") — optionally with startLine/endLine — to observe contents on demand.`,
  ].join('\n');
}

function* walkDir(dirAbs: string): Iterable<string> {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const e of entries) {
    const childAbs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      // Hygiene for any non-codebase directory ref (e.g. curated UiSource
      // subgroups): never descend into dependency/build output. Codebase
      // itself is already excluded upstream (`isCodebaseScopedPath`).
      if (isIgnoredWalkDir(e.name)) continue;
      yield* walkDir(childAbs);
    } else if (e.isFile()) {
      if (isIgnoredWalkFile(e.name)) continue;
      yield childAbs;
    }
  }
}

function readAndNormalize(featurePath: string, target: string): string | null {
  const read = readTextContained(featurePath, target);
  return read.ok ? normalizeTemplateDoc(read.text) : null;
}
