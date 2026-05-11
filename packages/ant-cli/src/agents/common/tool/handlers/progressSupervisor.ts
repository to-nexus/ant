/**
 * ProgressSupervisor — single SSOT for `run_command` watchdog signals.
 *
 * Consolidates four termination signals that previously raced as separate
 * Promise.race participants in runCommand.ts:
 *
 *   - serverStartedPattern : output looks like a server boot ("listening on …")
 *   - repeatedSignature    : same stderr signature N× → diagnostic loop
 *   - noOutput             : silent for N seconds → slow filesystem walk
 *                            (find / grep -r / npm ls / git blame / tar / du)
 *   - hardTimeout          : absolute ceiling (10m / 20m for installs)
 *
 * Termination is signalled exactly once via the promise returned by signal().
 * Callers race the supervisor.signal() against the command's completion
 * promise; on termination they MUST invoke their own AbortController so the
 * underlying child process is killed cleanly (no orphan-until-hardTimeout).
 *
 * NodeCommandAdapter's `timeoutId` is intentionally removed — supervisor is
 * the hardTimeout SSOT. The adapter only owns the kill-chain timers
 * (SIGTERM → SIGKILL → forceResolve, plus exitGrace for background pipe
 * holders) which fire AFTER supervisor decides to abort.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pure helpers — stall signature accounting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Collapses progress counters like "(1/4)" → "(N/N)" so retries match. */
export function normalizeStderrLineSig(line: string): string {
  return line.replace(/\d+/g, 'N').trim().slice(0, 80);
}

/** Banner lines from package managers / shells — excluded from signature counting
 *  AND from noOutput's lastOutputAt update. */
const STALL_IGNORE_PREFIXES = ['> ', '$ '];

export function pushLineSig(stallMap: Map<string, number>, line: string): void {
  const sig = normalizeStderrLineSig(line);
  if (!sig) return;
  for (const prefix of STALL_IGNORE_PREFIXES) {
    if (sig.startsWith(prefix)) return;
  }
  stallMap.set(sig, (stallMap.get(sig) ?? 0) + 1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Defaults (env-overridable at config time, not module-level)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const DEFAULT_REPEAT_GRACE_MS = 60_000;
export const DEFAULT_REPEAT_THRESHOLD = 3;
export const DEFAULT_NO_OUTPUT_MS = 60_000;
export const DEFAULT_SERVER_DETECTION_MS = 60_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ProgressSignalKind =
  | 'serverStartedPattern'
  | 'repeatedSignature'
  | 'noOutput'
  | 'hardTimeout';

export type ProgressSignal =
  | { kind: 'serverStartedPattern'; output: string }
  | { kind: 'repeatedSignature'; signature: string; repeat: number; elapsedMs: number }
  | { kind: 'noOutput'; silentMs: number }
  | { kind: 'hardTimeout'; elapsedMs: number };

export interface SupervisorThresholds {
  serverDetectionMs: number;
  serverOutputPattern: RegExp;
  repeatGraceMs: number;
  repeatThreshold: number;
  noOutputMs: number;
  hardTimeoutMs: number;
}

export interface ProgressSupervisorOptions {
  command: string;
  thresholds: SupervisorThresholds;
  enabledSignals?: ReadonlyArray<ProgressSignalKind>;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface TerminationRender {
  content: string;
  exitCode: number;
  success: boolean;
  hasWarnings: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Detector — pure
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function detectOutputStall(
  stallMap: Map<string, number>,
  startedAt: number,
  opts: { graceMs?: number; repeatThreshold?: number; now?: number } = {},
): { repeat: number; signature: string } | null {
  const graceMs = opts.graceMs ?? DEFAULT_REPEAT_GRACE_MS;
  const repeatThreshold = opts.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
  const now = opts.now ?? Date.now();
  if (now - startedAt < graceMs) return null;
  let maxCount = 0;
  let maxSig = '';
  for (const [sig, c] of stallMap) {
    if (c > maxCount) { maxCount = c; maxSig = sig; }
  }
  return maxCount >= repeatThreshold ? { repeat: maxCount, signature: maxSig } : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ProgressSupervisor — stateful orchestrator
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ALL_SIGNALS: ReadonlyArray<ProgressSignalKind> = [
  'serverStartedPattern',
  'repeatedSignature',
  'noOutput',
  'hardTimeout',
];

export class ProgressSupervisor {
  private readonly command: string;
  private readonly thresholds: SupervisorThresholds;
  private readonly enabledSignals: Set<ProgressSignalKind>;
  private readonly now: () => number;
  private readonly startedAt: number;

  private stallMap = new Map<string, number>();
  private lastOutputAt: number;
  private accumulatedOutput = '';

  private resolved = false;
  private resolveFn: ((s: ProgressSignal) => void) | null = null;
  private signalPromise: Promise<ProgressSignal> | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(opts: ProgressSupervisorOptions) {
    this.command = opts.command;
    this.thresholds = opts.thresholds;
    this.enabledSignals = new Set(opts.enabledSignals ?? ALL_SIGNALS);
    this.now = opts.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.lastOutputAt = this.startedAt;
  }

  /** Feed a stdout/stderr chunk. Banner-only chunks do not reset noOutput. */
  ingestChunk(chunk: string): void {
    if (this.resolved) return;
    this.accumulatedOutput += chunk;
    for (const line of chunk.split('\n')) pushLineSig(this.stallMap, line);
    if (this.hasNonBannerLine(chunk)) {
      this.lastOutputAt = this.now();
    }
  }

  private hasNonBannerLine(chunk: string): boolean {
    for (const line of chunk.split('\n')) {
      const sig = normalizeStderrLineSig(line);
      if (!sig) continue;
      const isBanner = STALL_IGNORE_PREFIXES.some(p => sig.startsWith(p));
      if (!isBanner) return true;
    }
    return false;
  }

  /**
   * Returns a promise that resolves exactly once when any enabled signal
   * fires. Idempotent — subsequent calls return the same promise.
   */
  signal(): Promise<ProgressSignal> {
    if (this.signalPromise) return this.signalPromise;
    this.signalPromise = new Promise<ProgressSignal>((resolve) => {
      if (this.resolved) return;
      this.resolveFn = resolve;
      this.setupTimers();
    });
    return this.signalPromise;
  }

  private setupTimers(): void {
    if (this.enabledSignals.has('serverStartedPattern')) {
      const id = setTimeout(() => {
        if (this.thresholds.serverOutputPattern.test(this.accumulatedOutput)) {
          this.fire({ kind: 'serverStartedPattern', output: this.accumulatedOutput });
        }
      }, this.thresholds.serverDetectionMs);
      this.cleanupFns.push(() => clearTimeout(id));
    }

    if (this.enabledSignals.has('hardTimeout')) {
      const id = setTimeout(() => {
        this.fire({ kind: 'hardTimeout', elapsedMs: this.now() - this.startedAt });
      }, this.thresholds.hardTimeoutMs);
      this.cleanupFns.push(() => clearTimeout(id));
    }

    const wantsRepeated = this.enabledSignals.has('repeatedSignature');
    const wantsNoOutput = this.enabledSignals.has('noOutput');
    if (wantsRepeated || wantsNoOutput) {
      // Poll interval: short enough to catch noOutput promptly, but not so
      // short that we waste CPU. ~quarter of the smaller threshold, clamped.
      const candidates: number[] = [];
      if (wantsRepeated) candidates.push(15_000);
      if (wantsNoOutput) candidates.push(Math.max(5_000, Math.floor(this.thresholds.noOutputMs / 4)));
      const pollMs = Math.min(...candidates);

      const id = setInterval(() => {
        if (this.resolved) return;
        const now = this.now();

        if (wantsNoOutput) {
          const silentMs = now - this.lastOutputAt;
          const elapsedMs = now - this.startedAt;
          if (silentMs >= this.thresholds.noOutputMs && elapsedMs >= this.thresholds.noOutputMs) {
            this.fire({ kind: 'noOutput', silentMs });
            return;
          }
        }

        if (wantsRepeated) {
          const stall = detectOutputStall(this.stallMap, this.startedAt, {
            graceMs: this.thresholds.repeatGraceMs,
            repeatThreshold: this.thresholds.repeatThreshold,
            now,
          });
          if (stall) {
            this.fire({
              kind: 'repeatedSignature',
              signature: stall.signature,
              repeat: stall.repeat,
              elapsedMs: now - this.startedAt,
            });
            return;
          }
        }
      }, pollMs);
      this.cleanupFns.push(() => clearInterval(id));
    }
  }

  private fire(signal: ProgressSignal): void {
    if (this.resolved) return;
    this.resolved = true;
    this.runCleanup();
    console.warn(`[Watchdog] ${signal.kind} fired: ${this.command}`);
    this.resolveFn?.(signal);
  }

  /** Stop all timers without firing. signal() promise (if held) stays
   *  pending — callers should only await signal() inside Promise.race. */
  dispose(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.runCleanup();
  }

  private runCleanup(): void {
    for (const fn of this.cleanupFns) {
      try { fn(); } catch { /* noop */ }
    }
    this.cleanupFns = [];
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Static — termination rendering (LLM-facing message + ToolResult fields)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  static renderTermination(signal: ProgressSignal, ctx: {
    command: string;
    output: string;
    tailChars?: number;
  }): TerminationRender {
    const tailChars = ctx.tailChars ?? 5000;
    const tail = ctx.output.length > tailChars ? ctx.output.slice(-tailChars) : ctx.output;

    let detail = '';
    let elapsed = '';
    let action = '';
    let exitCode = 124;
    let success = false;
    let hasWarnings = false;

    switch (signal.kind) {
      case 'serverStartedPattern': {
        detail = 'Server-like output detected; auto-terminated to avoid blocking.';
        elapsed = '~startup window';
        action = 'If you intended to start a server, the process is healthy. For a long-running dev server, use the appropriate `pnpm dev` / `npm start` invocation which is handled as long-running.';
        exitCode = 0;
        success = true;
        hasWarnings = true;
        break;
      }
      case 'repeatedSignature': {
        const sec = Math.round(signal.elapsedMs / 1000);
        detail = `Same signature "${signal.signature}" repeated ${signal.repeat}× with no observable progress.`;
        elapsed = `${sec}s`;
        action = 'Continuing the same command will not help. Analyze the repeated error and apply a code fix.';
        break;
      }
      case 'noOutput': {
        const sec = Math.round(signal.silentMs / 1000);
        detail = `No output for ${sec}s. Typically slow filesystem/network walk (find / grep -r / npm ls / git blame / tar / du).`;
        elapsed = `${sec}s`;
        action = 'Use scoped tools instead: `search_code` / `list_files` for file search, `read_file` (supports ranges) for file content, `npm ls --depth=0 <name>` for deps, `git log -L <file>` for history.';
        break;
      }
      case 'hardTimeout': {
        const min = Math.max(1, Math.round(signal.elapsedMs / 60_000));
        detail = `Hard cap of ${min}m reached.`;
        elapsed = `${min}m`;
        action = 'Inspect output below. If this command class is legitimately long, narrow its scope or raise the timeout threshold.';
        break;
      }
    }

    const content = [
      '⚠️ COMMAND TERMINATED BY WATCHDOG',
      `Command: ${ctx.command}`,
      `Reason:  ${signal.kind}`,
      `Detail:  ${detail}`,
      `Elapsed: ${elapsed}`,
      `Action:  ${action}`,
      '',
      `Output (last ${tailChars} chars):`,
      tail,
    ].join('\n');

    return { content, exitCode, success, hasWarnings };
  }
}
