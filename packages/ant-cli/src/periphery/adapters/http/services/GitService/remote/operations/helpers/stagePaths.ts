import * as fs from 'fs';
import * as path from 'path';
import type { SimpleGit } from 'simple-git';

export interface StagePathsResult {
  /** Paths that exist on disk and were staged via `git add`. */
  added: string[];
  /** Index-resident ghosts (in `git status`, absent on disk) removed from the
   *  index via `git rm --cached --ignore-unmatch`. */
  healed: string[];
}

/**
 * Stage a reconciled path list with DISK EXISTENCE as the final authority.
 *
 * Production taught us that `git status` membership does not guarantee
 * `git add` acceptance: an index-resident entry (e.g. an intent-to-add
 * leftover from `git add -N .`) whose file has since been deleted can appear
 * in status yet make `git add <path>` abort the WHOLE list with
 * `fatal: pathspec ... did not match any files`. So:
 *
 *   - exists on disk  → `git add` (cannot pathspec-fatal — the file is there)
 *   - absent on disk  → `git rm -f -q --cached --ignore-unmatch` — stages the
 *     deletion for tracked files, deletes ghost index entries outright, and
 *     silently ignores unknown paths. Exit 0 in every case, on every git
 *     version (these flags predate git 2.0) — no version-dependent contract.
 *
 * Callers MUST check for an empty staged set afterwards (a ghost-only list
 * heals the index but stages nothing) before running `git commit`.
 */
export async function stagePaths(
  git: SimpleGit,
  codebasePath: string,
  paths: string[],
): Promise<StagePathsResult> {
  const added: string[] = [];
  const healed: string[] = [];
  for (const p of paths) {
    (fs.existsSync(path.join(codebasePath, p)) ? added : healed).push(p);
  }

  if (healed.length > 0) {
    // Diagnostic: dump the index flavor of each ghost (intent-to-add? stale
    // stage entry?) before healing — this is how we identify the state class
    // in production logs.
    let flavor = '';
    try {
      flavor = (await git.raw(['ls-files', '--stage', '--', ...healed])).trim();
    } catch {
      /* diagnostic only */
    }
    console.warn(
      `[stagePaths] healing ${healed.length} index-resident path(s) absent from disk: ${healed.join(', ')}` +
        (flavor ? `\n[stagePaths] index entries:\n${flavor}` : ''),
    );
    await git.raw(['rm', '-f', '-q', '--cached', '--ignore-unmatch', '--', ...healed]);
  }
  if (added.length > 0) {
    await git.add(added);
  }
  return { added, healed };
}

/** True when the index differs from HEAD — i.e. `git commit` has something to record. */
export async function hasStagedChanges(git: SimpleGit): Promise<boolean> {
  return (await git.raw(['diff', '--cached', '--name-only'])).trim().length > 0;
}
