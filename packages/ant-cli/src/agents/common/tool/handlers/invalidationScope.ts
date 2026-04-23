/**
 * invalidationScope — pure fs/path observations that drive two concerns:
 *
 *   1. Gate invalidation scope for an edited/created/deleted file
 *      (`decideInvalidationScope`). Narrowing is a cache optimisation;
 *      widening is safe correctness.
 *   2. Dependency install status observation (`areDepsInstalled` +
 *      `shouldSkipInstall`). Codebase itself (package.json vs
 *      node_modules/<name>) is the single source of truth — no hash cache.
 *
 * Both concerns are pure module-level helpers with no LangGraph state
 * dependencies; task-type layers consume them via their own hooks.
 */

import * as path from 'path';
import * as fs from 'fs';
import semver from 'semver';
import type { InvalidationScope } from '../types';

const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)__tests__\//i,
  /(^|\/)tests?\//i,
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /(^|\/)e2e\//i,
  /(^|\/)cypress\//i,
  /(^|\/)playwright\//i,
];

const BUILD_ONLY_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.pcss',
  '.html', '.htm', '.md', '.mdx',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.ogg',
  '.yml', '.yaml', '.toml',
]);

const DEP_MANIFEST_BASENAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'go.mod',
  'go.sum',
  'cargo.toml',
  'cargo.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'pipfile',
  'pipfile.lock',
  'gemfile',
  'gemfile.lock',
]);

export interface InvalidationDecision {
  scope: InvalidationScope;
  /** Why this scope was chosen (human readable, for logs/tests) */
  reason: string;
}

function lastSegment(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || '';
}

/**
 * Does this path point to a dependency manifest (package.json / go.mod /
 * Cargo.toml / pyproject.toml / Gemfile / lockfiles)? Used by file-write
 * tool handlers to surface an "install required" action hint in the tool
 * result — so the same turn that edited the manifest must run the package
 * manager install before outputting `<done>`.
 *
 * Exposed as `isDepManifestPath` for handlers; internal scope logic keeps
 * consuming `DEP_MANIFEST_BASENAMES` directly.
 */
export function isDepManifestPath(rawPath: string | undefined): boolean {
  if (!rawPath) return false;
  const normalized = rawPath.replace(/^\.\/+/, '').toLowerCase();
  const base = lastSegment(normalized);
  return DEP_MANIFEST_BASENAMES.has(base);
}

/**
 * Canonical action hint appended to the tool result when a dependency
 * manifest is edited / created / deleted. The hint is deliberately phrased
 * as a hard rule so the LLM treats the next action as install, not done.
 *
 * Complementary to the `missing-dependency-fix` prompt injection (which is
 * static, attached at buildMessages time) — this hint fires at the exact
 * moment the manifest is touched, giving the LLM an in-the-flow directive
 * right where the relevant tool call just completed.
 */
export const DEP_MANIFEST_INSTALL_HINT =
  '\n\n⚠️ Dependency manifest modified. You MUST run the package-manager install command (e.g. `npm install`, `pnpm install`, `yarn install`, `go mod tidy`, `cargo fetch`, `pip install -r requirements.txt`, `poetry install` — match the project lockfile) BEFORE outputting `<done>`. Skipping install leaves declared deps unresolved and the subsequent build/test gate will fail with the same "module not found" error.';

function extension(base: string): string {
  const idx = base.lastIndexOf('.');
  return idx < 0 ? '' : base.substring(idx).toLowerCase();
}

/**
 * Are all declared JS deps present in `codebase/node_modules/` AND (for
 * semver-range specs) does the installed version satisfy the spec?
 *
 * Returns `true` when every `dependencies ∪ devDependencies` entry resolves
 * and its version (when declared as a semver range) satisfies the spec.
 * Returns `false` when any dep is missing or its installed version fails
 * `semver.satisfies`. Returns `null` when package.json is absent/unreadable.
 *
 * Non-range specs (git, file:, workspace:*, link:, npm tags) fall back to
 * existence-only — resolving those accurately needs the lockfile, which is
 * outside this module's SSOT. `peerDependencies` / `optionalDependencies`
 * are excluded. Yarn PnP is not covered.
 */
export async function areDepsInstalled(featureRootPath: string): Promise<boolean | null> {
  const codebasePath = path.join(featureRootPath, 'codebase');
  const pkgPath = path.join(codebasePath, 'package.json');
  let pkg: any;
  try {
    pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
  } catch {
    return null;
  }

  const required: Record<string, string> = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const names = Object.keys(required);
  if (names.length === 0) return true;

  for (const name of names) {
    const modPath = path.join(codebasePath, 'node_modules', ...name.split('/'));
    try {
      await fs.promises.stat(modPath);
    } catch {
      return false;
    }

    const spec = required[name];
    if (!spec || !isSemverRangeSpec(spec)) continue;

    let installedVersion: string | undefined;
    try {
      const depPkg = JSON.parse(
        await fs.promises.readFile(path.join(modPath, 'package.json'), 'utf-8'),
      );
      installedVersion = typeof depPkg.version === 'string' ? depPkg.version : undefined;
    } catch {
      // Missing/unreadable dep package.json → treat as version-unknown.
      continue;
    }
    if (!installedVersion) continue;

    if (!semver.satisfies(installedVersion, spec, { includePrerelease: true })) {
      return false;
    }
  }
  return true;
}

/** True iff the spec is a semver range (version check is meaningful). */
function isSemverRangeSpec(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (/^(?:git|git\+|https?:|file:|link:|workspace:|npm:|portal:|patch:)/.test(s)) return false;
  if (/^(?:\.?\.\/|\/)/.test(s)) return false;
  return semver.validRange(s, { includePrerelease: true }) !== null;
}

/**
 * Install-skip decision used by the `runCommand` bare-install guard. The
 * single source of truth is `areDepsInstalled` — the codebase (package.json
 * vs node_modules/<name>) is the witness, so no hash cache is needed.
 *
 * Returns:
 *   - `null`    — install MUST run (at least one declared dep is missing,
 *                 or the observation could not be made).
 *   - `string`  — install can be skipped; the string is a human-readable
 *                 reason surfaced to the LLM.
 */
export async function shouldSkipInstall(featureRootPath: string): Promise<string | null> {
  const installed = await areDepsInstalled(featureRootPath);
  if (installed === true) {
    return 'Dependencies are already installed. All declared package.json dependencies resolve under node_modules/. Proceed directly to build/test verification commands.';
  }
  return null;
}

/**
 * F2 — content diff for a manifest edit. Allows `decideInvalidationScope` to
 * narrow the invalidation scope based on which JSON fields actually changed.
 * When `oldContent` is `undefined`, the manifest is treated as newly created
 * (diff unavailable → conservative fallback).
 */
export interface ManifestDiff {
  oldContent?: string;
  newContent: string;
}

/**
 * Decide the invalidation scope for a single file write/delete.
 *
 * Principle: when the caller can supply a content diff for a dependency
 * manifest, this function narrows the scope to the gates logically affected
 * by the changed fields. Without a diff, the decision falls back to the
 * conservative `'all'` scope as before.
 */
export function decideInvalidationScope(
  rawPath: string | undefined,
  diff?: ManifestDiff,
): InvalidationDecision {
  if (!rawPath) return { scope: 'all', reason: 'missing path' };
  const normalized = rawPath.replace(/^\.\/+/, '').toLowerCase();
  const base = lastSegment(normalized);

  if (DEP_MANIFEST_BASENAMES.has(base)) {
    return decideManifestScope(base, diff);
  }

  if (TEST_PATH_PATTERNS.some(p => p.test(normalized))) {
    return { scope: 'test', reason: 'test file' };
  }

  const ext = extension(base);
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    return { scope: 'all', reason: `source code: ${ext}` };
  }

  if (BUILD_ONLY_EXTENSIONS.has(ext)) {
    return { scope: 'build', reason: `non-source asset: ${ext}` };
  }

  // config/tsconfig/etc. → 'all' conservatively
  return { scope: 'all', reason: `unknown: ${ext || 'no-ext'}` };
}

function isLockfile(base: string): boolean {
  return (
    base.endsWith('.lock') ||
    base.endsWith('-lock.yaml') ||
    base.endsWith('-lock.json') ||
    base === 'yarn.lock' ||
    base === 'cargo.lock' ||
    base === 'poetry.lock' ||
    base === 'pipfile.lock' ||
    base === 'gemfile.lock' ||
    base === 'bun.lockb' ||
    base === 'bun.lock' ||
    base === 'go.sum'
  );
}

/**
 * Route a dependency manifest edit to a fine-grained scope based on its diff.
 * Unknown manifest formats fall through to the conservative `'all'` scope.
 *
 * Install-needed propagation was removed (F3 — observation-based SSOT): the
 * next plan entry calls `areDepsInstalled` directly, so a stale scope signal
 * here cannot mislead the install decision. Scope selection still narrows
 * gate invalidation (e.g. a devDependencies-only edit only resets the `test`
 * gate, preserving cached typecheck/build passes).
 */
function decideManifestScope(base: string, diff?: ManifestDiff): InvalidationDecision {
  // Lockfiles are regenerated from their source manifest; source changes are
  // already covered by the package.json path. Treat lockfile-only edits as
  // affecting build/runtime linkage but preserving typecheck cache.
  if (isLockfile(base)) {
    return { scope: 'build', reason: `lockfile: ${base}` };
  }

  if (!diff || diff.oldContent === undefined) {
    // New manifest OR no diff supplied: behave as before.
    return { scope: 'all', reason: `dep manifest (no diff): ${base}` };
  }

  if (base === 'package.json') {
    return decidePackageJsonScope(diff);
  }

  // Other manifests (pyproject.toml, Cargo.toml, go.mod, …) are not parsed yet.
  return { scope: 'all', reason: `dep manifest: ${base}` };
}

function decidePackageJsonScope(diff: ManifestDiff): InvalidationDecision {
  let oldPkg: Record<string, unknown>;
  let newPkg: Record<string, unknown>;
  try {
    oldPkg = JSON.parse(diff.oldContent!) as Record<string, unknown>;
    newPkg = JSON.parse(diff.newContent) as Record<string, unknown>;
  } catch {
    return { scope: 'all', reason: 'package.json parse failed' };
  }

  const changedFields = new Set<string>();
  const allKeys = new Set<string>([...Object.keys(oldPkg), ...Object.keys(newPkg)]);
  for (const k of allKeys) {
    if (JSON.stringify(oldPkg[k]) !== JSON.stringify(newPkg[k])) changedFields.add(k);
  }

  if (changedFields.size === 0) {
    return { scope: 'test', reason: 'package.json edit (no field change)' };
  }

  // devDependencies alone → test tooling scope (jest/vitest/jsdom/etc.).
  const onlyDev = changedFields.size === 1 && changedFields.has('devDependencies');
  if (onlyDev) {
    return { scope: 'test', reason: 'package.json devDependencies only' };
  }

  // Any runtime dep change → full invalidation (import graph may shift).
  if (
    changedFields.has('dependencies') ||
    changedFields.has('peerDependencies') ||
    changedFields.has('optionalDependencies')
  ) {
    return {
      scope: 'all',
      reason: `package.json ${[...changedFields].sort().join('+')}`,
    };
  }

  // scripts / engines / type / exports / packageManager / workspaces / etc.
  return {
    scope: 'all',
    reason: `package.json fields: ${[...changedFields].sort().join(',')}`,
  };
}
