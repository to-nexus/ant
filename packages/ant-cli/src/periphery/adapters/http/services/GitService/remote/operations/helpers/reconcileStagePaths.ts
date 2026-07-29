import type { StatusResult } from 'simple-git';

export interface ReconciledPaths {
  /** Paths present in the live status — safe to pass to `git add`. */
  stageable: string[];
  /** Requested paths absent from BOTH worktree and index — `git add` would
   *  abort atomically on any one of these (`fatal: pathspec ... did not match`). */
  dropped: string[];
  /** Stageable subset that is tracked (modified/deleted) — discard via `checkout --`. */
  tracked: string[];
  /** Stageable subset that is untracked — discard via `clean -f --`. */
  untracked: string[];
}

/**
 * Reconcile a caller-supplied path list against the live `git status` — the
 * single authority for pathspecs. Caller lists (FE snapshots, an LLM plan
 * captured before a long round-trip) are selection INTENT and can go stale at
 * any time: a once-untracked file deleted from disk matches neither the
 * worktree nor the index, and `git add` aborts the WHOLE list on the first
 * such path. Dropping dead paths here is what makes commit/discard immune to
 * every staleness channel at once (watcher blind spots, modal dwell time,
 * LLM latency windows).
 */
export function reconcileStagePaths(status: StatusResult, requested: string[]): ReconciledPaths {
  const alive = new Set(status.files.map((f) => f.path));
  const trackedSet = new Set([...status.modified, ...status.deleted]);
  const untrackedSet = new Set(status.not_added);

  const stageable: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const path of requested) {
    if (seen.has(path)) continue;
    seen.add(path);
    (alive.has(path) ? stageable : dropped).push(path);
  }

  return {
    stageable,
    dropped,
    tracked: stageable.filter((p) => trackedSet.has(p)),
    untracked: stageable.filter((p) => untrackedSet.has(p)),
  };
}
