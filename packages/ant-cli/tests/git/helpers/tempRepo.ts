/**
 * Temp-repo fixture seam — one owner for the two hazards a REAL git repository
 * brings into a test's teardown.
 *
 * 1. `git commit` (and `receive-pack` on a push target) ends by detaching git's
 *    auto maintenance. That process outlives the case and keeps writing into
 *    `.git/objects/pack`, so the teardown `rm` — which has already read the
 *    directory — dies with `ENOTEMPTY` (CI-only flake, 2026-09).
 * 2. Node retries an `ENOTEMPTY` rm exactly once, which a still-running writer
 *    outlasts.
 *
 * Fixtures that create their own repos silence the writer at the source with
 * `disableAutoMaintenance`; every temp root that can hold a repo — including
 * one the product code created — is removed through `rmTempDir` /
 * `rmTempDirAsync`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;

/**
 * Turn off git's background maintenance for a freshly created repo. Takes a
 * worktree dir or a bare git dir; addresses the repo explicitly rather than by
 * discovery so bare targets stay legal under `safe.bareRepository=explicit`.
 */
export function disableAutoMaintenance(repo: string): void {
  const dotGit = path.join(repo, '.git');
  const locate = fs.existsSync(dotGit)
    ? fs.statSync(dotGit).isDirectory()
      ? ['--git-dir', dotGit]
      : ['-C', repo] // linked worktree: `.git` is a file, not a dir
    : ['--git-dir', repo]; // bare
  execFileSync('git', [...locate, 'config', 'gc.auto', '0']);
  execFileSync('git', [...locate, 'config', 'maintenance.auto', 'false']);
}

/** Teardown rm that survives a background git process still touching the repo. */
export function rmTempDir(dir: string): void {
  fs.rmSync(dir, RM_OPTS);
}

export async function rmTempDirAsync(dir: string): Promise<void> {
  await fs.promises.rm(dir, RM_OPTS);
}
