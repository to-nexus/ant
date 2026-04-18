import { describe, it, expect } from 'vitest';
import { decideInvalidationScope } from '../../../src/agents/common/tool/handlers/invalidationScope';

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

  it('dependency manifests force installNeeded + all scope', () => {
    const decision = decideInvalidationScope('package.json');
    expect(decision.scope).toBe('all');
    expect(decision.installNeeded).toBe(true);

    expect(decideInvalidationScope('pnpm-lock.yaml').installNeeded).toBe(true);
    expect(decideInvalidationScope('go.mod').installNeeded).toBe(true);
    expect(decideInvalidationScope('Cargo.toml').installNeeded).toBe(true);
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

  it('F2a: dependencies-only diff → all + installNeeded', () => {
    const newPkg = { ...base, dependencies: { react: '^18.2.0' } };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('all');
    expect(decision.installNeeded).toBe(true);
  });

  it('F2b: devDependencies-only diff → test + installNeeded', () => {
    const newPkg = {
      ...base,
      devDependencies: { ...base.devDependencies, jsdom: '^26.0.0' },
    };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('test');
    expect(decision.installNeeded).toBe(true);
  });

  it('F2c: scripts diff → all', () => {
    const newPkg = { ...base, scripts: { build: 'tsc -p .' } };
    const decision = decideInvalidationScope('package.json', {
      oldContent: JSON.stringify(base),
      newContent: JSON.stringify(newPkg),
    });
    expect(decision.scope).toBe('all');
    expect(decision.installNeeded).toBe(true);
  });

  it('F2d: parse failure → conservative all', () => {
    const decision = decideInvalidationScope('package.json', {
      oldContent: '{not json',
      newContent: '{ also broken',
    });
    expect(decision.scope).toBe('all');
    expect(decision.installNeeded).toBe(true);
  });

  it('F2e: lockfile → build + installNeeded', () => {
    const decision = decideInvalidationScope('pnpm-lock.yaml', {
      oldContent: '# old',
      newContent: '# new',
    });
    expect(decision.scope).toBe('build');
    expect(decision.installNeeded).toBe(true);

    const pkgLock = decideInvalidationScope('package-lock.json', {
      oldContent: '{}',
      newContent: '{"x":1}',
    });
    expect(pkgLock.scope).toBe('build');
    expect(pkgLock.installNeeded).toBe(true);
  });

  it('F2f: diff omitted → conservative all (back-compat)', () => {
    const decision = decideInvalidationScope('package.json');
    expect(decision.scope).toBe('all');
    expect(decision.installNeeded).toBe(true);
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
    expect(decision.installNeeded).toBe(true);
  });
});
