/**
 * `_shared/verify/parity/runVariant` — spawn build/test under a USE_MOCK
 * env override and capture the outcome.
 *
 * The parity orchestrator (`./index.ts`) calls this twice per cycle —
 * once for the virtualized variant (`USE_MOCK_*=true`) and once for the
 * production variant (`USE_MOCK_*=false`) — and compares the resulting
 * outputs to confirm adapter-pair parity.
 *
 * Design constraints:
 *
 * - **Best-effort, never throws** — spawn errors / non-zero exits resolve
 *   to `{ passed: false, output: ... }`. The orchestrator decides what
 *   constitutes a violation; this helper just observes.
 * - **Bounded** — total time spent capped by `VARIANT_TIMEOUT_MS`. A
 *   timed-out variant resolves with `passed:false` and a timeout marker
 *   in `output`.
 * - **Workspace-scoped** — the spawned process inherits a sanitised env
 *   (parent env + caller-provided overrides). It runs with `cwd` set to
 *   the project codebase root.
 * - **Stack-shape from techTier** — the package manager (or language tool)
 *   is read from `state.currentTask.techTiers` / `getTechTier(state)`. If
 *   no command can be inferred, the helper resolves with `passed: true`
 *   + `skippedReason: 'no command inferred'`. The orchestrator treats
 *   that as "no parity observation" rather than a failure (the cycle
 *   degrades gracefully on tech stacks we don't know how to drive).
 */

import { spawn } from 'child_process';
import * as path from 'path';

const VARIANT_TIMEOUT_MS = 120_000; // 2 minutes per variant

export interface VariantSpec {
  /** Absolute path to the project codebase root. */
  cwd: string;
  /** Env overrides applied on top of `process.env`. */
  env: Record<string, string>;
  /**
   * Command + args to run for this variant. The orchestrator infers
   * these from the task's techTier; tests may inject explicit values.
   */
  command: string;
  args: string[];
}

export interface VariantOutcome {
  passed: boolean;
  /** Combined stdout + stderr (truncated to `OUTPUT_TAIL_BYTES`). */
  output: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  skippedReason?: string;
}

const OUTPUT_TAIL_BYTES = 8_000;

function tail(buf: string): string {
  if (buf.length <= OUTPUT_TAIL_BYTES) return buf;
  return `… [${buf.length - OUTPUT_TAIL_BYTES} bytes truncated] …\n` +
    buf.slice(-OUTPUT_TAIL_BYTES);
}

export async function runVariant(spec: VariantSpec): Promise<VariantOutcome> {
  if (!spec.command) {
    return {
      passed: true,
      output: '',
      exitCode: null,
      durationMs: 0,
      timedOut: false,
      skippedReason: 'no command inferred',
    };
  }

  const startedAt = Date.now();
  const env = { ...process.env, ...spec.env };

  return new Promise<VariantOutcome>((resolve) => {
    let settled = false;
    let buffer = '';
    let timedOut = false;

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const onChunk = (chunk: Buffer): void => {
      buffer += chunk.toString('utf-8');
      // Cap in-memory growth — keep only the tail relevant for diagnostics.
      if (buffer.length > OUTPUT_TAIL_BYTES * 2) {
        buffer = tail(buffer);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* noop */ }
      // Forced kill follow-up so dangling spawns release resources.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, 1_000);
    }, VARIANT_TIMEOUT_MS);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      resolve({
        passed: !timedOut && exitCode === 0,
        output: tail(buffer),
        exitCode,
        durationMs,
        timedOut,
      });
    };

    child.on('error', () => finish(null));
    child.on('exit', (code) => finish(code));
  });
}

/**
 * Infer the variant command from a tech-tier package manager. Returns
 * `undefined` when no mapping applies — the caller treats that as
 * "no observation made". Kept tiny on purpose: the parity check is
 * best-effort and a small whitelist is preferable to a fragile broad
 * inference layer that would silently drift across stacks.
 */
export function inferVariantCommand(
  packageManager: string | undefined,
): { command: string; args: string[] } | undefined {
  switch (packageManager) {
    case 'pnpm':
      // `pnpm -r typecheck` runs the `typecheck` script in EVERY workspace
      // member that defines it and is a no-op in members that don't — a
      // real whole-workspace compile signal that does NOT depend on a root
      // `test` script (a monorepo root often has none, making the legacy
      // `<pm> test` a vacuous pass) and is robust to a single package's
      // name drift (no `--filter <name>` to mistype). Typecheck is the
      // cheapest real signal within `VARIANT_TIMEOUT_MS`.
      //
      // Note: typecheck is env-independent, so the mock/real variants
      // produce identical output — parity here is primarily a "does the
      // mock-mode workspace compile" gate. The DTO-divergence comparison
      // (real pass) only adds signal when a real endpoint is reachable,
      // which is rare for greenfield previews.
      return { command: 'pnpm', args: ['-r', 'typecheck'] };
    case 'npm':
    case 'yarn':
    case 'bun':
      // No portable recursive-typecheck one-liner across these managers;
      // keep the conventional `<pm> test` whitelist entry. Projects without
      // a `test` script exit non-zero with a recognisable "Missing script"
      // message — same shape as a real failure so the check stays consistent.
      return { command: packageManager, args: ['test'] };
    default:
      return undefined;
  }
}

/**
 * Convenience: build a `VariantSpec` for a given USE_MOCK env-override
 * map at the project codebase root.
 */
export function variantSpecFor(
  featurePath: string,
  envOverrides: Record<string, string>,
  packageManager: string | undefined,
): VariantSpec {
  const cmd = inferVariantCommand(packageManager) ?? { command: '', args: [] };
  return {
    cwd: path.join(featurePath, 'codebase'),
    env: envOverrides,
    command: cmd.command,
    args: cmd.args,
  };
}
