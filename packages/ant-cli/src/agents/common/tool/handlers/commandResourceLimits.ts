/**
 * commandResourceLimits — bound the resource footprint of agent-issued
 * subprocess commands at the command-execution boundary.
 *
 * Why this exists (RCA: `level-housing-kneel` worker_stalled): a verification
 * task ran a multi-package `vitest run`. In a container, vitest/jest size their
 * worker pool from `os.cpus()` (host core count, cgroup-unaware), so the pool
 * over-spawns and exhausts the pod's memory + CPU. That freezes BOTH the
 * job-runner child (its run_command watchdog) and the parent ant-job worker
 * (its BullMQ lock renewal), so the only liveness backstop — the 5-minute lock
 * — expires and BullMQ flags the worker as crashed/stalled.
 *
 * The durable fix bounds concurrency where the command is spawned, regardless
 * of task type (R1-safe — no task.type branches):
 *   1. (primary) cap test-runner worker count via arg forwarding.
 *   2. (backstop, opt-in) per-process V8 heap cap via NODE_OPTIONS.
 *   3. (hygiene) CI=true for non-install commands.
 */

const DEFAULT_TEST_MAX_WORKERS = 2;

/** Already-present concurrency/pool flags we must not double-inject or override. */
const EXISTING_WORKER_FLAG_RE =
  /--maxWorkers\b|--max-workers\b|--minWorkers\b|--no-file-parallelism\b|--pool\b|maxForks\b|maxThreads\b/;

/** Direct vitest / jest invocation (incl. `npx vitest`, `vitest run`).
 *  `\btest\b` has no boundary inside "vitest", so wrapper detection stays disjoint. */
const DIRECT_TEST_RUNNER_RE = /(?:^|\s)(?:vitest|jest)(?:\s|$)/;

/** Package-manager test script: `pnpm test`, `npm run test`, `pnpm -r test`, … */
const WRAPPER_TEST_RE =
  /(?:^|\s)(?:npm|pnpm|yarn)\s+(?:[^\s&|;]+\s+)*?(?:run\s+)?test\b/;

/** Runners that reject `--maxWorkers` (playwright uses `--workers`, etc.). When
 *  one is named in the command we must not inject — covers `pnpm playwright test`. */
const INCOMPATIBLE_RUNNER_RE = /\b(?:playwright|cypress|mocha|ava|tape|uvu)\b/;

/** Resolve the configured worker cap. `0` (explicit) disables capping. */
export function resolveTestMaxWorkers(
  raw: string | undefined = process.env.ANT_CMD_TEST_MAX_WORKERS,
): number {
  if (raw === undefined) return DEFAULT_TEST_MAX_WORKERS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TEST_MAX_WORKERS;
  return n; // 0 → disabled
}

/**
 * Cap a vitest/jest worker pool by appending `--maxWorkers=<N>`. Only the last
 * shell segment is inspected, so `cd x && pnpm test` is capped but a runner that
 * is not last (`pnpm test && echo`) is left untouched (conservative). No-op on:
 * existing worker/pool flag, incompatible runner, N=0, or no runner detected.
 * Direct runners get the flag verbatim; wrappers get it forwarded after `--`.
 */
export function capTestRunnerConcurrency(
  command: string,
  maxWorkers: number = resolveTestMaxWorkers(),
): string {
  if (maxWorkers <= 0) return command;
  if (EXISTING_WORKER_FLAG_RE.test(command)) return command;
  if (INCOMPATIBLE_RUNNER_RE.test(command)) return command;

  // Inspect only the final segment so we don't append past a trailing command.
  const segments = command.split(/&&|\|\|?|;/);
  const lastSegment = segments[segments.length - 1]?.trim() ?? '';
  if (!lastSegment) return command;

  const isWrapper = WRAPPER_TEST_RE.test(lastSegment);
  const isDirect = !isWrapper && DIRECT_TEST_RUNNER_RE.test(lastSegment);
  if (!isWrapper && !isDirect) return command;

  if (isWrapper) {
    // Forward into the underlying script. Reuse an existing `--` separator if
    // the command already forwards args, otherwise introduce one.
    const sep = /\s--(?:\s|$)/.test(command) ? '' : ' --';
    return `${command}${sep} --maxWorkers=${maxWorkers}`;
  }
  return `${command} --maxWorkers=${maxWorkers}`;
}

/**
 * Extra spawn env, or undefined when nothing applies:
 * - CI=true for non-install commands (and installs without shell operators —
 *   preserving prior install-only behavior). Keeps runners non-interactive.
 * - NODE_OPTIONS heap cap, opt-in via ANT_CMD_MAX_OLD_SPACE_MB: a per-process
 *   backstop, APPENDED to inherited NODE_OPTIONS (skipped if a cap already set).
 *   Opt-in so a low cap can't silently fail a large single build — worker-count
 *   capping is the primary OOM lever.
 */
export function buildSpawnEnv(
  opts: { isInstallCommand: boolean; hasShellOperators: boolean },
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const extra: Record<string, string> = {};

  if (!(opts.isInstallCommand && opts.hasShellOperators)) {
    extra.CI = 'true';
  }

  const rawMb = env.ANT_CMD_MAX_OLD_SPACE_MB;
  const mb = rawMb !== undefined ? Number.parseInt(rawMb, 10) : 0;
  if (Number.isFinite(mb) && mb > 0) {
    const inherited = env.NODE_OPTIONS ?? '';
    if (!/--max-old-space-size\b/.test(inherited)) {
      extra.NODE_OPTIONS = [inherited, `--max-old-space-size=${mb}`]
        .filter(Boolean)
        .join(' ');
    }
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}
