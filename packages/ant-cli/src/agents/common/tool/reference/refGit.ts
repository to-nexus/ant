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

export async function refGitRead(repoDir: string, ref: string, filePath: string): Promise<string> {
  const g = git(repoDir);
  try {
    await g.fetch('origin');
  } catch {
    /* best-effort */
  }
  const treeish = await resolveRef(g, ref);
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
