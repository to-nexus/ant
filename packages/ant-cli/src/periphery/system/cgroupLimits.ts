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
 *
 * Memory axis (RCA: `tight-drafting-lever`, recurrence of `level-housing-kneel`):
 * the CPU fix capped vitest's WORKER COUNT but left per-process HEAP unbounded
 * (the `--max-old-space-size` cap was opt-in only). A two-app verify loop then
 * grew past the cgroup memory limit → kubelet SIGKILL (no JS heap-OOM error) →
 * parent lock renewal starved → BullMQ stall. `readCgroupMemoryLimit` +
 * `deriveDefaultHeapMb` close that axis (default heap cap sized from the pod's
 * real memory budget); `readCgroupMemoryUsage` feeds the runtime memory-pressure
 * watchdog/observability.
 */

import os from 'os';
import fs from 'fs';

const CGROUP_V2_CPU_MAX = '/sys/fs/cgroup/cpu.max';
const CGROUP_V1_CPU_QUOTA = '/sys/fs/cgroup/cpu/cpu.cfs_quota_us';
const CGROUP_V1_CPU_PERIOD = '/sys/fs/cgroup/cpu/cpu.cfs_period_us';

const CGROUP_V2_MEMORY_MAX = '/sys/fs/cgroup/memory.max';
const CGROUP_V1_MEMORY_LIMIT = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
const CGROUP_V2_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current';
const CGROUP_V1_MEMORY_USAGE = '/sys/fs/cgroup/memory/memory.usage_in_bytes';

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

/** Parse a cgroup byte-count file. `"max"` (v2) and the v1 unlimited sentinel
 *  (≥ MAX_SAFE_INTEGER, e.g. 9223372036854771712) both read as undefined. */
function parseByteLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === 'max') return undefined;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n <= 0 || n >= Number.MAX_SAFE_INTEGER) return undefined;
  return n;
}

// The memory limit is fixed for the process lifetime, so cache it; usage is
// volatile and never cached. Cache only the real `/sys` reader so injected
// test readers stay deterministic.
let memLimitCache: number | undefined;
let memLimitCached = false;

/**
 * Container memory limit in bytes, or `undefined` when unlimited / unreadable /
 * non-Linux. cgroup v2 `memory.max` (`"max"` = unlimited), v1
 * `memory.limit_in_bytes` (huge sentinel = unlimited).
 */
export function readCgroupMemoryLimit(readFile: FileReader = defaultReadFile): number | undefined {
  const useCache = readFile === defaultReadFile;
  if (useCache && memLimitCached) return memLimitCache;
  const v2 = parseByteLimit(tryRead(readFile, CGROUP_V2_MEMORY_MAX));
  const result = v2 ?? parseByteLimit(tryRead(readFile, CGROUP_V1_MEMORY_LIMIT));
  if (useCache) {
    memLimitCache = result;
    memLimitCached = true;
  }
  return result;
}

/** Current container memory usage in bytes, or `undefined` when unreadable.
 *  NOTE: includes reclaimable page cache, so a high reading may overstate
 *  pressure — callers should treat it as a conservative ceiling. */
export function readCgroupMemoryUsage(readFile: FileReader = defaultReadFile): number | undefined {
  const v2 = tryRead(readFile, CGROUP_V2_MEMORY_CURRENT);
  const raw = v2 ?? tryRead(readFile, CGROUP_V1_MEMORY_USAGE);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// `--max-old-space-size` bounds only V8 old-space; real RSS runs ~1.3-1.6× that
// (young-gen, native/off-heap esbuild/swc buffers, baseline). 0.80 reserves for
// it; 768 MiB reserves the parent JobWorker + job-runner's own heap.
const HEAP_USABLE_FRACTION = 0.8;
const HEAP_PARENT_HEADROOM_BYTES = 768 * 1024 * 1024;
const HEAP_MIN_MB = 512;
const HEAP_MAX_MB = 4096;

/**
 * Default `--max-old-space-size` (MiB) for agent-spawned commands, sized from
 * the cgroup memory budget. `concurrentProcs` is the worst-case number of Node
 * processes that inherit the cap simultaneously (test runner = workers+1 forks;
 * single-process tsc/build = 1). Returns `undefined` when memory is unreadable
 * (→ caller injects no cap, preserving prior behavior).
 */
export function deriveDefaultHeapMb(
  cgroupMemBytes: number | undefined,
  concurrentProcs: number,
): number | undefined {
  if (cgroupMemBytes === undefined) return undefined;
  const procs = Math.max(1, concurrentProcs);
  const usable = cgroupMemBytes * HEAP_USABLE_FRACTION - HEAP_PARENT_HEADROOM_BYTES;
  const perProcMb = Math.floor(usable / procs / (1024 * 1024));
  return Math.min(HEAP_MAX_MB, Math.max(HEAP_MIN_MB, perProcMb));
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
 * is a fresh child). `cgroupCpu=none` / `cgroupMem=none` means the cgroup read
 * failed and we fell back (over-spawn / no heap cap could recur) — surfacing it
 * makes that fallback visible instead of a silent no-op. `heapCapMb` reflects
 * the first command's derived cap (representative for the job).
 */
export function logResourceCapsOnce(
  workers: number,
  cgroupCpu: number | undefined,
  cgroupMemBytes?: number,
  cgroupMemUsedBytes?: number,
  heapCapMb?: number | string,
): void {
  if (capsLogged) return;
  capsLogged = true;
  const mb = (b?: number) => (b === undefined ? 'none' : `${Math.round(b / (1024 * 1024))}MiB`);
  console.log(
    `   🧮 [ResourceCaps] testWorkers=${workers} ` +
      `cgroupCpu=${cgroupCpu ?? 'none'} hostCpu=${os.availableParallelism()} ` +
      `cgroupMem=${mb(cgroupMemBytes)} cgroupMemUsed=${cgroupMemUsedBytes === undefined ? '?' : mb(cgroupMemUsedBytes)} ` +
      `heapCapMb=${heapCapMb ?? 'none'}`,
  );
}
