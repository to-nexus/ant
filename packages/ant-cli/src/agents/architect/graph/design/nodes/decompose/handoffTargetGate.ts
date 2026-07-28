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
  /** Refactor merge-then-delete: bundle-relative paths this task removes. */
  removeFiles?: string[];
}

/**
 * Guide-doc candidate stems for the entry-doc singularity invariant.
 * Prose twin (consumer-side reading heuristic):
 * jobs/code/base/injections/game-art-source-handoff.md — different consumer,
 * different altitude; this constant gates WRITING, that prose gates reading.
 */
export const HANDOFF_GUIDE_STEMS = ['readme', 'design', 'index', 'guide', 'manifest', 'overview'];

/** Markdown files whose basename stem matches a guide candidate (dc.html specimens never count). */
export function isGuideDoc(bundleRelativePath: string): boolean {
  const base = bundleRelativePath.slice(bundleRelativePath.lastIndexOf('/') + 1).toLowerCase();
  if (!base.endsWith('.md')) return false;
  const stem = base.slice(0, -3);
  return HANDOFF_GUIDE_STEMS.includes(stem);
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
    if (Array.isArray(t.removeFiles)) {
      t.removeFiles = t.removeFiles.map((rf) =>
        typeof rf === 'string' && rf.startsWith(prefix) ? rf.slice(prefix.length) : rf,
      );
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

  // Structural-revision invariants: removal targets + entry-doc singularity.
  // Fail-open when the bundle has no recognizable guide doc — stem detection
  // must not reject bundles with unconventional guide names.
  const guideDocs = [...existing].filter(isGuideDoc);
  for (const t of opts.tasks) {
    for (const rf of t.removeFiles ?? []) {
      if (!existing.has(rf)) {
        throw new Error(
          `${opts.tag} refactor task "${t.id}" removeFiles entry "${rf}" does not exist in the bundle — ` +
          `copy removal paths VERBATIM from the manifest (bundle-relative, prefix stripped).`,
        );
      }
      if (rf === t.targetFile) {
        throw new Error(
          `${opts.tag} refactor task "${t.id}" lists its own targetFile in removeFiles — a removal rides ` +
          `the SURVIVING file's task: target the survivor and remove the superseded duplicate.`,
        );
      }
    }
    if (t.newFile === true && isGuideDoc(t.targetFile) && guideDocs.length > 0) {
      throw new Error(
        `${opts.tag} refactor task "${t.id}" creates a second guide "${t.targetFile}" — the bundle already ` +
        `has an entry doc (${guideDocs.join(', ')}). Revise or merge into the existing entry doc instead.`,
      );
    }
  }
  if (guideDocs.length > 0) {
    const removesAllGuides = guideDocs.every((g) => opts.tasks.some((t) => t.removeFiles?.includes(g)));
    const guideSurvives = opts.tasks.some(
      (t) => isGuideDoc(t.targetFile) && !opts.tasks.some((o) => o.removeFiles?.includes(t.targetFile)),
    );
    if (removesAllGuides && !guideSurvives) {
      throw new Error(
        `${opts.tag} the decomposition removes every guide doc (${guideDocs.join(', ')}) without any task ` +
        `owning a surviving entry doc — exactly one structure guide must remain after the revision.`,
      );
    }
  }
}
