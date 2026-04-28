#!/usr/bin/env node
// scripts/migrate-workspace-layout.mjs
// One-shot, idempotent migration that lifts a feature's I/O-keyed tree
// (inputs/, outputs/) into the domain-keyed tree
// (plan/, architecture/, visual/, assets/, meta/).
//
// Usage:
//   pnpm migrate:workspace                              # dry-run, default workspaces path
//   pnpm migrate:workspace --workspaces-path <abs>      # dry-run, explicit root
//   pnpm migrate:workspace --apply                      # actually move files
//   pnpm migrate:workspace --apply --workspaces-path <abs>
//
// Safety:
//   - Idempotent: re-running on a migrated workspace is a noop.
//   - Conservative: codebase/ (git worktree), sessions/ are never touched.
//   - Dry-run by default: prints intended fs ops, performs none.
//   - Exits 1 on collision (dst exists AND src exists). User must resolve.

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const APPLY = process.argv.includes('--apply');
const ROOT_FLAG = process.argv.indexOf('--workspaces-path');
const ROOT_ARG = ROOT_FLAG >= 0 ? process.argv[ROOT_FLAG + 1] : undefined;

const WORKSPACES_ROOT = path.resolve(
  ROOT_ARG ??
  process.env.ANT_WORKSPACE_BASE_PATH ??
  path.join(os.homedir(), 'Library/Application Support/ant/workspaces'),
);

const MAPPINGS = [
  // mode: 'rename-dir'  — atomic rename if src exists and dst absent
  // mode: 'merge-files' — move direct children files (not subdirs) src → dst
  // mode: 'move-file'   — move a single file src → dst (creates parent dir)
  ['inputs/sources',          'plan',                          { mode: 'merge-files' }],
  ['inputs/directives',       'meta/directives',               { mode: 'rename-dir' }],
  ['inputs/assets',           'assets',                        { mode: 'rename-dir' }],
  ['inputs/references',       '.legacy-references',            { mode: 'rename-dir' }], // backup; code removed
  ['inputs/figma.json',       'visual/ui/figma/figma.json',    { mode: 'move-file' }],
  ['outputs/design/system',   'architecture/system',           { mode: 'rename-dir' }],
  ['outputs/design/spec',     'architecture/spec',             { mode: 'rename-dir' }],
  ['outputs/design/ui',       'visual/ui',                     { mode: 'rename-dir' }],
  ['outputs/design/game-art', 'visual/game-art',               { mode: 'rename-dir' }],
  ['outputs/plan',            'plan',                          { mode: 'merge-files' }],
  ['outputs/evals',           'meta/evals',                    { mode: 'rename-dir' }],
];

let collisions = 0;

const main = async () => {
  console.log(`[migrate] mode = ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[migrate] workspacesPath = ${WORKSPACES_ROOT}`);
  if (!fsSync.existsSync(WORKSPACES_ROOT)) {
    console.log('[migrate] workspaces root does not exist — nothing to do.');
    return;
  }

  const orgs = await fs.readdir(WORKSPACES_ROOT);
  for (const org of orgs) {
    const orgDir = path.join(WORKSPACES_ROOT, org);
    if (!(await stat(orgDir))?.isDirectory()) continue;
    const users = await fs.readdir(orgDir).catch(() => []);
    for (const user of users) {
      const userDir = path.join(orgDir, user);
      if (!(await stat(userDir))?.isDirectory()) continue;
      const projects = await fs.readdir(userDir).catch(() => []);
      for (const project of projects) {
        const projectDir = path.join(userDir, project);
        const featuresDir = path.join(projectDir, 'features');
        if (!(await stat(featuresDir))?.isDirectory()) continue;
        const features = await fs.readdir(featuresDir).catch(() => []);
        for (const feature of features) {
          const featureDir = path.join(featuresDir, feature);
          if (!(await stat(featureDir))?.isDirectory()) continue;
          await migrateFeature(featureDir);
        }
      }
    }
  }

  if (collisions > 0) {
    console.error(`[migrate] ${collisions} collision(s) detected. Resolve manually and re-run.`);
    process.exit(1);
  }
  console.log(`[migrate] done.${APPLY ? '' : ' (dry-run — pass --apply to execute)'}`);
};

const stat = async (p) => fs.stat(p).catch(() => null);

const isGitWorktree = async (dir) => {
  const gitFile = path.join(dir, '.git');
  return !!(await stat(gitFile));
};

/**
 * True iff the directory contains no regular files anywhere in the tree.
 * Empty subdirectories are tolerated — `ensureCanonicalStructure` creates
 * deeply-nested canonical shells (e.g. `meta/directives/{design,code,...}`)
 * that hold no user data and may be absorbed safely.
 */
const isRecursivelyEmptyDir = async (dir) => {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isFile() || e.isSymbolicLink()) return false;
    if (e.isDirectory()) {
      const subEmpty = await isRecursivelyEmptyDir(path.join(dir, e.name));
      if (!subEmpty) return false;
    }
  }
  return true;
};

/**
 * Returns true iff the destination is the canonical figma.json placeholder
 * emitted by `ensureCanonicalStructure` — i.e. the file at
 * `visual/ui/figma/figma.json` containing the empty figma data shape
 * (`{ "url": "" }` style). Hand-edited figma.json files MUST NOT be
 * overwritten — the user's data wins.
 */
const isCanonicalPlaceholderFigmaJson = async (absPath, relTo) => {
  if (relTo !== 'visual/ui/figma/figma.json') return false;
  try {
    const content = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return false;
    // Empty placeholder: every value is the empty string OR the object
    // has no entries at all. Any non-empty url / fileKey / nodeId means
    // the user populated it.
    const values = Object.values(parsed);
    if (values.length === 0) return true;
    return values.every(v => v === '' || v === null || v === undefined);
  } catch {
    return false;
  }
};

const migrateFeature = async (featureDir) => {
  const codebase = path.join(featureDir, 'codebase');
  if ((await stat(codebase))?.isDirectory() && (await isGitWorktree(codebase))) {
    // Worktree — skip touching codebase entirely (we never migrate inside it).
  }

  for (const [from, to, opts] of MAPPINGS) {
    const src = path.join(featureDir, from);
    const dst = path.join(featureDir, to);
    const srcExists = !!(await stat(src));
    const dstExists = !!(await stat(dst));

    if (!srcExists) continue;

    if (opts.mode === 'rename-dir') {
      if (dstExists) {
        // `ensureCanonicalStructure` (boot-time reconciliation) eagerly
        // creates every canonical directory and its full subtree as
        // empty shells (e.g. `meta/directives/{design,code,...}`).
        // Such recursively-empty shells are NOT a collision — absorb
        // them by removing the dst before renaming the legacy src
        // into place. Only directories holding actual user data
        // count as a real collision.
        if (await isRecursivelyEmptyDir(dst)) {
          console.log(`[migrate] absorb-empty ${rel(featureDir, dst)} (empty shell)`);
          if (APPLY) await fs.rm(dst, { recursive: true, force: true });
        } else {
          // Conservative: do not merge non-empty directories. Report and skip.
          console.error(`[migrate] COLLISION: ${rel(featureDir, src)} and ${rel(featureDir, dst)} both exist. Skipping.`);
          collisions += 1;
          continue;
        }
      }
      console.log(`[migrate] rename-dir  ${rel(featureDir, src)} → ${rel(featureDir, dst)}`);
      if (APPLY) {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.rename(src, dst);
      }
    } else if (opts.mode === 'move-file') {
      if (dstExists) {
        // Single-file move: only absorb a known canonical placeholder
        // (e.g. the figma.json template emitted by
        // `ensureCanonicalStructure`). Otherwise the dst was hand-edited
        // and we must not overwrite it.
        if (await isCanonicalPlaceholderFigmaJson(dst, to)) {
          console.log(`[migrate] absorb-empty ${rel(featureDir, dst)} (canonical placeholder)`);
          if (APPLY) await fs.unlink(dst).catch(() => {});
        } else {
          console.error(`[migrate] COLLISION (file): ${rel(featureDir, src)} → ${rel(featureDir, dst)} (dst exists). Skipping.`);
          collisions += 1;
          continue;
        }
      }
      console.log(`[migrate] move-file   ${rel(featureDir, src)} → ${rel(featureDir, dst)}`);
      if (APPLY) {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.rename(src, dst);
      }
    } else if (opts.mode === 'merge-files') {
      const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
      const files = entries.filter(e => e.isFile());
      if (files.length === 0) {
        console.log(`[migrate] noop        ${rel(featureDir, src)} (empty)`);
        // Even with nothing to merge, drop the empty src so subsequent
        // boots won't trigger the legacy-tree guard on a hollow shell.
        if (entries.length === 0 && APPLY) {
          await fs.rmdir(src).catch(() => {});
        }
        continue;
      }
      console.log(`[migrate] merge-files ${rel(featureDir, src)}/* → ${rel(featureDir, dst)}/`);
      if (APPLY) await fs.mkdir(dst, { recursive: true });
      for (const f of files) {
        const fSrc = path.join(src, f.name);
        const fDst = path.join(dst, f.name);
        if (await stat(fDst)) {
          console.error(`[migrate] COLLISION (file): ${rel(featureDir, fDst)} exists; will not overwrite ${rel(featureDir, fSrc)}.`);
          collisions += 1;
          continue;
        }
        if (APPLY) await fs.rename(fSrc, fDst);
      }
      // Try to remove src if empty (preserves subdirs that were not direct files).
      const remaining = (await fs.readdir(src).catch(() => []));
      if (remaining.length === 0 && APPLY) {
        await fs.rmdir(src).catch(() => {});
      }
    }
  }

  // Cleanup empty inputs/ outputs/ shells. Skip the residue warning in
  // dry-run mode — nothing has actually moved, so any non-empty `inputs/`
  // / `outputs/` directory is expected and reporting it is misleading.
  for (const top of ['inputs', 'outputs']) {
    const topDir = path.join(featureDir, top);
    const entries = (await fs.readdir(topDir).catch(() => null));
    if (entries && entries.length === 0) {
      console.log(`[migrate] rmdir       ${rel(featureDir, topDir)} (empty)`);
      if (APPLY) await fs.rmdir(topDir).catch(() => {});
    } else if (APPLY && entries && entries.length > 0) {
      console.log(`[migrate] residue     ${rel(featureDir, topDir)} not empty (review manually): ${entries.join(', ')}`);
    }
  }
};

const rel = (base, p) => path.relative(base, p);

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(2);
});
