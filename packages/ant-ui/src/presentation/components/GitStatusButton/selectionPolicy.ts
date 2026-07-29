import type { GitSnapshot } from '@ant/shared';

/**
 * Distinct changed paths across all three snapshot buckets. A file changed in
 * both index and worktree appears in `staged` AND `unstaged` — raw
 * concatenation double-counts it, skewing the count badge and the
 * full-vs-partial selection check.
 */
export function distinctChangedPaths(
  snapshot: Pick<GitSnapshot, 'staged' | 'unstaged' | 'untracked'>,
): string[] {
  return Array.from(
    new Set([
      ...snapshot.staged.map((f) => f.path),
      ...snapshot.unstaged.map((f) => f.path),
      ...snapshot.untracked.map((f) => f.path),
    ]),
  );
}

/**
 * The file list to ship with a commit/discard dispatch.
 *
 * Full selection → `undefined` (no list): the BE then stages filesystem
 * truth (`git add '.'`), which is structurally immune to a stale snapshot —
 * a once-listed file that has since vanished simply isn't there to stage.
 * Only a REAL partial selection ships an explicit list, and the BE
 * reconciles it against live `git status` before `git add`.
 */
export function derivePartialSelection(
  selectedFiles: string[],
  distinctTotal: number,
): string[] | undefined {
  return selectedFiles.length < distinctTotal ? selectedFiles : undefined;
}
