import { describe, it, expect } from 'vitest';
import { decideInvalidationScope } from '../../src/agents/common/tool/handlers/invalidationScope';

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
