/**
 * invalidationScope — derive the verification-invalidation scope from a modified/created/deleted
 * file path. This lets the tracker retain already-passed steps when the edit cannot
 * logically affect them (e.g. touching a *.test.ts file should not invalidate typecheck
 * or build — only tests need to be re-run).
 *
 * Principle: fall back to `'all'` when the signal is ambiguous. Narrowing is a cache
 * optimization; widening is safe correctness.
 */

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
  /** Dependency manifest touched — caller should force a fresh install */
  installNeeded?: boolean;
  /** Why this scope was chosen (human readable, for logs/tests) */
  reason: string;
}

function lastSegment(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || '';
}

function extension(base: string): string {
  const idx = base.lastIndexOf('.');
  return idx < 0 ? '' : base.substring(idx).toLowerCase();
}

/**
 * Derive the install-needed decision from dep manifest state.
 * Pure function: enables deterministic unit tests without filesystem.
 *
 *   savedHash absent AND node_modules exists AND we can hash the manifests
 *   → adopt current hash as baseline (no install). Fixes "parallel worker
 *   without shared state re-installs every verification task" case.
 *
 *   otherwise → installNeeded iff (no savedHash) OR (hash mismatch) OR (no deps).
 */
export interface InstallDecision {
  installNeeded: boolean;
  adoptedHash?: string;
  reason: string;
}

export function deriveInstallDecision(
  savedHash: string | undefined,
  currentHash: string | null,
  depsExist: boolean,
): InstallDecision {
  if (!savedHash && depsExist && currentHash) {
    return {
      installNeeded: false,
      adoptedHash: currentHash,
      reason: 'inferred-installed (no saved hash, node_modules present, manifest hashable)',
    };
  }
  if (!savedHash) {
    return { installNeeded: true, reason: 'no saved hash' };
  }
  if (!depsExist) {
    return { installNeeded: true, reason: 'node_modules missing' };
  }
  if (savedHash !== currentHash) {
    return { installNeeded: true, reason: 'manifest hash changed' };
  }
  return { installNeeded: false, reason: 'cached' };
}

/**
 * Unified install-skip decision shared between the plan-node
 * `recomputeInstallNeeded` path and the `runCommand` bare-install guard.
 *
 * Returns `null` when the install MUST run (no skip). Returns a skip reason
 * string when the install can be short-circuited because the dependency
 * declaration files have not changed since the last successful install.
 *
 * The decision is derived from `deriveInstallDecision` so both call sites
 * agree on the cache rules — previously these were two independent
 * implementations with a subtle "first-time install" asymmetry.
 */
export function shouldSkipInstall(
  savedHash: string | undefined,
  currentHash: string | null,
  depsExist: boolean,
): string | null {
  if (!savedHash) return null;
  if (!depsExist) return null;
  if (!currentHash) return null;
  if (savedHash !== currentHash) return null;
  return 'Dependencies are up to date. Dependency declaration files have not changed since the last successful install. Proceed directly to build/test verification commands.';
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
 */
function decideManifestScope(base: string, diff?: ManifestDiff): InvalidationDecision {
  // Lockfiles are regenerated from their source manifest; source changes are
  // already covered by the package.json path. Treat lockfile-only edits as
  // affecting build/runtime linkage but preserving typecheck cache.
  if (isLockfile(base)) {
    return { scope: 'build', installNeeded: true, reason: `lockfile: ${base}` };
  }

  if (!diff || diff.oldContent === undefined) {
    // New manifest OR no diff supplied: behave as before.
    return { scope: 'all', installNeeded: true, reason: `dep manifest (no diff): ${base}` };
  }

  if (base === 'package.json') {
    return decidePackageJsonScope(diff);
  }

  // Other manifests (pyproject.toml, Cargo.toml, go.mod, …) are not parsed yet.
  return { scope: 'all', installNeeded: true, reason: `dep manifest: ${base}` };
}

function decidePackageJsonScope(diff: ManifestDiff): InvalidationDecision {
  let oldPkg: Record<string, unknown>;
  let newPkg: Record<string, unknown>;
  try {
    oldPkg = JSON.parse(diff.oldContent!) as Record<string, unknown>;
    newPkg = JSON.parse(diff.newContent) as Record<string, unknown>;
  } catch {
    return { scope: 'all', installNeeded: true, reason: 'package.json parse failed' };
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
    return { scope: 'test', installNeeded: true, reason: 'package.json devDependencies only' };
  }

  // Any runtime dep change → full invalidation (import graph may shift).
  if (
    changedFields.has('dependencies') ||
    changedFields.has('peerDependencies') ||
    changedFields.has('optionalDependencies')
  ) {
    return {
      scope: 'all',
      installNeeded: true,
      reason: `package.json ${[...changedFields].sort().join('+')}`,
    };
  }

  // scripts / engines / type / exports / packageManager / workspaces / etc.
  return {
    scope: 'all',
    installNeeded: true,
    reason: `package.json fields: ${[...changedFields].sort().join(',')}`,
  };
}
