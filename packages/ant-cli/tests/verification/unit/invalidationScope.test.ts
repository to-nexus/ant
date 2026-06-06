import { describe, it, expect } from 'vitest';
import {
  isDepManifestPath,
  DEP_MANIFEST_INSTALL_HINT,
} from '../../../src/agents/common/tool/handlers/invalidationScope';

// Gate-invalidation scope (`decideInvalidationScope` + the `InvalidationScope`
// type + `verificationInvalidated` side-effect) was retired with the gate-state
// Session: the LLM is the sole judge of when a verification gate needs
// re-running (see the verify-mode `gate-validity-principle` prompt partial).
// What remains in this module is install-status observation only.

describe('isDepManifestPath (install hint trigger)', () => {
  it('recognises JS manifests and lockfiles', () => {
    expect(isDepManifestPath('package.json')).toBe(true);
    expect(isDepManifestPath('pnpm-lock.yaml')).toBe(true);
    expect(isDepManifestPath('yarn.lock')).toBe(true);
    expect(isDepManifestPath('package-lock.json')).toBe(true);
    expect(isDepManifestPath('bun.lockb')).toBe(true);
  });

  it('recognises polyglot manifests', () => {
    expect(isDepManifestPath('go.mod')).toBe(true);
    expect(isDepManifestPath('Cargo.toml')).toBe(true);
    expect(isDepManifestPath('pyproject.toml')).toBe(true);
    expect(isDepManifestPath('Gemfile')).toBe(true);
    expect(isDepManifestPath('poetry.lock')).toBe(true);
  });

  it('accepts nested and leading-dot-slash paths', () => {
    expect(isDepManifestPath('./package.json')).toBe(true);
    expect(isDepManifestPath('codebase/package.json')).toBe(true);
    expect(isDepManifestPath('apps/web/package.json')).toBe(true);
  });

  it('rejects non-manifest files', () => {
    expect(isDepManifestPath('src/index.ts')).toBe(false);
    expect(isDepManifestPath('tsconfig.json')).toBe(false);
    expect(isDepManifestPath('README.md')).toBe(false);
    expect(isDepManifestPath('my.package.json.bak')).toBe(false);
  });

  it('handles undefined / empty', () => {
    expect(isDepManifestPath(undefined)).toBe(false);
    expect(isDepManifestPath('')).toBe(false);
  });

  it('DEP_MANIFEST_INSTALL_HINT mentions install command + before done', () => {
    expect(DEP_MANIFEST_INSTALL_HINT).toMatch(/install/i);
    expect(DEP_MANIFEST_INSTALL_HINT).toMatch(/<done>/);
  });
});
