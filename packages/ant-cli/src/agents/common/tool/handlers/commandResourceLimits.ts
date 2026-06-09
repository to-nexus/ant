/**
 * commandResourceLimits — bound the resource footprint of agent-issued
 * subprocess commands at the command-execution boundary.
 *
 * Why (RCA: `level-housing-kneel` worker_stalled): in a cgroup-limited pod a
 * verification task ran a multi-package `vitest`. Vitest sizes its pool from
 * `os.availableParallelism()` (cpuset, NOT the CFS quota) and the heap was
 * unbounded, so the pod thrashed/OOMed and starved the JobWorker parent's lock
 * renewal → `worker_stalled`. The earlier string-rewrite fix (`--maxWorkers=2`
 * appended to the LAST shell segment) silently no-op'd on the heavy commands
 * because the agent pipes test output (`... | tail -80`) — the last segment was
 * `tail`, not the runner.
 *
 * The fix hands the runner the pod's TRUE CPU count (cgroup quota, via
 * cgroupLimits.ts) instead of the host core count it would otherwise read, in a
 * version-MECE way:
 *   - vitest 2.x → VITEST_MAX/MIN_FORKS/THREADS env (shape-proof: inherited
 *     regardless of pipes/wrappers/runner);
 *   - vitest 4 (ignores pool env) → `appendVitestMaxWorkers`, a pipe-AWARE CLI
 *     booster that injects `--maxWorkers` into the runner's OWN segment;
 *   - hygiene: CI=true for non-install commands.
 */

export {
  deriveTestWorkers,
  logResourceCapsOnce,
  readCgroupCpuLimit,
  readCgroupMemoryLimit,
  readCgroupMemoryUsage,
  deriveDefaultHeapMb,
} from '../../../../periphery/system/cgroupLimits';

import { deriveDefaultHeapMb } from '../../../../periphery/system/cgroupLimits';

/** Already-present concurrency/pool flags we must not double-inject or override. */
const EXISTING_WORKER_FLAG_RE =
  /--maxWorkers\b|--max-workers\b|--minWorkers\b|--no-file-parallelism\b|--pool\b|maxForks\b|maxThreads\b/;

/** Direct vitest / jest invocation (incl. `npx vitest`, `vitest run`).
 *  `\btest\b` has no boundary inside "vitest", so wrapper detection stays disjoint. */
const DIRECT_TEST_RUNNER_RE = /(?:^|\s)(?:vitest|jest)(?:\s|$)/;

/** Package-manager test script: `pnpm test`, `npm run test`, `pnpm -r test`, … */
const WRAPPER_TEST_RE = /(?:^|\s)(?:npm|pnpm|yarn)\s+(?:[^\s&|;]+\s+)*?(?:run\s+)?test\b/;

/** Runners that reject `--maxWorkers` (playwright uses `--workers`, etc.). */
const INCOMPATIBLE_RUNNER_RE = /\b(?:playwright|cypress|mocha|ava|tape|uvu)\b/;

/** True when the command runs a test runner (direct vitest/jest, or a
 *  package-manager `test` script). Test runners fork worker processes, so the
 *  heap cap divides the budget across `workers+1`; single-process tsc/build use
 *  divisor 1. (RCA `tight-drafting-lever` — see resolveHeapCapMb.) */
export function isTestCommand(command: string): boolean {
  return DIRECT_TEST_RUNNER_RE.test(command) || WRAPPER_TEST_RE.test(command);
}

/** Split into [segment, separator, segment, …] preserving separators so the
 *  command can be rebuilt verbatim after injecting into one segment. */
const SHELL_SEGMENT_SPLIT_RE = /(\s*(?:&&|\|\||\||;)\s*)/;

/**
 * Pipe-AWARE concurrency cap: inject `--maxWorkers=<n>` into the shell segment
 * that actually invokes vitest/jest, wherever it sits in a pipeline. Fixes the
 * old last-segment-only bypass (`pnpm test 2>&1 | tail -80` is now capped).
 * No-op on: n<=0, an existing worker/pool flag, an incompatible runner, or no
 * runner segment. Direct runners get the flag verbatim; package-manager wrappers
 * get it forwarded after `--`.
 */
export function appendVitestMaxWorkers(command: string, n: number): string {
  if (n <= 0) return command;
  if (EXISTING_WORKER_FLAG_RE.test(command)) return command;
  if (INCOMPATIBLE_RUNNER_RE.test(command)) return command;

  const parts = command.split(SHELL_SEGMENT_SPLIT_RE);
  // Even indices are segments, odd indices are separators.
  for (let i = 0; i < parts.length; i += 2) {
    const injected = injectIntoSegment(parts[i], n);
    if (injected !== null) {
      parts[i] = injected;
      return parts.join('');
    }
  }
  return command;
}

/** Inject the cap into one segment, or return null if it holds no test runner. */
function injectIntoSegment(segment: string, n: number): string | null {
  const isWrapper = WRAPPER_TEST_RE.test(segment);
  const isDirect = !isWrapper && DIRECT_TEST_RUNNER_RE.test(segment);
  if (!isWrapper && !isDirect) return null;

  // Wrappers need `-- ` to forward into the underlying script (reuse an existing
  // separator). Append before any trailing whitespace so rejoin stays clean.
  const sep = isWrapper ? (/\s--(?:\s|$)/.test(segment) ? ' ' : ' -- ') : ' ';
  const append = `${sep}--maxWorkers=${n}`;
  return segment.replace(/\s*$/, (ws) => `${append}${ws}`);
}

/**
 * Resolve the `--max-old-space-size` (MiB) for a command, or undefined for none.
 * `ANT_CMD_MAX_OLD_SPACE_MB` (opt-in) wins; otherwise a default is derived from
 * the cgroup memory budget. The divisor is the worst-case count of Node procs
 * that inherit the cap at once: a test runner spawns `workers` forks + itself,
 * a single-process tsc/build is 1 (RCA `tight-drafting-lever`: a (workers+1)
 * divisor on tsc starved it into spurious JS-OOM).
 */
export function resolveHeapCapMb(
  opts: { isTestCommand?: boolean },
  workers: number,
  cgroupMemBytes: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { mb: number; source: 'optin' | 'derived' } | undefined {
  const optin = Number.parseInt(env.ANT_CMD_MAX_OLD_SPACE_MB ?? '', 10);
  if (Number.isFinite(optin) && optin > 0) return { mb: optin, source: 'optin' };
  const divisor = opts.isTestCommand ? workers + 1 : 1;
  const derived = deriveDefaultHeapMb(cgroupMemBytes, divisor);
  return derived === undefined ? undefined : { mb: derived, source: 'derived' };
}

/**
 * Spawn env (or undefined). Single SSOT for the env passed to every command:
 * - CI=true for non-install commands (and installs without shell operators —
 *   preserving prior install-only behavior). Keeps runners non-interactive.
 * - VITEST_*_FORKS/THREADS = `workers` — shape-proof worker cap for vitest 2.x
 *   (inherited regardless of command shape; harmless no-op on v4). `0` disables.
 * - NODE_OPTIONS heap cap — `ANT_CMD_MAX_OLD_SPACE_MB` (opt-in) else a default
 *   derived from `cgroupMemBytes` (when passed). Appended to inherited
 *   NODE_OPTIONS, skipped if a cap is already set. `cgroupMemBytes` undefined →
 *   no default cap (prior behavior preserved).
 */
export function buildSpawnEnv(
  opts: { isInstallCommand: boolean; hasShellOperators: boolean; isTestCommand?: boolean },
  workers: number,
  env: NodeJS.ProcessEnv = process.env,
  cgroupMemBytes?: number,
): Record<string, string> | undefined {
  const extra: Record<string, string> = {};

  if (!(opts.isInstallCommand && opts.hasShellOperators)) {
    extra.CI = 'true';
  }

  if (workers > 0) {
    const w = String(workers);
    extra.VITEST_MAX_FORKS = w;
    extra.VITEST_MIN_FORKS = w;
    extra.VITEST_MAX_THREADS = w;
    extra.VITEST_MIN_THREADS = w;
  }

  const cap = resolveHeapCapMb(opts, workers, cgroupMemBytes, env);
  if (cap) {
    const inherited = env.NODE_OPTIONS ?? '';
    if (!/--max-old-space-size\b/.test(inherited)) {
      extra.NODE_OPTIONS = [inherited, `--max-old-space-size=${cap.mb}`].filter(Boolean).join(' ');
    }
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}
