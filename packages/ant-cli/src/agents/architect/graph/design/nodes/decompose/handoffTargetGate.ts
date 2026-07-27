/**
 * Handoff revise target gate — single owner for both design surfaces
 * (game-art + ui).
 *
 * Refactor × handoff invariant: **the bundle on disk is the layout
 * authority.** Every task's `targetFile` must be an existing bundle path
 * (verbatim, bundle-relative) unless the task explicitly declares
 * `"newFile": true` AND the new path extends the bundle's EXISTING directory
 * family (its first path segment matches a directory the bundle already has,
 * or it is a bundle-root file).
 *
 * Normalize-and-validate: the pool manifest renders full workspace-relative
 * paths (`visual/.../handoff/...`), so a contract-compliant LLM may emit
 * `targetFile` with the bundle prefix attached. The gate strips the prefix
 * in place BEFORE validating — the same task objects flow into the
 * taskQueue, so execute's `targetDir + targetFile` join stays correct.
 *
 * Without this gate the decompose LLM re-derives the canonical producer
 * layout (DESIGN.md / tokens/ / components/ / screens/) beside whatever the
 * user actually dropped into the handoff dir, creating a blind duplicate
 * structure (outer-blending-prism RCA).
 *
 * Throws — callers funnel the throw into their existing
 * `parseAndValidate → repairCall` corrective retry, so the error message IS
 * the retry instruction.
 */

export interface HandoffTaskTarget {
  id: string;
  targetFile: string;
  newFile?: boolean;
}

export function validateHandoffReviseTargets(opts: {
  tasks: HandoffTaskTarget[];
  /** Post-RAC pool (path stubs suffice — only `path` is read). */
  artifacts: Array<{ path: string }>;
  /** `ARTIFACT_PREFIX.GAME_ART_HANDOFF` or `ARTIFACT_PREFIX.UI_HANDOFF`. */
  bundlePrefix: string;
  /** `state.resolvedAction?.mode` — the gate only applies to `refactor`. */
  mode: string | undefined;
  /** Log/error tag, e.g. `[GameArtDecompose]`. */
  tag: string;
}): void {
  if (opts.mode !== 'refactor') return;
  const prefix = opts.bundlePrefix.endsWith('/') ? opts.bundlePrefix : `${opts.bundlePrefix}/`;
  // Normalize: strip the bundle prefix off full-path targetFiles in place
  // (manifest paths are workspace-relative; the gate + execute join are
  // bundle-relative).
  for (const t of opts.tasks) {
    if (typeof t.targetFile === 'string' && t.targetFile.startsWith(prefix)) {
      t.targetFile = t.targetFile.slice(prefix.length);
    }
  }
  const existing = new Set(
    opts.artifacts
      .filter((a) => typeof a.path === 'string' && a.path.startsWith(prefix))
      .map((a) => a.path.slice(prefix.length)),
  );
  // No pool view of the bundle (e.g. the RAC did not include it) — nothing
  // trustworthy to gate against; fall through rather than reject everything.
  if (existing.size === 0) return;

  const existingDirs = new Set(
    [...existing]
      .filter((p) => p.includes('/'))
      .map((p) => p.slice(0, p.indexOf('/') + 1)),
  );

  for (const t of opts.tasks) {
    if (existing.has(t.targetFile)) continue;
    const dir = t.targetFile.includes('/')
      ? t.targetFile.slice(0, t.targetFile.indexOf('/') + 1)
      : '';
    if (t.newFile === true && (dir === '' || existingDirs.has(dir))) continue;
    const hint = t.newFile === true
      ? `its directory "${dir}" is not part of the existing bundle layout (existing directories: ${[...existingDirs].join(', ') || '(bundle root only)'})`
      : `it does not exist in the bundle. Revise mode edits the on-disk bundle: copy targetFile ` +
        `VERBATIM from the bundle manifest paths, or set "newFile": true when the request genuinely adds a file`;
    throw new Error(
      `${opts.tag} refactor task "${t.id}" targets "${t.targetFile}" — ${hint}.`,
    );
  }
}
