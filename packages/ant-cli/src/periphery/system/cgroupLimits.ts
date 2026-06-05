/**
 * cgroupLimits — measure the container's REAL CPU allocation and size the test
 * runner's worker pool from it.
 *
 * Why (RCA: `level-housing-kneel` worker_stalled): in a cgroup-limited pod,
 * vitest/jest size their worker pool from `os.availableParallelism()` — which
 * reflects the HOST's core count, NOT the pod's CFS quota — so they over-spawn
 * (dozens of jsdom+app worker processes), saturate the pod's CPU+memory, and
 * starve the sibling ant-job process whose BullMQ lock renewal then misses its
 * heartbeat → the lock expires → `worker_stalled`.
 *
 * The fix is not to clamp the runner to 1, but to hand it the pod's true CPU
 * count (cgroup quota), reserving one core for the heartbeat. Locally (no cgroup
 * limit) `availableParallelism()` already IS the real machine, so it passes
 * through unchanged.
 */

import os from 'os';
import fs from 'fs';

const CGROUP_V2_CPU_MAX = '/sys/fs/cgroup/cpu.max';
const CGROUP_V1_CPU_QUOTA = '/sys/fs/cgroup/cpu/cpu.cfs_quota_us';
const CGROUP_V1_CPU_PERIOD = '/sys/fs/cgroup/cpu/cpu.cfs_period_us';

type FileReader = (path: string) => string;

const defaultReadFile: FileReader = (path) => fs.readFileSync(path, 'utf8');

/**
 * Effective CPU count from the cgroup CPU quota, or `undefined` when unlimited /
 * unreadable / non-Linux. cgroup v2 `cpu.max` is `"<quota> <period>"` (or `max`);
 * v1 splits quota (`-1` = unlimited) and period into two files. Rounds the
 * quota/period ratio to the nearest whole core (min 1).
 */
export function readCgroupCpuLimit(readFile: FileReader = defaultReadFile): number | undefined {
  const v2 = tryRead(readFile, CGROUP_V2_CPU_MAX);
  if (v2 !== undefined) {
    const [quotaRaw, periodRaw] = v2.trim().split(/\s+/);
    if (quotaRaw === 'max') return undefined;
    return cpusFromQuota(Number.parseInt(quotaRaw, 10), Number.parseInt(periodRaw ?? '', 10));
  }

  const quotaRaw = tryRead(readFile, CGROUP_V1_CPU_QUOTA);
  const periodRaw = tryRead(readFile, CGROUP_V1_CPU_PERIOD);
  if (quotaRaw === undefined || periodRaw === undefined) return undefined;
  const quota = Number.parseInt(quotaRaw.trim(), 10);
  if (quota <= 0) return undefined; // -1 = unlimited
  return cpusFromQuota(quota, Number.parseInt(periodRaw.trim(), 10));
}

function cpusFromQuota(quota: number, period: number): number | undefined {
  if (!Number.isFinite(quota) || !Number.isFinite(period) || quota <= 0 || period <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(quota / period));
}

function tryRead(readFile: FileReader, path: string): string | undefined {
  try {
    return readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Worker-pool size for test runners: the pod's effective CPU count (cgroup
 * quota, else host parallelism) minus one core reserved for the ant-job
 * heartbeat + job-runner, floored at 1. Override via `ANT_CMD_TEST_MAX_WORKERS`
 * (integer; `0` = disabled → no cap injected).
 */
export function deriveTestWorkers(
  opts: { env?: NodeJS.ProcessEnv; effectiveCpu?: number } = {},
): number {
  const env = opts.env ?? process.env;

  const raw = env.ANT_CMD_TEST_MAX_WORKERS;
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n; // 0 → disabled
  }

  const cpu = opts.effectiveCpu ?? readCgroupCpuLimit() ?? os.availableParallelism();
  return Math.max(1, cpu - 1);
}

let capsLogged = false;

/**
 * Log the derived worker cap once per process (≈ once per job, since job-runner
 * is a fresh child). `cgroupCpu=none` in a pod means the cgroup read failed and
 * we fell back to host cores — i.e. the over-spawn bug could recur. Surfacing it
 * makes that fallback visible instead of a silent no-op.
 */
export function logResourceCapsOnce(workers: number, cgroupCpu: number | undefined): void {
  if (capsLogged) return;
  capsLogged = true;
  console.log(
    `   🧮 [ResourceCaps] testWorkers=${workers} ` +
      `cgroupCpu=${cgroupCpu ?? 'none'} hostCpu=${os.availableParallelism()}`,
  );
}
