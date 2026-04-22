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
 *     separate artifact keeping the original role. Used for handoff bundles
 *     and for UiSource subgroups in general.
 *
 * Invariants enforced here:
 *   - Hard-exclusive UiSource: a RAC must not mix artifacts from more than one
 *     of `ui/ant`, `ui/figma`, `ui/handoff` (across refs+context). Violations
 *     throw immediately so the caller bails before producing a confused prompt.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedActionContext, ResolvedArtifact, UiSource } from '@ant/shared';
import { uiSourceOfPath } from '@ant/shared';
import { normalizeTemplateDoc } from '../../../core/utils/templateDetector';

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
 * Throws if RAC refs ∪ context contains paths from more than one UiSource.
 * Exported for tests and direct callers that want to check before load.
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
    for (const child of walkDir(absolute)) {
      const rel = path.relative(featurePath, child).split(path.sep).join('/');
      const content = readAndNormalize(child);
      if (content) out.push({ path: rel, content, role });
    }
    return;
  }

  const content = readAndNormalize(absolute);
  if (content) out.push({ path: relativePath, content, role });
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
