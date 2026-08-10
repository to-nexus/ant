/**
 * Path containment SSOT.
 *
 * Two distinct guards live here because two distinct things can escape a
 * workspace root:
 *
 * 1. An *identifier* segment (`projectId`) that the caller supplies and the
 *    resolver concatenates into a path. `path.join` happily consumes `../` and
 *    URL decoding happens before the route handler ever sees it, so the segment
 *    must be rejected before it reaches `join`.
 * 2. A *relative path* under an already-trusted root. `path.resolve` normalizes
 *    the traversal away, but a symlink INSIDE the root can still point out of
 *    it — so an existing target is additionally compared by `realpath`.
 *
 * Both throw loudly rather than silently correcting: a rejected value means a
 * caller sent something no legitimate UI flow produces.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Characters/values that can never appear in a single path segment. */
const SEGMENT_REJECT = /[/\\\0]/;

/**
 * Assert that `projectId` is a single, traversal-free path segment and return
 * it unchanged.
 *
 * This is the chokepoint for the whole workspace path family: every feature /
 * codebase / git-anchor / universal path is derived from `getProjectPath`, so
 * guarding there covers the file API, the job runner and the git adapter at
 * once. `ProjectCrudService` already constrains created ids to
 * `^[a-zA-Z0-9_-]+$`, so no legitimate id is affected.
 */
export function assertProjectSegment(projectId: string): string {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('[pathContainment] projectId must be a non-empty string');
  }
  if (SEGMENT_REJECT.test(projectId) || projectId === '.' || projectId === '..' || path.isAbsolute(projectId)) {
    throw new Error(
      `[pathContainment] projectId must be a single path segment: ${JSON.stringify(projectId)}`,
    );
  }
  return projectId;
}

/** Is `target` at or below `root`, after normalization? (pure string form) */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

/**
 * Resolve `relPath` under `root` and assert the result stays inside it.
 *
 * When the resolved target (or its nearest existing ancestor) exists, the
 * comparison is redone on `realpath` so a symlink planted inside the root
 * cannot redirect a read/write outside of it.
 *
 * @throws when the path escapes — callers that want a soft skip should catch.
 */
export function assertWithinRoot(root: string, relPath: string): string {
  const absRoot = path.resolve(root);
  const target = path.resolve(absRoot, relPath);
  if (!isWithin(absRoot, target)) {
    throw new Error(`[pathContainment] path escapes its root: ${JSON.stringify(relPath)}`);
  }

  // Symlink check against the nearest existing ancestor: the leaf frequently
  // does not exist yet (create/write flows), but any existing ancestor link is
  // what a redirect would ride on.
  let probe = target;
  for (;;) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) return target; // nothing on disk to check
    probe = parent;
  }

  let realProbe: string;
  let realRoot: string;
  try {
    realProbe = fs.realpathSync(probe);
    realRoot = fs.realpathSync(absRoot);
  } catch {
    return target; // root itself missing — nothing to redirect through yet
  }
  if (!isWithin(realRoot, realProbe)) {
    throw new Error(`[pathContainment] path escapes its root via symlink: ${JSON.stringify(relPath)}`);
  }
  return target;
}

/**
 * Non-throwing form of {@link assertWithinRoot} for callers whose contract is
 * "skip what you cannot read" rather than "fail the request".
 */
export function resolveWithinRoot(root: string, relPath: string): string | null {
  try {
    return assertWithinRoot(root, relPath);
  } catch {
    return null;
  }
}
