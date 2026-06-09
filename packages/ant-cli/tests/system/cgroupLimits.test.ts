import { describe, expect, it, vi } from 'vitest';
import os from 'os';

import {
  readCgroupCpuLimit,
  deriveTestWorkers,
  readCgroupMemoryLimit,
  readCgroupMemoryUsage,
  deriveDefaultHeapMb,
  logResourceCapsOnce,
} from '../../src/periphery/system/cgroupLimits';

const GiB = 1024 * 1024 * 1024;

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

// Regression guard for `tight-drafting-lever`: the memory axis (heap cap +
// watchdog budget) is sized from the pod's real cgroup memory limit.
describe('readCgroupMemoryLimit', () => {
  it('reads cgroup v2 memory.max (bytes)', () => {
    expect(readCgroupMemoryLimit(reader({ '/sys/fs/cgroup/memory.max': String(8 * GiB) }))).toBe(8 * GiB);
    expect(readCgroupMemoryLimit(reader({ '/sys/fs/cgroup/memory.max': `${4 * GiB}\n` }))).toBe(4 * GiB);
  });

  it('treats v2 "max" (unlimited) as undefined', () => {
    expect(readCgroupMemoryLimit(reader({ '/sys/fs/cgroup/memory.max': 'max' }))).toBeUndefined();
  });

  it('falls back to cgroup v1 memory.limit_in_bytes', () => {
    expect(
      readCgroupMemoryLimit(reader({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(2 * GiB) })),
    ).toBe(2 * GiB);
  });

  it('treats the v1 unlimited sentinel (≥ MAX_SAFE_INTEGER) as undefined', () => {
    expect(
      readCgroupMemoryLimit(
        reader({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712' }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when no cgroup memory files are readable', () => {
    expect(readCgroupMemoryLimit(reader({}))).toBeUndefined();
  });
});

describe('readCgroupMemoryUsage', () => {
  it('reads v2 memory.current then v1 memory.usage_in_bytes', () => {
    expect(readCgroupMemoryUsage(reader({ '/sys/fs/cgroup/memory.current': String(3 * GiB) }))).toBe(3 * GiB);
    expect(
      readCgroupMemoryUsage(reader({ '/sys/fs/cgroup/memory/memory.usage_in_bytes': '1234' })),
    ).toBe(1234);
  });

  it('returns undefined when unreadable', () => {
    expect(readCgroupMemoryUsage(reader({}))).toBeUndefined();
  });
});

describe('deriveDefaultHeapMb', () => {
  it('divides the budget across concurrent procs (the worked examples)', () => {
    expect(deriveDefaultHeapMb(8 * GiB, 4)).toBe(1446); // test: workers 3 + runner
    expect(deriveDefaultHeapMb(4 * GiB, 2)).toBe(1254); // test: workers 1 + runner
  });

  it('returns undefined when memory is unreadable (→ no default cap)', () => {
    expect(deriveDefaultHeapMb(undefined, 4)).toBeUndefined();
  });

  it('clamps to [512, 4096]', () => {
    expect(deriveDefaultHeapMb(1 * GiB, 4)).toBe(512); // tiny pod → floor
    expect(deriveDefaultHeapMb(64 * GiB, 1)).toBe(4096); // huge pod, single proc → ceil
  });

  it('treats a 0/negative divisor as 1', () => {
    expect(deriveDefaultHeapMb(8 * GiB, 0)).toBe(deriveDefaultHeapMb(8 * GiB, 1));
  });
});

describe('logResourceCapsOnce', () => {
  it('renders "none" for missing cgroup memory + the heap-cap value', async () => {
    // Fresh module instance so the once-gate is not already tripped.
    vi.resetModules();
    const fresh = await import('../../src/periphery/system/cgroupLimits');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fresh.logResourceCapsOnce(3, 4, undefined, undefined, undefined);
    expect(spy.mock.calls[0][0]).toContain('cgroupMem=none');
    expect(spy.mock.calls[0][0]).toContain('heapCapMb=none');
    spy.mockRestore();
  });
});
