/**
 * run_command handler — context-injected pure execution layer.
 *
 * Terminology (Axis terminology):
 *   - Command Executor = this module. Responsible for spawning shell processes,
 *     streaming stdout/stderr, detecting long-running servers, and emitting
 *     structured side effects (commandExecuted, verificationInvalidated, etc.).
 *   - Command Sequencer = the LLM driving the plan node's tool loop. It
 *     decides WHICH commands to run and in what ORDER; it does NOT spawn
 *     anything directly.
 *
 * This split is intentional: the Executor is deterministic and always
 * present, the Sequencer is stochastic and only active during diagnostic
 * phases. "Retiring the runner" never means retiring the Executor — it
 * refers to moving sequencing responsibility into the Sequencer (LLM).
 *
 * Code-specific policy guards (Go build block, verification guards, etc.)
 * are applied externally via CodeCommandPolicy composition in the registry.
 *
 * Supports both short-lived and long-running commands.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { normalizeToCodebasePath, normalizeRelPath } from '../../../../core/utils/pathNormalizer';
import { splitOnShellOperators, hasActualPipe } from '../../../../core/utils/shellParser';
import { terminateProcessTree } from '../../../../periphery/adapters/command/processTree';
import { cleanCommandEnv } from '../../../../periphery/adapters/command/NodeCommandAdapter';
import { AsyncMutex } from '../../../../core/utils/AsyncMutex';
import {
  lookupInjection,
  buildInjectedResult,
  overlayResult,
  describeInjection,
} from '../../../../utils/commandInject';
import { shouldSkipInstall } from './invalidationScope';
import { checkOrchestratorPortSafeguard } from '../runCommandSafeguards';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants — imported from canonical source to prevent drift
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import {
  LONG_RUNNING_PATTERNS,
  ERROR_PATTERNS,
  COMMAND_TIMEOUT,
  EARLY_ERROR_TIMEOUT,
  STARTUP_VERIFICATION_TIMEOUT,
  COMPILE_RUN_STARTUP_TIMEOUT,
  COMPILE_RUN_PATTERNS,
  SERVER_DETECTION_TIMEOUT,
  SERVER_OUTPUT_PATTERNS,
  ORCHESTRATOR_PORT,
} from '../constants';

const INTERACTIVE_COMMAND_PATTERNS = [
  /\bnpm\s+init\b(?!\s+(-y|--yes))/i,
  /\byarn\s+init\b(?!\s+(-y|--yes))/i,
  /\bgo\s+mod\s+init\s*$/i,
];

const PACKAGE_MANAGER_INSTALL_PATTERNS = [
  /\bnpm\s+(install|i|ci|add)\b/i,
  /\bpnpm\s+(install|i|add)\b/i,
  /\byarn\s+(install|add)\b/i,
  /\byarn\s*$/i,
  /\bgo\s+mod\s+(download|tidy)\b/i,
  /\bgo\s+get\b/i,
  /\bpip\s+install\b/i,
  /\bpoetry\s+install\b/i,
  /\bbundle\s+install\b/i,
  /\bcargo\s+build\b/i,
];

// Flags that signal intent to re-resolve/re-install (e.g. to recover a
// missing optional native binding). These bypass the skip guard because
// `areDepsInstalled` can only observe declared deps.
const REINSTALL_INTENT_FLAG_PATTERNS: RegExp[] = [
  /\s--force\b/,
  /\s--no-frozen-lockfile\b/,
  /\s--frozen-lockfile=false\b/,
  /\s--fix-lockfile\b/,
  /\s--shamefully-hoist\b/,
  /\s-f\b/,
];

function hasReinstallIntentFlag(command: string): boolean {
  return REINSTALL_INTENT_FLAG_PATTERNS.some(p => p.test(command));
}

function isBareInstallCommand(command: string): boolean {
  if (/\bgo\s+mod\s+(tidy|download)\b/i.test(command)) return false;
  if (/\bgo\s+get\b/i.test(command)) return false;
  if (/\bcargo\s+build\b/i.test(command)) return false;
  if (hasReinstallIntentFlag(command)) return false;

  if (/\b(npm|pnpm)\s+(install|i|ci)\s*($|--|-\s)/.test(command)) return true;
  if (/\byarn\s+(install\s*($|--|-\s))/.test(command)) return true;
  if (/\byarn\s*$/.test(command)) return true;
  if (/\bpip\s+install\s+-r\b/.test(command)) return true;
  if (/\bpoetry\s+install\s*($|--|-\s)/.test(command)) return true;
  if (/\bbundle\s+install\s*($|--|-\s)/.test(command)) return true;
  return false;
}

const GO_DEPENDENCY_PATTERN = /\bgo\s+(get|mod\s+tidy|mod\s+download)\b/;

function refreshGoPrivateEnv(command: string, projectPath: string): void {
  if (!GO_DEPENDENCY_PATTERN.test(command)) return;
  const goModPath = path.join(projectPath, 'codebase', 'go.mod');
  try {
    if (!fs.existsSync(goModPath)) return;
    const content = fs.readFileSync(goModPath, 'utf-8');
    const match = content.match(/^module\s+github\.com\/([^/\s]+)\//m);
    if (!match) return;
    const moduleOrg = match[1];
    const pattern = `github.com/${moduleOrg}/*`;
    const current = process.env.GOPRIVATE || '';
    if (!current.includes(pattern)) {
      const updated = current ? `${current},${pattern}` : pattern;
      process.env.GOPRIVATE = updated;
      process.env.GONOSUMCHECK = updated;
      process.env.GONOSUMDB = updated;
      console.log(`   🔒 [RunCommand] Refreshed GOPRIVATE to include ${moduleOrg}: ${updated}`);
    }
  } catch { /* skip */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Write path guard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface WriteViolation { path: string; reason: string; }

function extractWriteTargets(command: string): string[] {
  const targets: string[] = [];
  const cmdPart = command.split(/<<-?\s*['"]?\w+['"]?/)[0] || command;
  const segments = splitOnShellOperators(cmdPart);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    const redirectMatch = trimmed.match(/>{1,2}\s+([^\s;&|><"']+)/);
    if (redirectMatch) targets.push(redirectMatch[1]);

    const mkdirMatch = trimmed.match(/\bmkdir\s+(?:-p\s+)?(.+)/);
    if (mkdirMatch) {
      for (const p of mkdirMatch[1].trim().split(/\s+/)) {
        if (!p.startsWith('-')) targets.push(p);
      }
    }

    const touchMatch = trimmed.match(/\btouch\s+(.+)/);
    if (touchMatch) {
      for (const p of touchMatch[1].trim().split(/\s+/)) {
        if (!p.startsWith('-')) targets.push(p);
      }
    }

    const cpMatch = trimmed.match(/\bcp\s+(?:-[a-zA-Z]+\s+)*(.+)/);
    if (cpMatch) {
      const cpArgs = cpMatch[1].trim().split(/\s+/).filter(a => !a.startsWith('-'));
      if (cpArgs.length >= 2) targets.push(cpArgs[cpArgs.length - 1]);
    }

    const mvMatch = trimmed.match(/\bmv\s+(?:-[a-zA-Z]+\s+)*(.+)/);
    if (mvMatch) {
      const mvArgs = mvMatch[1].trim().split(/\s+/).filter(a => !a.startsWith('-'));
      if (mvArgs.length >= 2) targets.push(mvArgs[mvArgs.length - 1]);
    }
  }

  return targets.filter(t => t && !t.startsWith('$') && !t.includes('`') && !t.startsWith('/dev/'));
}

function detectWritePathViolations(command: string, workingDir: string, projectPath: string): WriteViolation[] {
  const targets = extractWriteTargets(command);
  const violations: WriteViolation[] = [];

  if (/\b(rm|mv|cp|touch|chmod)\b.*\.git\b/.test(command) || />\s*[^\s]*\.git/.test(command)) {
    violations.push({ path: '.git', reason: 'modifying .git files/directories is forbidden' });
  }

  for (const target of targets) {
    const absTarget = path.isAbsolute(target) ? target : path.resolve(workingDir, target);
    const relToProject = normalizeRelPath(path.relative(projectPath, absTarget));

    if (relToProject === '.git' || relToProject.startsWith('.git/') || relToProject.includes('/.git/') || relToProject.includes('/.git')) {
      violations.push({ path: target, reason: 'writing to .git files/directories is forbidden' });
      continue;
    }

    if (relToProject.startsWith('..')) {
      violations.push({ path: target, reason: 'escapes project root via ../ traversal' });
      continue;
    }

    const { normalized, wasFixed } = normalizeToCodebasePath(relToProject);
    if (wasFixed && normalized !== relToProject) {
      violations.push({
        path: target,
        reason: `resolves to "${relToProject}" which is outside codebase/ (would be auto-corrected to "${normalized}")`,
      });
    }
  }

  return violations;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module-level mutex
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const packageManagerMutex = new AsyncMutex();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Policy-rejection `ToolResult` (exitCode: -1 sentinel = "did not execute").
 * The `[Policy]` content prefix + omitted `error` field prevents the
 * tool_result formatter from prepending `Error:` and misleading the LLM
 * into treating an internal guard as a command execution failure.
 */
function makeRejection(command: string, displayText: string): ToolResult {
  return {
    content: `[Policy] ${displayText}`,
    sideEffects: [{ type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false }],
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stall watchdog
//
// The signature-count Map MUST be a per-invocation local (verification
// re-entry re-runs `pnpm build` — leaking counts across runs would
// mis-fire on the first chunk of the second run).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const STALL_GRACE_MS = readPositiveInt(process.env.ANT_STALL_GRACE_MS, 60_000);
export const STALL_REPEAT_THRESHOLD = readPositiveInt(process.env.ANT_STALL_REPEAT_THRESHOLD, 3);

/** Collapses progress counters like "(1/4)" → "(N/N)" so retries match. */
export function normalizeStderrLineSig(line: string): string {
  return line.replace(/\d+/g, 'N').trim().slice(0, 80);
}

const STALL_IGNORE_PREFIXES = ['> ', '$ '];

export function pushLineSig(stallMap: Map<string, number>, line: string): void {
  const sig = normalizeStderrLineSig(line);
  if (!sig) return;
  for (const prefix of STALL_IGNORE_PREFIXES) {
    if (sig.startsWith(prefix)) return;
  }
  stallMap.set(sig, (stallMap.get(sig) ?? 0) + 1);
}

export function detectOutputStall(
  stallMap: Map<string, number>,
  startedAt: number,
  opts: { graceMs?: number; repeatThreshold?: number; now?: number } = {},
): { repeat: number; signature: string } | null {
  const graceMs = opts.graceMs ?? STALL_GRACE_MS;
  const repeatThreshold = opts.repeatThreshold ?? STALL_REPEAT_THRESHOLD;
  const now = opts.now ?? Date.now();
  if (now - startedAt < graceMs) return null;
  let maxCount = 0;
  let maxSig = '';
  for (const [sig, c] of stallMap) {
    if (c > maxCount) { maxCount = c; maxSig = sig; }
  }
  return maxCount >= repeatThreshold ? { repeat: maxCount, signature: maxSig } : null;
}

export const STREAM_COALESCE_MS = 250;

export function createOutputStreamer(
  chatStatus: ToolExecutionContext['chatStatus'],
  command: string,
  getSnapshot: () => string,
) {
  let pending: NodeJS.Timeout | null = null;
  let lastEmitted = '';
  let stopped = false;

  const emit = (): void => {
    if (stopped) return;
    const snapshot = getSnapshot();
    if (snapshot === lastEmitted) return;
    lastEmitted = snapshot;
    void chatStatus.streamCommandOutput(command, snapshot).catch(() => {});
  };

  return {
    schedule(): void {
      if (pending || stopped) return;
      pending = setTimeout(() => { pending = null; emit(); }, STREAM_COALESCE_MS);
    },
    flush(): void {
      if (pending) { clearTimeout(pending); pending = null; }
      emit();
      stopped = true;
    },
  };
}

export async function handleRunCommand(
  ctx: ToolExecutionContext,
  args: { command: string; working_directory?: string; keep_running?: boolean },
): Promise<ToolResult> {
  const isInstall = PACKAGE_MANAGER_INSTALL_PATTERNS.some(p => p.test(args.command));
  if (isInstall) {
    console.log(`🔒 [RunCommand] Package manager command detected — acquiring mutex: ${args.command}`);
    return packageManagerMutex.runExclusive(() => executeCommandLogic(ctx, args));
  }
  return executeCommandLogic(ctx, args);
}

async function executeCommandLogic(
  ctx: ToolExecutionContext,
  args: { command: string; working_directory?: string; keep_running?: boolean },
): Promise<ToolResult> {
  const { command, working_directory, keep_running } = args;
  const commandPort = ctx.command;
  const fileSystem = ctx.fileSystem;

  if (!commandPort) {
    return { content: 'CommandPort not available', error: 'CommandPort not available' };
  }

  const { WorkerFileSystem } = await import('../../../architect/graph/code/parallel/WorkerFileSystem');
  const invalidateBufferedFiles = () => {
    if (fileSystem instanceof WorkerFileSystem) {
      const count = (fileSystem as any).sharedBuffer.invalidateByPrefix('codebase');
      if (count > 0) {
        console.log(`   🔄 [RunCommand] Invalidated ${count} buffered file(s) after shell command`);
      }
    }
  };

  // Safeguards
  checkOrchestratorPortSafeguard(command, ORCHESTRATOR_PORT);

  const isDefinitelyInteractive = INTERACTIVE_COMMAND_PATTERNS.some(p => p.test(command));
  if (isDefinitelyInteractive) {
    console.warn(`\n   ⚠️ [WARNING] Potentially interactive command detected: ${command}`);
    return makeRejection(command, `⚠️ COMMAND MAY HANG: ${command}\n\nThis command typically requires interactive input.\n\n✅ Add -y or --yes flag to skip prompts.`);
  }

  const featureRootPath = fileSystem.getRootPath();

  // Bare-install skip guard — unified with plan-node `recomputeInstallNeeded`
  // via `shouldSkipInstall`. Both paths consult `areDepsInstalled` so the
  // codebase itself (package.json vs node_modules/<name>) is the single
  // source of truth.
  if (isBareInstallCommand(command)) {
    const skipReason = await shouldSkipInstall(featureRootPath);
    if (skipReason) {
      console.log(`📦 [RunCommand] Bare install skipped — all declared dependencies already installed`);
      return makeRejection(command, `SKIPPED: ${skipReason}`);
    }
  }

  const mergeIndex = await ctx.chatStatus.commandStart(command);

  const isLongRunning = LONG_RUNNING_PATTERNS.some(p => p.test(command));
  const isInstallCommand = /\b(npm|pnpm|yarn)\s+(ci|install)\b/.test(command) || /\bgo\s+mod\s+(tidy|download)\b/.test(command);
  const effectiveTimeout = isInstallCommand ? 20 * 60 * 1000 : COMMAND_TIMEOUT;
  const hasShellOperators = /(\|\||&&|;)/.test(command);
  const installEnv = (isInstallCommand && !hasShellOperators) ? { CI: 'true' } : undefined;

  const projectPath = featureRootPath;
  refreshGoPrivateEnv(command, projectPath);

  let workingDir: string;
  if (working_directory) {
    if (path.isAbsolute(working_directory)) {
      workingDir = working_directory;
    } else {
      const { normalized } = normalizeToCodebasePath(working_directory);
      workingDir = path.join(projectPath, normalized);
    }
  } else {
    workingDir = projectPath;
  }

  if (!working_directory && /^\s*go\s+/.test(command)) {
    const codebasePath = path.join(projectPath, 'codebase');
    if (fs.existsSync(path.join(codebasePath, 'go.mod'))) {
      workingDir = codebasePath;
      console.log(`   📁 [RunCommand] Auto-corrected working_directory to codebase/ for go command`);
    }
  }

  const writeViolations = detectWritePathViolations(command, workingDir, projectPath);
  if (writeViolations.length > 0) {
    const msg = writeViolations.map(v => `  - "${v.path}" → ${v.reason}`).join('\n');
    console.error(`\n   ❌ [run_command] Write path violation detected:\n${msg}\n`);
    return makeRejection(command,
      `❌ COMMAND REJECTED: File write targets outside codebase/ directory.\n\nViolations:\n${msg}\n\nAll file writes must target paths under codebase/.`);
  }

  console.log(`\n   🔧 Running command: ${command}`);
  console.log(`   📁 Working directory: ${workingDir}`);
  if (isLongRunning) {
    console.log(`   ⏱️  Long-running command detected\n`);
  } else {
    console.log('');
  }

  let streamedStdout = '';
  let streamedStderr = '';

  const sideEffects: ToolSideEffect[] = [];
  let streamer: OutputStreamer | null = null;

  try {
    // Long-running command path
    if (isLongRunning) {
      if (!commandPort.isAllowed(command)) {
        return makeRejection(command, `❌ COMMAND NOT ALLOWED: ${command}\n\nOnly whitelisted commands are permitted.`);
      }
      try {
        const longRunResult = await handleLongRunningCommand(
          ctx, command, workingDir, mergeIndex || 0, Boolean(keep_running),
        );
        const longRunSuccess = longRunResult.displayText.startsWith('✅');
        sideEffects.push({ type: 'commandExecuted', exitCode: longRunSuccess ? 0 : 1, command, success: longRunSuccess, hasWarnings: false });
        if (longRunResult.serverPid) {
          sideEffects.push({ type: 'serverStarted', pid: longRunResult.serverPid, command, workingDir });
        }
        return { content: longRunResult.displayText, sideEffects };
      } catch (err) {
        sideEffects.push({ type: 'commandExecuted', exitCode: 1, command, success: false, hasWarnings: false });
        return { content: (err as Error).message, error: (err as Error).message, sideEffects };
      }
    }

    // Normal command path
    let serverDetectionTimer: NodeJS.Timeout | null = null;

    // Fault injection overlay (test harness only — no-op in production).
    // Must be checked BEFORE commandPort.execute so 'stub' mode can skip it
    // entirely. See docs/testing/verification-scenarios.md.
    const injection = lookupInjection(command);
    if (injection) {
      console.log(describeInjection(injection, command));
      if (injection.mode === 'stub') {
        const injected = buildInjectedResult(injection.rule);
        if (injected.stdout) { streamedStdout += injected.stdout; console.log(injected.stdout); }
        if (injected.stderr) { streamedStderr += injected.stderr; console.error(injected.stderr); }
        console.log(`   Exit code: ${injected.exitCode}`);
        // Construct a shape compatible with commandPort.execute's return.
        const stubbedPromise = Promise.resolve(injected);
        const raceResult = await stubbedPromise.then(r => ({ type: 'completed' as const, result: r }));
        invalidateBufferedFiles();
        const r = raceResult.result;
        const output = r.stdout + r.stderr;
        sideEffects.push({ type: 'commandExecuted', exitCode: r.exitCode, command, success: r.success, hasWarnings: false });
        await ctx.chatStatus.commandComplete(command, r.success, r.exitCode, output, mergeIndex);
        return {
          content: r.success
            ? `✅ COMMAND SUCCEEDED: ${command}\nExit Code: ${r.exitCode}\n\nOutput:\n${output}`
            : `❌ COMMAND FAILED: ${command}\nExit Code: ${r.exitCode}\n\n📋 ERROR OUTPUT:\n${output}`,
          error: r.success ? undefined : output,
          sideEffects,
        };
      }
      // 'overlay' mode falls through to real execution; result is rewritten below.
    }

    streamer = createOutputStreamer(ctx.chatStatus, command, () => streamedStdout + streamedStderr);
    const stallMap = new Map<string, number>();
    const commandStartedAt = Date.now();
    let stallCheckTimer: NodeJS.Timeout | null = null;

    const onChunkCommon = (chunk: string) => {
      for (const line of chunk.split('\n')) pushLineSig(stallMap, line);
      streamer!.schedule();
    };

    const commandPromise = commandPort.execute(command, {
      cwd: workingDir,
      timeout: effectiveTimeout,
      env: installEnv,
      onStdout: (chunk: string) => { streamedStdout += chunk; console.log(chunk); onChunkCommon(chunk); },
      onStderr: (chunk: string) => { streamedStderr += chunk; console.error(chunk); onChunkCommon(chunk); },
      onExit: (code: number) => {
        console.log(`   Exit code: ${code}`);
        if (serverDetectionTimer) { clearTimeout(serverDetectionTimer); serverDetectionTimer = null; }
        if (stallCheckTimer) { clearInterval(stallCheckTimer); stallCheckTimer = null; }
      },
    });

    const serverDetectionPromise = new Promise<'server_detected'>((resolve) => {
      serverDetectionTimer = setTimeout(() => {
        const allOutput = streamedStdout + streamedStderr;
        if (SERVER_OUTPUT_PATTERNS.test(allOutput)) {
          console.warn(`\n   ⚠️  [Server Detection] Command running >${SERVER_DETECTION_TIMEOUT / 1000}s with server-like output\n`);
          resolve('server_detected');
        }
      }, SERVER_DETECTION_TIMEOUT);
    });

    const stallPromise = new Promise<{ repeat: number; signature: string }>((resolve) => {
      stallCheckTimer = setInterval(() => {
        const stall = detectOutputStall(stallMap, commandStartedAt);
        if (stall) {
          if (stallCheckTimer) { clearInterval(stallCheckTimer); stallCheckTimer = null; }
          resolve(stall);
        }
      }, 15_000);
    });

    const raceResult = await Promise.race([
      commandPromise.then(r => ({ type: 'completed' as const, result: r })),
      serverDetectionPromise.then(() => ({ type: 'server_detected' as const })),
      stallPromise.then(stall => ({ type: 'stall_detected' as const, stall })),
    ]);

    if (serverDetectionTimer) { clearTimeout(serverDetectionTimer); serverDetectionTimer = null; }
    if (stallCheckTimer) { clearInterval(stallCheckTimer); stallCheckTimer = null; }

    if (raceResult.type === 'stall_detected') {
      invalidateBufferedFiles();
      const allOutput = streamedStdout + streamedStderr;
      const elapsedSec = Math.round((Date.now() - commandStartedAt) / 1000);
      console.warn(`\n   ⚠️  [Watchdog] Stalled: "${raceResult.stall.signature}" repeated ${raceResult.stall.repeat}× over ${elapsedSec}s — terminating early\n`);
      commandPromise.catch(() => {});
      streamer!.flush();
      await ctx.chatStatus.commandComplete(command, false, 124, `Stall watchdog terminated command\n\nOutput:\n${allOutput}`, mergeIndex);
      sideEffects.push({ type: 'commandExecuted', exitCode: 124, command, success: false, hasWarnings: false });
      const tailChars = 5000;
      const tail = allOutput.length > tailChars ? allOutput.slice(-tailChars) : allOutput;
      return {
        content: `⚠️ COMMAND STALLED: ${command}\n\n[Watchdog] Terminated early: the same error signature repeated ${raceResult.stall.repeat}× over ${elapsedSec}s with no observable progress.\nContinuing the same command will not help — analyze the repeated error below and apply a code fix.\n\nOutput captured (last ${tailChars} chars):\n${tail}`,
        error: allOutput,
        sideEffects,
      };
    }

    if (raceResult.type === 'server_detected') {
      invalidateBufferedFiles();
      const allOutput = streamedStdout + streamedStderr;
      commandPromise.catch(() => {});
      streamer!.flush();
      await ctx.chatStatus.commandComplete(command, true, 0, `Server detected (auto-terminated)\n\nOutput:\n${allOutput}`, mergeIndex);
      sideEffects.push({ type: 'commandExecuted', exitCode: 0, command, success: true, hasWarnings: true });

      return {
        content: `⚠️ LONG-RUNNING SERVER DETECTED: ${command}\n\nThe command appears to be a long-running server process.\nIt was auto-terminated to prevent blocking.\n\nOutput captured:\n${allOutput.slice(0, 3000)}${allOutput.length > 3000 ? '\n...(truncated)' : ''}\n\n✅ The server started successfully.`,
        sideEffects,
      };
    }

    // Normal completion
    const result = raceResult.result;
    let { stdout, stderr, exitCode, success } = result;

    // Overlay injection: real command ran, now apply rule to override signals.
    if (injection && injection.mode === 'overlay') {
      const overlay = overlayResult({ stdout, stderr, exitCode: exitCode ?? 0, success }, injection.rule);
      stdout = overlay.stdout;
      stderr = overlay.stderr;
      exitCode = overlay.exitCode;
      success = overlay.success;
      console.log(`🧪 [CommandInject][overlay] real exit=${result.exitCode} → overridden exit=${exitCode}`);
    }

    const output = stdout + stderr;

    if (!success && exitCode === 141 && hasActualPipe(command)) {
      console.log(`\n   ℹ️  SIGPIPE (exit 141) in piped command — treating as success\n`);
      success = true;
      exitCode = 0;
    }

    invalidateBufferedFiles();

    if (success) {
      console.log(`\n   ✅ Command succeeded (exit code: ${exitCode})\n`);
    } else {
      console.error(`\n   ❌ Command failed (exit code: ${exitCode})\n`);
    }

    streamer!.flush();
    await ctx.chatStatus.commandComplete(command, success, exitCode, output, mergeIndex);

    if (!success) {
      sideEffects.push({ type: 'commandExecuted', exitCode: exitCode ?? 1, command, success: false, hasWarnings: false });
      return {
        content: `❌ COMMAND FAILED: ${command}\nExit Code: ${exitCode}\n\n📋 ERROR OUTPUT:\n${output}\n\n⚠️  You MUST read the error above and fix the specific issue mentioned.\nDO NOT guess - the error tells you exactly what's wrong.`,
        error: output,
        sideEffects,
      };
    }

    // False-positive success detection
    const criticalErrorPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /command not found/i, label: 'command not found' },
      { pattern: /EADDRINUSE|address already in use/i, label: 'port already in use' },
      { pattern: /connection refused/i, label: 'connection refused' },
      { pattern: /panic:/i, label: 'runtime panic' },
      { pattern: /FATAL|fatal error/i, label: 'fatal error' },
      { pattern: /segmentation fault/i, label: 'segmentation fault' },
      { pattern: /out of memory/i, label: 'out of memory' },
    ];

    const detectedIssues = criticalErrorPatterns
      .filter(({ pattern }) => pattern.test(stderr) || pattern.test(stdout))
      .map(({ label }) => label);

    const hasWarnings = detectedIssues.length > 0;
    sideEffects.push({ type: 'commandExecuted', exitCode: 0, command, success: true, hasWarnings });

    if (hasWarnings) {
      console.warn(`\n   ⚠️  Command exit code 0 but output contains errors: ${detectedIssues.join(', ')}\n`);
      return {
        content: `⚠️ COMMAND SUCCEEDED (exit code 0) BUT OUTPUT CONTAINS ERRORS: ${command}\n\n⚠️ DETECTED ISSUES IN OUTPUT:\n${detectedIssues.map(i => `- ${i}`).join('\n')}\n\nFull Output:\n${output}\n\nWARNING: Exit code was 0 but the output contains error indicators.`,
        sideEffects,
      };
    }

    const hasOutput = output.trim().length > 0;
    return {
      content: hasOutput
        ? `✅ COMMAND SUCCEEDED: ${command}\nExit Code: 0\n\nOutput:\n${output}`
        : `✅ COMMAND SUCCEEDED: ${command}\nExit Code: 0\n(No output)`,
      sideEffects,
    };
  } catch (error) {
    invalidateBufferedFiles();
    streamer?.flush();
    const errorMessage = (error as Error).message;
    console.error(`\n   ❌ Command execution error: ${errorMessage}\n`);
    await ctx.chatStatus.commandComplete(command, false, -1, errorMessage, mergeIndex);

    sideEffects.push({ type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false });
    return {
      content: `❌ COMMAND EXECUTION ERROR: ${command}\nError: ${errorMessage}\n\nCaptured output:\n${streamedStdout}\n${streamedStderr}`,
      error: errorMessage,
      sideEffects,
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Long-running command handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type OutputStreamer = ReturnType<typeof createOutputStreamer>;

async function handleLongRunningCommand(
  ctx: ToolExecutionContext,
  command: string,
  workingDir: string,
  mergeIndex: number,
  keepRunning: boolean,
): Promise<{ displayText: string; serverPid?: number }> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const streamer = createOutputStreamer(ctx.chatStatus, command, () => stdout + stderr);
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    console.log(`   🐚 Spawning: ${shell} ${shellArgs[0]} "${command}"`);

    const child = spawn(shell, shellArgs, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanCommandEnv(),
      detached: process.platform !== 'win32',
    });

    console.log(`   📋 Process spawned with PID: ${child.pid}`);

    let hasError = false;
    let resolved = false;

    const safeResolve = async (message: string, shouldKill = false, pid?: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      clearTimeout(earlyErrorTimeout);
      streamer.flush();
      if (shouldKill) {
        if (child.pid) await terminateProcessTree(child.pid);
        else child.kill('SIGTERM');
      }
      resolve({ displayText: message, serverPid: pid });
    };

    const safeReject = async (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      clearTimeout(earlyErrorTimeout);
      streamer.flush();
      if (child.pid) await terminateProcessTree(child.pid);
      else child.kill('SIGTERM');
      reject(error);
    };

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log(chunk);
      streamer.schedule();
      if (ERROR_PATTERNS.test(chunk)) hasError = true;
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.error(chunk);
      streamer.schedule();
      if (ERROR_PATTERNS.test(chunk)) hasError = true;
    });

    child.on('error', (err) => {
      hasError = true;
      stderr += err.message;
      safeReject(new Error(`❌ FAILED TO SPAWN PROCESS: ${command}\n\nSpawn error: ${err.message}`));
    });

    const earlyErrorTimeout = setTimeout(() => {
      if (hasError) {
        ctx.chatStatus.commandComplete(command, false, 1, `Early error:\n${stderr}\n${stdout}`, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}\n\nEarly startup failure detected.\n\nError output:\n${stderr.slice(0, 2000)}`));
      }
    }, EARLY_ERROR_TIMEOUT);

    const isCompileRun = COMPILE_RUN_PATTERNS.some(p => p.test(command));
    const effectiveStartupTimeout = isCompileRun ? COMPILE_RUN_STARTUP_TIMEOUT : STARTUP_VERIFICATION_TIMEOUT;

    const startupTimeout = setTimeout(async () => {
      if (!hasError && child.exitCode === null) {
        console.log(`\n   ✅ Server process started, verifying page render...`);

        const portMatch = stdout.match(/localhost:(\d+)|port\s+(\d+)|:(\d{4,5})\b/i);
        const port = portMatch ? (portMatch[1] || portMatch[2] || portMatch[3]) : '3000';

        let httpTestResult: { ok: boolean; error?: string } = { ok: true };
        try {
          const http = await import('http');
          const attemptHttpTest = (): Promise<{ ok: boolean; error?: string }> =>
            new Promise((resolveHttp) => {
              const req = http.request({
                hostname: 'localhost', port: parseInt(port), path: '/', method: 'GET', timeout: 30000,
              }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => body += chunk);
                res.on('end', () => {
                  const status = res.statusCode ?? 0;
                  if (status >= 200 && status < 400) resolveHttp({ ok: true });
                  else {
                    const errorMatch = body.match(/Error:([^<]+)/i) || body.match(/<pre>([^<]+)<\/pre>/i);
                    resolveHttp({ ok: false, error: errorMatch ? errorMatch[1].trim().slice(0, 500) : `HTTP ${status}` });
                  }
                });
              });
              req.on('error', (err: any) => resolveHttp({ ok: false, error: err.message }));
              req.on('timeout', () => { req.destroy(); resolveHttp({ ok: false, error: 'Request timed out' }); });
              req.end();
            });

          for (let attempt = 1; attempt <= 3; attempt++) {
            const result = await attemptHttpTest();
            if (result.ok) { httpTestResult = result; break; }
            if (attempt < 3) {
              console.log(`   ⏳ HTTP test attempt ${attempt}/3 failed: ${result.error} — retrying...`);
              await new Promise(r => setTimeout(r, 5000));
            } else httpTestResult = result;
          }
        } catch { /* skip */ }

        if (!httpTestResult.ok && httpTestResult.error) {
          await ctx.chatStatus.commandComplete(command, false, 1,
            `Server started but page render failed!\n\n❌ HTTP Test Failed: ${httpTestResult.error}`, mergeIndex);
          safeReject(new Error(`❌ SERVER STARTED BUT PAGE RENDER FAILED: ${command}\n\nHTTP Test Error: ${httpTestResult.error}\n\nStartup output:\n${stdout.slice(0, 1500)}`));
          return;
        }

        console.log(`   ✅ Page rendered successfully`);

        const outputMsg = keepRunning
          ? `Server started successfully.\n\nStartup output:\n${stdout}\n\n✅ Server is running in background (PID: ${child.pid}).`
          : `Server started successfully.\n\nStartup output:\n${stdout}\n\n✅ Server was terminated after verification.`;

        await ctx.chatStatus.commandComplete(command, true, 0, outputMsg, mergeIndex);

        const displayText = `✅ SERVER STARTED SUCCESSFULLY: ${command}\n\n✅ HTTP verification passed\n\nStartup output:\n${stdout.slice(0, 2000)}${stdout.length > 2000 ? '\n...(truncated)' : ''}`;

        if (keepRunning) {
          safeResolve(displayText, false, child.pid);
        } else {
          safeResolve(displayText, true);
        }
      } else if (hasError) {
        await ctx.chatStatus.commandComplete(command, false, 1, `Error:\n${stderr}\n${stdout}`, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}\n\nError:\n${stderr.slice(0, 2000)}`));
      }
    }, effectiveStartupTimeout);

    child.on('exit', async (code, signal) => {
      const output = stdout + stderr;
      if (code === 0 && !hasError) {
        await ctx.chatStatus.commandComplete(command, true, 0, output, mergeIndex);
        safeResolve(`✅ Command completed: ${command}\n\nOutput:\n${output.slice(0, 3000)}`, true);
      } else {
        await ctx.chatStatus.commandComplete(command, false, code || 1, output, mergeIndex);
        safeReject(new Error(`❌ SERVER FAILED TO START: ${command}\n\nExit code: ${code || 'killed'}\nSignal: ${signal || 'none'}\n\nError output:\n${stderr.slice(0, 2000)}`));
      }
    });
  });
}

// Re-export utilities needed by Code command policy
export { isBareInstallCommand, PACKAGE_MANAGER_INSTALL_PATTERNS };
