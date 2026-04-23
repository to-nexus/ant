import { describe, it, expect } from 'vitest';
import {
  decideInvalidationScope,
  isDepManifestPath,
  DEP_MANIFEST_INSTALL_HINT,
} from '../../../src/agents/common/tool/handlers/invalidationScope';

describe('Axis C — decideInvalidationScope', () => {
  it('test files produce test-scope only', () => {
    expect(decideInvalidationScope('src/utils.test.ts').scope).toBe('test');
    expect(decideInvalidationScope('src/utils.spec.ts').scope).toBe('test');
    expect(decideInvalidationScope('__tests__/utils.ts').scope).toBe('test');
    expect(decideInvalidationScope('tests/foo.ts').scope).toBe('test');
    expect(decideInvalidationScope('e2e/smoke.ts').scope).toBe('test');
  });

  it('source .ts/.tsx invalidate everything', () => {
    expect(decideInvalidationScope('src/index.ts').scope).toBe('all');
    expect(decideInvalidationScope('src/App.tsx').scope).toBe('all');
    expect(decideInvalidationScope('src/util.js').scope).toBe('all');
  });

  it('static assets only invalidate build', () => {
    expect(decideInvalidationScope('src/styles.css').scope).toBe('build');
    expect(decideInvalidationScope('README.md').scope).toBe('build');
    expect(decideInvalidationScope('assets/logo.svg').scope).toBe('build');
  });

  it('dependency manifests produce all-scope (gate invalidation only)', () => {
    // F3 — install decision moved from manifest-edit propagation to direct
    // `areDepsInstalled` observation at the next plan entry. Manifest edits
    // still trigger gate invalidation; install-needed is not propagated here.
    expect(decideInvalidationScope('package.json').scope).toBe('all');
    expect(decideInvalidationScope('pnpm-lock.yaml').scope).toBe('build');
    expect(decideInvalidationScope('go.mod').scope).toBe('all');
    expect(decideInvalidationScope('Cargo.toml').scope).toBe('all');
  });

  it('unknown extensions default to all (conservative)', () => {
    expect(decideInvalidationScope('tsconfig.json').scope).toBe('all');
    expect(decideInvalidationScope('unknown.xyz').scope).toBe('all');
  });

  it('undefined path returns all with reason', () => {
    const decision = decideInvalidationScope(undefined);
    expect(decision.scope).toBe('all');
    expect(decision.reason).toMatch(/missing/i);
  });
});

describe('F2 — manifest diff-aware scope', () => {
  const base = {
    name: 'foo',
    version: '1.0.0',
    dependencies: { react: '^18.0.0' },
    devDependencies: { vitest: '^1.0.0', jsdom: '^27.0.0' },
    scripts: { build: 'tsc' },
  };

  it('F2a: dependencies-only diff → all scope', () => {
    const newPkg = { ...base, dependencies: { react: '^18.2.0' } };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('all');
  });

  it('F2b: devDependencies-only diff → test scope', () => {
    const newPkg = {
      ...base,
      devDependencies: { ...base.devDependencies, jsdom: '^26.0.0' },
    };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('test');
  });

  it('F2c: scripts diff → all', () => {
    const newPkg = { ...base, scripts: { build: 'tsc -p .' } };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('all');
  });

  it('F2d: parse failure → conservative all', () => {
    const decision = decideInvalidationScope('package.json', {
      oldContent: '{not json',
      newContent: '{ also broken',
    });
    expect(decision.scope).toBe('all');
  });

  it('F2e: lockfile → build scope', () => {
    const decision = decideInvalidationScope('pnpm-lock.yaml', {
      oldContent: '# old',
      newContent: '# new',
    });
    expect(decision.scope).toBe('build');

    const pkgLock = decideInvalidationScope('package-lock.json', {
      oldContent: '{}',
      newContent: '{"x":1}',
    });
    expect(pkgLock.scope).toBe('build');
  });

  it('F2f: diff omitted → conservative all (back-compat)', () => {
    const decision = decideInvalidationScope('package.json');
    expect(decision.scope).toBe('all');
  });

  it('F2g: package.json edit with identical content → test scope', () => {
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(base),
    });
    expect(decision.scope).toBe('test');
  });

  it('F2h: non-package.json manifest with diff → conservative all', () => {
    const decision = decideInvalidationScope('pyproject.toml', {
      oldContent: 'old = 1',
      newContent: 'old = 2',
    });
    expect(decision.scope).toBe('all');
  });
});

describe('A2 — isDepManifestPath (install hint trigger)', () => {
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
