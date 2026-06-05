import { describe, expect, it } from 'vitest';

import {
  capTestRunnerConcurrency,
  resolveTestMaxWorkers,
  buildSpawnEnv,
} from '../../src/agents/common/tool/handlers/commandResourceLimits';

// Regression guard for the `level-housing-kneel` worker_stalled incident:
// an unbounded multi-package `vitest run` must be concurrency-capped at the
// command-execution boundary, and the spawn env must carry the resource guards.

describe('capTestRunnerConcurrency', () => {
  it('appends --maxWorkers to a direct vitest invocation', () => {
    expect(capTestRunnerConcurrency('vitest run', 2)).toBe('vitest run --maxWorkers=2');
    expect(capTestRunnerConcurrency('vitest', 3)).toBe('vitest --maxWorkers=3');
    expect(capTestRunnerConcurrency('npx vitest run', 2)).toBe('npx vitest run --maxWorkers=2');
    expect(capTestRunnerConcurrency('jest', 2)).toBe('jest --maxWorkers=2');
  });

  it('forwards --maxWorkers after -- for package-manager wrappers', () => {
    expect(capTestRunnerConcurrency('pnpm test', 2)).toBe('pnpm test -- --maxWorkers=2');
    expect(capTestRunnerConcurrency('npm run test', 2)).toBe('npm run test -- --maxWorkers=2');
    expect(capTestRunnerConcurrency('yarn test', 2)).toBe('yarn test -- --maxWorkers=2');
    expect(capTestRunnerConcurrency('pnpm -r test', 2)).toBe('pnpm -r test -- --maxWorkers=2');
  });

  it('handles the incident command shape (cd && pnpm test)', () => {
    expect(capTestRunnerConcurrency('cd apps/admin && pnpm test', 2)).toBe(
      'cd apps/admin && pnpm test -- --maxWorkers=2',
    );
  });

  it('reuses an existing -- separator instead of adding another', () => {
    expect(capTestRunnerConcurrency('pnpm test -- --reporter=dot', 2)).toBe(
      'pnpm test -- --reporter=dot --maxWorkers=2',
    );
  });

  it('is a no-op when a worker/pool flag is already present', () => {
    expect(capTestRunnerConcurrency('vitest run --maxWorkers=8', 2)).toBe('vitest run --maxWorkers=8');
    expect(capTestRunnerConcurrency('vitest run --pool=forks', 2)).toBe('vitest run --pool=forks');
    expect(capTestRunnerConcurrency('vitest run --no-file-parallelism', 2)).toBe(
      'vitest run --no-file-parallelism',
    );
  });

  it('is a no-op when capping is disabled (N=0)', () => {
    expect(capTestRunnerConcurrency('pnpm test', 0)).toBe('pnpm test');
  });

  it('does not inject for runners that reject --maxWorkers (playwright/cypress/...)', () => {
    expect(capTestRunnerConcurrency('pnpm playwright test', 2)).toBe('pnpm playwright test');
    expect(capTestRunnerConcurrency('playwright test', 2)).toBe('playwright test');
    expect(capTestRunnerConcurrency('pnpm cypress run', 2)).toBe('pnpm cypress run');
    expect(capTestRunnerConcurrency('pnpm test:e2e && pnpm mocha', 2)).toBe(
      'pnpm test:e2e && pnpm mocha',
    );
  });

  it('does not touch non-test commands', () => {
    expect(capTestRunnerConcurrency('cd apps/app && pnpm tsc --noEmit', 2)).toBe(
      'cd apps/app && pnpm tsc --noEmit',
    );
    expect(capTestRunnerConcurrency('pnpm install', 2)).toBe('pnpm install');
    expect(capTestRunnerConcurrency('pnpm build', 2)).toBe('pnpm build');
    expect(capTestRunnerConcurrency('git status', 2)).toBe('git status');
  });

  it('leaves the command untouched when the runner is not the last segment', () => {
    // Conservative: only the final shell segment is inspected.
    expect(capTestRunnerConcurrency('pnpm test && echo done', 2)).toBe('pnpm test && echo done');
  });

  it('does not misfire on "test" embedded in another word (vitest config edits)', () => {
    expect(capTestRunnerConcurrency('cat vitest.config.mts', 2)).toBe('cat vitest.config.mts');
  });
});

describe('resolveTestMaxWorkers', () => {
  it('defaults to 2 when unset', () => {
    expect(resolveTestMaxWorkers(undefined)).toBe(2);
  });
  it('honors an explicit 0 (disabled)', () => {
    expect(resolveTestMaxWorkers('0')).toBe(0);
  });
  it('parses a positive override', () => {
    expect(resolveTestMaxWorkers('4')).toBe(4);
  });
  it('falls back to default on garbage / negative', () => {
    expect(resolveTestMaxWorkers('abc')).toBe(2);
    expect(resolveTestMaxWorkers('-3')).toBe(2);
  });
});

describe('buildSpawnEnv', () => {
  it('sets CI=true for non-install commands', () => {
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, {})).toEqual({
      CI: 'true',
    });
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: true }, {})).toEqual({
      CI: 'true',
    });
  });

  it('preserves prior install behavior: CI only without shell operators', () => {
    expect(buildSpawnEnv({ isInstallCommand: true, hasShellOperators: false }, {})).toEqual({
      CI: 'true',
    });
    expect(buildSpawnEnv({ isInstallCommand: true, hasShellOperators: true }, {})).toBeUndefined();
  });

  it('injects NODE_OPTIONS heap cap only when ANT_CMD_MAX_OLD_SPACE_MB is set', () => {
    const env = { ANT_CMD_MAX_OLD_SPACE_MB: '2048' };
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, env)).toEqual({
      CI: 'true',
      NODE_OPTIONS: '--max-old-space-size=2048',
    });
  });

  it('appends the heap cap to inherited NODE_OPTIONS (no clobber)', () => {
    const env = { ANT_CMD_MAX_OLD_SPACE_MB: '2048', NODE_OPTIONS: '--enable-source-maps' };
    const out = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, env);
    expect(out?.NODE_OPTIONS).toBe('--enable-source-maps --max-old-space-size=2048');
  });

  it('does not double-inject when a heap cap is already present', () => {
    const env = { ANT_CMD_MAX_OLD_SPACE_MB: '2048', NODE_OPTIONS: '--max-old-space-size=4096' };
    const out = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, env);
    expect(out?.NODE_OPTIONS).toBeUndefined();
    expect(out).toEqual({ CI: 'true' });
  });
});
