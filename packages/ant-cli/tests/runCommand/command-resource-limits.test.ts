import { describe, expect, it } from 'vitest';

import {
  appendVitestMaxWorkers,
  buildSpawnEnv,
  resolveHeapCapMb,
  isTestCommand,
} from '../../src/agents/common/tool/handlers/commandResourceLimits';

const GiB = 1024 * 1024 * 1024;

// Regression guard for the `level-housing-kneel` worker_stalled incident:
// the test runner must be concurrency-capped EVEN when piped (the old
// last-segment-only logic bypassed `... | tail`), and the spawn env must carry
// the pod-sized vitest pool cap as the shape-proof backstop.

describe('appendVitestMaxWorkers — pipe-aware injection', () => {
  it('injects into a direct vitest invocation', () => {
    expect(appendVitestMaxWorkers('vitest run', 1)).toBe('vitest run --maxWorkers=1');
    expect(appendVitestMaxWorkers('npx vitest run', 2)).toBe('npx vitest run --maxWorkers=2');
    expect(appendVitestMaxWorkers('jest', 1)).toBe('jest --maxWorkers=1');
  });

  it('forwards after -- for package-manager wrappers', () => {
    expect(appendVitestMaxWorkers('pnpm test', 1)).toBe('pnpm test -- --maxWorkers=1');
    expect(appendVitestMaxWorkers('npm run test', 1)).toBe('npm run test -- --maxWorkers=1');
    expect(appendVitestMaxWorkers('pnpm -r test', 1)).toBe('pnpm -r test -- --maxWorkers=1');
  });

  // The whole point of the fix: piped commands (last segment = head/tail) are
  // now capped on the RUNNER segment, not bypassed.
  it('caps the runner segment when the command is piped (the incident shape)', () => {
    expect(
      appendVitestMaxWorkers('cd apps/admin && npx vitest run --reporter=verbose 2>&1 | head -50', 1),
    ).toBe('cd apps/admin && npx vitest run --reporter=verbose 2>&1 --maxWorkers=1 | head -50');

    expect(appendVitestMaxWorkers('pnpm test 2>&1 | tail -80', 1)).toBe(
      'pnpm test 2>&1 -- --maxWorkers=1 | tail -80',
    );

    expect(appendVitestMaxWorkers('cd apps/app && pnpm test 2>&1 | tail -80', 1)).toBe(
      'cd apps/app && pnpm test 2>&1 -- --maxWorkers=1 | tail -80',
    );
  });

  it('reuses an existing -- separator instead of adding another', () => {
    expect(appendVitestMaxWorkers('pnpm test -- --reporter=dot', 1)).toBe(
      'pnpm test -- --reporter=dot --maxWorkers=1',
    );
  });

  it('is a no-op when a worker/pool flag is already present', () => {
    expect(appendVitestMaxWorkers('vitest run --maxWorkers=8', 1)).toBe('vitest run --maxWorkers=8');
    expect(appendVitestMaxWorkers('vitest run --pool=forks', 1)).toBe('vitest run --pool=forks');
    expect(appendVitestMaxWorkers('vitest run --no-file-parallelism', 1)).toBe(
      'vitest run --no-file-parallelism',
    );
  });

  it('is a no-op when capping is disabled (n=0)', () => {
    expect(appendVitestMaxWorkers('pnpm test', 0)).toBe('pnpm test');
  });

  it('does not inject for runners that reject --maxWorkers', () => {
    expect(appendVitestMaxWorkers('pnpm playwright test', 1)).toBe('pnpm playwright test');
    expect(appendVitestMaxWorkers('playwright test', 1)).toBe('playwright test');
    expect(appendVitestMaxWorkers('pnpm cypress run', 1)).toBe('pnpm cypress run');
    expect(appendVitestMaxWorkers('pnpm test:e2e && pnpm mocha', 1)).toBe('pnpm test:e2e && pnpm mocha');
  });

  it('does not touch non-test commands', () => {
    expect(appendVitestMaxWorkers('cd apps/app && pnpm tsc --noEmit', 1)).toBe(
      'cd apps/app && pnpm tsc --noEmit',
    );
    expect(appendVitestMaxWorkers('pnpm install', 1)).toBe('pnpm install');
    expect(appendVitestMaxWorkers('pnpm build', 1)).toBe('pnpm build');
    expect(appendVitestMaxWorkers('git status', 1)).toBe('git status');
  });

  it('does not misfire on "test" embedded in another word (config edits)', () => {
    expect(appendVitestMaxWorkers('cat vitest.config.mts', 1)).toBe('cat vitest.config.mts');
  });

  it('caps the runner even when it is not the last segment (old conservative gap)', () => {
    expect(appendVitestMaxWorkers('pnpm test && echo done', 1)).toBe(
      'pnpm test -- --maxWorkers=1 && echo done',
    );
  });
});

describe('buildSpawnEnv', () => {
  it('sets CI=true + vitest pool cap (sized to workers) for non-install commands', () => {
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 1, {})).toEqual({
      CI: 'true',
      VITEST_MAX_FORKS: '1',
      VITEST_MIN_FORKS: '1',
      VITEST_MAX_THREADS: '1',
      VITEST_MIN_THREADS: '1',
    });
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 3, {})).toMatchObject({
      VITEST_MAX_FORKS: '3',
      VITEST_MIN_THREADS: '3',
    });
  });

  it('preserves prior install behavior: no CI for install WITH shell operators', () => {
    expect(buildSpawnEnv({ isInstallCommand: true, hasShellOperators: true }, 1, {})).toEqual({
      VITEST_MAX_FORKS: '1',
      VITEST_MIN_FORKS: '1',
      VITEST_MAX_THREADS: '1',
      VITEST_MIN_THREADS: '1',
    });
    expect(buildSpawnEnv({ isInstallCommand: true, hasShellOperators: false }, 1, {})).toMatchObject({
      CI: 'true',
    });
  });

  it('omits the vitest pool cap when capping is disabled (workers=0)', () => {
    expect(buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 0, {})).toEqual({
      CI: 'true',
    });
  });

  it('injects an opt-in NODE_OPTIONS heap cap only when ANT_CMD_MAX_OLD_SPACE_MB is set', () => {
    const out = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 1, {
      ANT_CMD_MAX_OLD_SPACE_MB: '2048',
    });
    expect(out?.NODE_OPTIONS).toBe('--max-old-space-size=2048');

    const off = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 1, {});
    expect(off?.NODE_OPTIONS).toBeUndefined();
  });

  it('appends the opt-in heap cap to inherited NODE_OPTIONS without clobbering', () => {
    const out = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 1, {
      ANT_CMD_MAX_OLD_SPACE_MB: '2048',
      NODE_OPTIONS: '--enable-source-maps',
    });
    expect(out?.NODE_OPTIONS).toBe('--enable-source-maps --max-old-space-size=2048');

    const already = buildSpawnEnv({ isInstallCommand: false, hasShellOperators: false }, 1, {
      ANT_CMD_MAX_OLD_SPACE_MB: '2048',
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(already?.NODE_OPTIONS).toBeUndefined();
  });
});

// Regression guard for `tight-drafting-lever` (recurrence of `level-housing-kneel`):
// per-process heap was unbounded → cgroup OOM. A default cap is now derived from
// the pod memory budget, divided across the worst-case concurrent Node procs.
describe('buildSpawnEnv — derived heap cap from cgroup memory', () => {
  it('derives a per-fork cap for test commands (divisor = workers+1)', () => {
    // 8 GiB, workers 3 → divisor 4 → 1446 MB (see resolveHeapCapMb math).
    const out = buildSpawnEnv(
      { isInstallCommand: false, hasShellOperators: false, isTestCommand: true },
      3,
      {},
      8 * GiB,
    );
    expect(out?.NODE_OPTIONS).toBe('--max-old-space-size=1446');
  });

  it('gives single-process commands (tsc/build) the whole budget (divisor 1, clamped)', () => {
    // 8 GiB, divisor 1 → ~5785 MB → clamped to MAX 4096.
    const out = buildSpawnEnv(
      { isInstallCommand: false, hasShellOperators: false, isTestCommand: false },
      3,
      {},
      8 * GiB,
    );
    expect(out?.NODE_OPTIONS).toBe('--max-old-space-size=4096');
  });

  it('injects NO default cap when cgroup memory is unreadable (prior behavior preserved)', () => {
    const out = buildSpawnEnv(
      { isInstallCommand: false, hasShellOperators: false, isTestCommand: true },
      3,
      {},
      undefined,
    );
    expect(out?.NODE_OPTIONS).toBeUndefined();
  });

  it('lets the explicit ANT_CMD_MAX_OLD_SPACE_MB override win over the derived default', () => {
    const out = buildSpawnEnv(
      { isInstallCommand: false, hasShellOperators: false, isTestCommand: true },
      3,
      { ANT_CMD_MAX_OLD_SPACE_MB: '2048' },
      8 * GiB,
    );
    expect(out?.NODE_OPTIONS).toBe('--max-old-space-size=2048');
  });

  it('skips the derived cap when inherited NODE_OPTIONS already sets one', () => {
    const out = buildSpawnEnv(
      { isInstallCommand: false, hasShellOperators: false, isTestCommand: true },
      3,
      { NODE_OPTIONS: '--max-old-space-size=512' },
      8 * GiB,
    );
    expect(out?.NODE_OPTIONS).toBeUndefined();
  });
});

describe('resolveHeapCapMb', () => {
  it('reports source=optin for the explicit override, source=derived otherwise', () => {
    expect(resolveHeapCapMb({ isTestCommand: true }, 3, 8 * GiB, { ANT_CMD_MAX_OLD_SPACE_MB: '999' }))
      .toEqual({ mb: 999, source: 'optin' });
    expect(resolveHeapCapMb({ isTestCommand: true }, 3, 8 * GiB, {}))
      .toEqual({ mb: 1446, source: 'derived' });
    expect(resolveHeapCapMb({ isTestCommand: true }, 3, undefined, {})).toBeUndefined();
  });
});

describe('isTestCommand', () => {
  it('matches direct runners and package-manager test scripts, not tsc/build', () => {
    expect(isTestCommand('vitest run')).toBe(true);
    expect(isTestCommand('cd apps/app && pnpm test 2>&1 | tail -80')).toBe(true);
    expect(isTestCommand('jest')).toBe(true);
    expect(isTestCommand('tsc --noEmit')).toBe(false);
    expect(isTestCommand('pnpm build')).toBe(false);
    expect(isTestCommand('cat vitest.config.mts')).toBe(false);
  });
});
