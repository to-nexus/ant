/**
 * Artifact-tree auto-expansion policy.
 *
 * A workspace (universal) project's artifact root is free-form: the only
 * canonical top-level dir is `plan`, so an agent that writes its output into a
 * NEW root-level directory genuinely adds a top-level node mid-job. The old
 * rule auto-expanded the top level exactly once per workspace, which left such
 * a directory collapsed — and because the expanded set is in-memory, only a
 * browser refresh (which replays the first-populate) revealed its contents.
 *
 * A codespace (canonical) project builds its top level from a fixed list and
 * synthesizes placeholders for missing domains, so its top-level path set is
 * constant and this returns `null` on every tick after the first — behavior
 * there is unchanged.
 */
export interface ArtifactAutoExpandPlan {
  /**
   * Top-level dirs to union into the expanded set. MAY be empty: a plan is also
   * returned when only `seen` needs rebasing (a top-level dir disappeared), so
   * that recreating it later counts as new again.
   */
  fresh: string[];
  /** The set to store as "already offered to auto-expand". */
  nextSeen: Set<string>;
}

/**
 * Decide which top-level directories should be auto-expanded.
 *
 * Returns `null` when nothing at all changes, so the caller can leave state
 * (and every subscriber's reference) untouched.
 *
 * @param seen top-level dir paths already offered to auto-expand
 * @param topLevelDirPaths the CURRENT top-level directory paths
 */
export function planArtifactAutoExpand(
  seen: ReadonlySet<string>,
  topLevelDirPaths: readonly string[],
): ArtifactAutoExpandPlan | null {
  // A transient empty render (failed fetch, project switch) must not rebase
  // `seen` — clearing it would force-expand everything on the next tick.
  if (topLevelDirPaths.length === 0) return null;

  // First populate: expand the whole top level, as before.
  const fresh =
    seen.size === 0
      ? [...topLevelDirPaths]
      : topLevelDirPaths.filter((p) => !seen.has(p));

  // Rebase, don't accumulate: a delete-then-recreate is a NEW directory and
  // should expand again. That requires dropping vanished paths from `seen` even
  // on a tick that expands nothing — otherwise the recreated dir stays
  // collapsed forever.
  const nextSeen = new Set(topLevelDirPaths);
  const seenUnchanged = seen.size === nextSeen.size && [...nextSeen].every((p) => seen.has(p));

  if (fresh.length === 0 && seenUnchanged) return null;

  return { fresh, nextSeen };
}
