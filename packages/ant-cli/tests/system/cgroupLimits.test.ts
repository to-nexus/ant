import { describe, expect, it } from 'vitest';
import os from 'os';

import { readCgroupCpuLimit, deriveTestWorkers } from '../../src/periphery/system/cgroupLimits';

// Regression guard for `level-housing-kneel`: the test-runner pool must be sized
// from the pod's REAL CPU (cgroup quota), not the host core count.

/** Build a fake /sys reader from a path→content map; missing paths throw (ENOENT). */
function reader(files: Record<string, string>) {
  return (path: string): string => {
    if (path in files) return files[path];
    throw new Error(`ENOENT: ${path}`);
  };
}

describe('readCgroupCpuLimit', () => {
  it('reads cgroup v2 cpu.max (quota/period → cores)', () => {
    expect(readCgroupCpuLimit(reader({ '/sys/fs/cgroup/cpu.max': '200000 100000' }))).toBe(2);
    expect(readCgroupCpuLimit(reader({ '/sys/fs/cgroup/cpu.max': '100000 100000' }))).toBe(1);
    expect(readCgroupCpuLimit(reader({ '/sys/fs/cgroup/cpu.max': '400000 100000\n' }))).toBe(4);
  });

  it('treats v2 "max" (unlimited) as undefined', () => {
    expect(readCgroupCpuLimit(reader({ '/sys/fs/cgroup/cpu.max': 'max 100000' }))).toBeUndefined();
  });

  it('falls back to cgroup v1 quota+period files', () => {
    const files = {
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '300000',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
    };
    expect(readCgroupCpuLimit(reader(files))).toBe(3);
  });

  it('treats v1 quota -1 (unlimited) as undefined', () => {
    const files = {
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '-1',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
    };
    expect(readCgroupCpuLimit(reader(files))).toBeUndefined();
  });

  it('returns undefined when no cgroup files are readable (non-Linux / unconstrained)', () => {
    expect(readCgroupCpuLimit(reader({}))).toBeUndefined();
  });
});

describe('deriveTestWorkers', () => {
  it('reserves one core for the heartbeat (cpu - 1, floored at 1)', () => {
    expect(deriveTestWorkers({ env: {}, effectiveCpu: 4 })).toBe(3);
    expect(deriveTestWorkers({ env: {}, effectiveCpu: 2 })).toBe(1);
    expect(deriveTestWorkers({ env: {}, effectiveCpu: 1 })).toBe(1);
  });

  it('honors the ANT_CMD_TEST_MAX_WORKERS override (incl. 0 = disabled)', () => {
    expect(deriveTestWorkers({ env: { ANT_CMD_TEST_MAX_WORKERS: '0' }, effectiveCpu: 8 })).toBe(0);
    expect(deriveTestWorkers({ env: { ANT_CMD_TEST_MAX_WORKERS: '5' }, effectiveCpu: 2 })).toBe(5);
  });

  it('ignores a garbage override and falls back to cpu-based sizing', () => {
    expect(deriveTestWorkers({ env: { ANT_CMD_TEST_MAX_WORKERS: 'abc' }, effectiveCpu: 4 })).toBe(3);
  });

  it('with effectiveCpu omitted, sizes from cgroup-or-host CPU (host-agnostic)', () => {
    // Mirrors the production fallback chain without assuming the test host's
    // cgroup state: cgroup quota if present, else host parallelism, minus one.
    const cpu = readCgroupCpuLimit() ?? os.availableParallelism();
    expect(deriveTestWorkers({ env: {} })).toBe(Math.max(1, cpu - 1));
  });
});
