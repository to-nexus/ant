/**
 * Axis C — derive the verification-invalidation scope from a modified/created/deleted
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
 * Axis A — derive the install-needed decision from dep manifest state.
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
 * Decide the invalidation scope for a single file write/delete.
 */
export function decideInvalidationScope(rawPath: string | undefined): InvalidationDecision {
  if (!rawPath) return { scope: 'all', reason: 'missing path' };
  const normalized = rawPath.replace(/^\.\/+/, '').toLowerCase();
  const base = lastSegment(normalized);

  if (DEP_MANIFEST_BASENAMES.has(base)) {
    return { scope: 'all', installNeeded: true, reason: `dep manifest: ${base}` };
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
