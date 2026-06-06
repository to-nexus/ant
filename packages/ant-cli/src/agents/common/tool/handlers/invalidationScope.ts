/**
 * installStatus — pure fs/path observations for dependency install status.
 *
 *   - `areDepsInstalled` + `shouldSkipInstall`: is every declared JS dep
 *     present (and version-satisfied) under the codebase's node_modules? The
 *     codebase itself (package.json vs node_modules/<name>) is the single
 *     source of truth — no hash cache.
 *   - `isDepManifestPath` + `DEP_MANIFEST_INSTALL_HINT`: a file-write tool hint
 *     surfaced when a dependency manifest is touched, so the same turn runs the
 *     package-manager install before `<done>`.
 *
 * (Gate-invalidation scope logic was retired with the gate-state Session — the
 * LLM is the sole judge of when a verification gate needs re-running; see the
 * verify-mode `gate-validity-principle` prompt partial.)
 *
 * All helpers are pure module-level functions with no LangGraph state.
 */

import * as path from 'path';
import * as fs from 'fs';
import semver from 'semver';
import { enumeratePackageJsonManifests, resolveModulePath } from './workspaceDepPins';

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

/**
 * Are all declared JS deps present in `codebase/node_modules/` AND (for
 * semver-range specs) does the installed version satisfy the spec?
 *
 * Workspace-aware — scans every `package.json` under the codebase via the
 * shared `enumeratePackageJsonManifests` walker (same SSOT as
 * `workspaceDepPins`), takes the union of every member's
 * `dependencies ∪ devDependencies` (first-seen spec wins), and resolves
 * each via `resolveModulePath` (manifest-local-first → root-fallback) so
 * pnpm symlinks, yarn-classic nested, and npm 7+ hoisted layouts all
 * resolve.
 *
 * Returns `true` when every union entry resolves and its version (when
 * declared as a semver range) satisfies the spec. Returns `false` when any
 * dep is missing or its installed version fails `semver.satisfies`.
 * Returns `null` when the codebase has no `package.json` at all (non-JS
 * project) or the codebase directory is unreadable.
 *
 * Non-range specs (git, file:, workspace:*, link:, npm tags) fall back to
 * existence-only — resolving those accurately needs the lockfile, which is
 * outside this module's SSOT. `peerDependencies` / `optionalDependencies`
 * are excluded (install-responsibility domain — see
 * `dep-self-contained.md`). Yarn PnP is not covered.
 */
export async function areDepsInstalled(featureRootPath: string): Promise<boolean | null> {
  const codebasePath = path.join(featureRootPath, 'codebase');

  const manifests = await enumeratePackageJsonManifests(codebasePath);
  if (manifests.length === 0) return null;

  let hasParseError = false;
  // Per (name × declaringDir) instead of first-seen-wins: when the same
  // library is declared by two members, each member is a separate import
  // surface and must resolve independently (one member having it installed
  // does NOT prove the other does).
  const declarations: Array<{ name: string; spec: string; declaringDir: string }> = [];
  for (const absManifestPath of manifests) {
    let pkg: any;
    try {
      pkg = JSON.parse(await fs.promises.readFile(absManifestPath, 'utf-8'));
    } catch {
      hasParseError = true;
      continue;
    }
    const merged: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const declaringDir = path.dirname(absManifestPath);
    for (const [name, spec] of Object.entries(merged)) {
      declarations.push({ name, spec, declaringDir });
    }
  }

  // No declared deps anywhere: when every manifest failed to parse, treat
  // as unknown (preserves the legacy "malformed package.json → null"
  // contract). When at least one parsed cleanly with zero deps, the
  // codebase is genuinely zero-dep → true.
  if (declarations.length === 0) return hasParseError ? null : true;

  for (const { name, spec, declaringDir } of declarations) {
    const modPath = await resolveModulePath(codebasePath, name, declaringDir);
    if (!modPath) return false;

    if (!spec || !isSemverRangeSpec(spec)) continue;

    let installedVersion: string | undefined;
    try {
      const depPkg = JSON.parse(
        await fs.promises.readFile(path.join(modPath, 'package.json'), 'utf-8'),
      );
      installedVersion = typeof depPkg.version === 'string' ? depPkg.version : undefined;
    } catch {
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
