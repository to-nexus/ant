/**
 * Read-only git tree-ish accessors for reference git-mode (a branch that is not
 * materialized as a worktree). Scoped to one repo dir; never mutates. Uses
 * `git show` / `ls-tree` / `grep` against a ref, so no checkout is needed.
 *
 * A best-effort `fetch` runs first so `origin/<ref>` is available for branches
 * that live only on the remote; failures (no remote / offline / auth) are
 * swallowed and resolution falls back to a local ref.
 */

import simpleGit, { SimpleGit } from 'simple-git';

function git(repoDir: string): SimpleGit {
  return simpleGit({ baseDir: repoDir, binary: 'git', maxConcurrentProcesses: 4 });
}

/** Resolve a usable tree-ish for `ref`: local ref if present, else `origin/<ref>`. */
async function resolveRef(g: SimpleGit, ref: string): Promise<string> {
  try {
    await g.revparse(['--verify', `${ref}^{commit}`]);
    return ref;
  } catch {
    return `origin/${ref}`;
  }
}

/** Thrown when a git-mode object exceeds the caller's byte budget (M-032). */
export class RefGitTooLargeError extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(`reference object is ${size} bytes, over the ${limit}-byte limit`);
    this.name = 'RefGitTooLargeError';
  }
}

export async function refGitRead(
  repoDir: string,
  ref: string,
  filePath: string,
  maxBytes?: number,
): Promise<string> {
  const g = git(repoDir);
  try {
    await g.fetch('origin');
  } catch {
    /* best-effort */
  }
  const treeish = await resolveRef(g, ref);
  // Check the object size BEFORE materialising it — `git show` on a multi-GB
  // blob would otherwise buffer the whole thing into the job heap (M-032).
  if (maxBytes !== undefined) {
    try {
      const raw = await g.raw(['cat-file', '-s', `${treeish}:${filePath}`]);
      const size = Number(raw.trim());
      if (Number.isFinite(size) && size > maxBytes) throw new RefGitTooLargeError(size, maxBytes);
    } catch (err) {
      if (err instanceof RefGitTooLargeError) throw err;
      // cat-file failed (missing path / bad ref) — let git show surface it.
    }
  }
  return g.show([`${treeish}:${filePath}`]);
}

export async function refGitList(repoDir: string, ref: string, dir = ''): Promise<string[]> {
  const g = git(repoDir);
  try {
    await g.fetch('origin');
  } catch {
    /* best-effort */
  }
  const treeish = await resolveRef(g, ref);
  const args = ['ls-tree', '-r', '--name-only', treeish];
  if (dir) args.push(dir);
  const out = await g.raw(args);
  return out.split('\n').filter(Boolean);
}

export async function refGitGrep(
  repoDir: string,
  ref: string,
  pattern: string,
  pathspec?: string,
): Promise<string> {
  const g = git(repoDir);
  try {
    await g.fetch('origin');
  } catch {
    /* best-effort */
  }
  const treeish = await resolveRef(g, ref);
  const args = ['grep', '-n', '-I', '--heading', '-e', pattern, treeish];
  if (pathspec) args.push('--', pathspec);
  try {
    return await g.raw(args);
  } catch {
    // git grep exits non-zero when there are no matches
    return '';
  }
}
