/**
 * run_command handler — context-injected pure execution layer.
 *
 * Terminology (Axis terminology):
 *   - Command Executor = this module. Responsible for spawning shell processes,
 *     streaming stdout/stderr, detecting long-running servers, and emitting
 *     structured side effects (commandExecuted, serverStarted, etc.).
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
type Gate = string;
import { normalizeToCodebasePath, normalizeRelPath } from '../../../../core/utils/pathNormalizer';
import { splitOnShellOperators, hasActualPipe, tokenizeShellSegment, maskQuotedRegions } from '../../../../core/utils/shellParser';
import { terminateProcessTree } from '../../../../periphery/adapters/command/processTree';
import { getDefaultDevProcessControl } from '../../../../core/process/DevProcessControl';
import { cleanCommandEnv } from '../../../../periphery/adapters/command/NodeCommandAdapter';
import { childSpawnIdentity, assertUserCodeIsolationOrThrow } from '../../../../core/config/childIdentity';
import { AsyncMutex } from '../../../../core/utils/AsyncMutex';
import {
  lookupInjection,
  buildInjectedResult,
  overlayResult,
  describeInjection,
} from '../../../../utils/commandInject';
import { shouldSkipInstall } from './invalidationScope';
import {
  appendVitestMaxWorkers,
  buildSpawnEnv,
  deriveTestWorkers,
  readCgroupCpuLimit,
  readCgroupMemoryLimit,
  readCgroupMemoryUsage,
  resolveHeapCapMb,
  isTestCommand,
  logResourceCapsOnce,
} from './commandResourceLimits';
import { enforceManifestPinPolicyForInstall } from './manifestPinPolicy';
import { checkOrchestratorPortSafeguard } from '../runCommandSafeguards';
import { detectCacheReplay } from '../../../architect/graph/code/tasks/_shared/verify/cacheReplay';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Constants — imported from canonical source to prevent drift
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import {
  LONG_RUNNING_PATTERNS,
  STARTUP_VERIFICATION_TIMEOUT,
  COMPILE_RUN_STARTUP_TIMEOUT,
  COMPILE_RUN_PATTERNS,
  SERVER_OUTPUT_PATTERNS,
  ORCHESTRATOR_PORT,
} from '../constants';
import { probeHttp } from '../../../../infrastructure/ide/readiness';
import {
  ProgressSupervisor,
  type SupervisorThresholds,
  readPositiveInt,
  DEFAULT_REPEAT_GRACE_MS,
  DEFAULT_REPEAT_THRESHOLD,
  DEFAULT_NO_OUTPUT_MS,
  DEFAULT_SERVER_DETECTION_MS,
} from './progressSupervisor';

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

/**
 * Shell redirection prefix: `2>`, `>`, `>>`, `<`, `<<`, `&>`, etc.
 * A token that begins with one of these is part of an I/O redirection,
 * not a positional argument to the install verb.
 */
const REDIRECT_TOKEN_RE = /^(\d*[<>]|&[<>])/;

/**
 * Whether a package-manager install verb is followed by any positional
 * (non-flag) argument inside the same shell segment. Used to distinguish
 * `npm install` (no targets → candidate for skip-guard) from
 * `npm install --save-dev jest` (explicit package target → must run).
 *
 * We tokenize the verb's own segment (everything up to the next `|`,
 * `&&`, `||`, or `;`) so downstream commands do not leak their
 * positional args into the decision.
 */
function hasPositionalInstallArg(command: string, verb: RegExp): boolean {
  const segments = splitOnShellOperators(command);
  const segment = segments.find(s => verb.test(s));
  if (!segment) return false;
  const m = verb.exec(segment);
  if (!m) return false;

  const afterVerb = segment.slice(m.index + m[0].length);
  for (const token of tokenizeShellSegment(afterVerb)) {
    if (!token) continue;
    if (token.startsWith('-')) continue;
    if (REDIRECT_TOKEN_RE.test(token)) continue;
    return true;
  }
  return false;
}

/**
 * "Bare install" = an install command that does not add specific packages.
 * Flags are allowed (`--silent`, `--save-dev` without a target package,
 * etc.); positional package names disqualify the command. Package managers
 * with a dedicated "install declared deps" incantation (`pip install -r`)
 * are treated as bare.
 *
 * Reinstall-intent flags (`--force`, `--no-frozen-lockfile`, ...) also
 * disqualify because the caller explicitly wants a re-resolve regardless
 * of the already-installed state.
 */
function isBareInstallCommand(command: string): boolean {
  if (/\bgo\s+mod\s+(tidy|download)\b/i.test(command)) return false;
  if (/\bgo\s+get\b/i.test(command)) return false;
  if (/\bcargo\s+build\b/i.test(command)) return false;
  if (hasReinstallIntentFlag(command)) return false;

  // Verbs whose bare-ness depends on the absence of positional targets.
  const verbs: RegExp[] = [
    /\b(npm|pnpm)\s+(install|i|ci)\b/,
    /\byarn\s+install\b/,
    /\bpoetry\s+install\b/,
    /\bbundle\s+install\b/,
  ];
  for (const verb of verbs) {
    if (verb.test(command)) {
      return !hasPositionalInstallArg(command, verb);
    }
  }

  // Bare `yarn` defaults to `yarn install` in yarn-classic projects.
  if (/\byarn\s*$/.test(command)) return true;
  // pip: only the `-r <file>` form is a declared-deps install.
  if (/\bpip\s+install\s+-r\b/.test(command)) return true;
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

const WRITE_VERBS = new Set(['mkdir', 'touch', 'cp', 'mv']);

/**
 * Strip surrounding shell quoting from one token produced by
 * `tokenizeShellSegment`, reporting whether any part was double-quoted.
 * Backslash escapes outside single quotes take the next char literally.
 */
function unquoteToken(tok: string): { value: string; hadDoubleQuote: boolean; hadSingleQuote: boolean } {
  let value = '';
  let hadDoubleQuote = false;
  let hadSingleQuote = false;
  let i = 0;
  while (i < tok.length) {
    const ch = tok[i];
    if (ch === "'") {
      hadSingleQuote = true;
      const end = tok.indexOf("'", i + 1);
      if (end === -1) { value += tok.slice(i + 1); i = tok.length; }
      else { value += tok.slice(i + 1, end); i = end + 1; }
      continue;
    }
    if (ch === '"') {
      hadDoubleQuote = true;
      let j = i + 1;
      while (j < tok.length) {
        if (tok[j] === '\\' && j + 1 < tok.length) { value += tok[j + 1]; j += 2; }
        else if (tok[j] === '"') { j++; break; }
        else { value += tok[j]; j++; }
      }
      i = j;
      continue;
    }
    if (ch === '\\' && i + 1 < tok.length) { value += tok[i + 1]; i += 2; continue; }
    value += ch;
    i++;
  }
  return { value, hadDoubleQuote, hadSingleQuote };
}

interface ExtractedWrites { targets: string[]; unsafe: string[] }

/**
 * Extract candidate write targets (redirects, mkdir/touch args, cp/mv
 * destinations) from a command.
 *
 * Tokenization is quote-aware end to end: `splitOnShellOperators` and
 * `tokenizeShellSegment` both respect quoting, so a quoted path with spaces
 * ("스크린샷 … .png") survives as ONE token and its real value is checked.
 * The previous implementation regex-matched the maskQuotedRegions() string,
 * whose blanked quote interiors split every quoted argument into bare `"`
 * tokens — rejecting legitimate `cp "…" codebase/…` calls with garbage
 * violations (zinc-bracing-gavel). Per-token masking is still used so a `>`
 * inside a quoted JS literal (`node -e "() => {…}"`) is never read as a
 * redirect.
 *
 * `unsafe` carries double-quoted targets containing `$`/backtick (shell would
 * expand them, so their literal value is unknowable) — the caller rejects
 * them, preserving the old parser's accidental fail-closed behavior for
 * quoted expansions. Unquoted `$VAR`/backtick targets keep their historical
 * skip semantics.
 */
function extractWriteTargetsDetailed(command: string): ExtractedWrites {
  const targets: string[] = [];
  const unsafe: string[] = [];
  const cmdPart = command.split(/<<-?\s*['"]?\w+['"]?/)[0] || command;
  const segments = splitOnShellOperators(cmdPart);

  const pushTarget = (tok: string): void => {
    const { value, hadDoubleQuote, hadSingleQuote } = unquoteToken(tok);
    if (!value) return;
    if (value.startsWith('&')) return; // fd duplication (`2>&1`), not a file
    if (value.includes('`') || /\$/.test(value)) {
      if (hadDoubleQuote) { unsafe.push(value); return; }
      // Single-quoted `$`/backtick is literal — check it as a real path.
      // Unquoted expansions keep the historical skip (never resolvable here).
      if (!hadSingleQuote) return;
    }
    if (value.startsWith('/dev/')) return;
    targets.push(value);
  };

  for (const seg of segments) {
    const tokens = tokenizeShellSegment(seg.trim());
    if (tokens.length === 0) continue;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      // Redirect operators: mask quoting inside the token first so quoted
      // `>` characters can never look like operators.
      const masked = maskQuotedRegions(tok);
      const opOnly = masked.match(/^\d*(>{1,2})$/);
      if (opOnly) {
        if (tokens[i + 1]) pushTarget(tokens[i + 1]);
        i++;
        continue;
      }
      const opAttached = masked.match(/^\d*(>{1,2})(?=\S)/);
      if (opAttached) {
        pushTarget(tok.slice(opAttached[0].length));
        continue;
      }
    }

    // Write verbs: first unquoted token occurrence; remaining non-flag
    // tokens are its args.
    const verbIdx = tokens.findIndex(t => WRITE_VERBS.has(t));
    if (verbIdx === -1) continue;
    const verb = tokens[verbIdx];
    const argToks = tokens.slice(verbIdx + 1)
      .filter(t => !t.startsWith('-') && !maskQuotedRegions(t).match(/^\d*>{1,2}/));
    if (verb === 'mkdir' || verb === 'touch') {
      for (const t of argToks) pushTarget(t);
    } else if (argToks.length >= 2) {
      // cp/mv: the last argument is the destination.
      pushTarget(argToks[argToks.length - 1]);
    }
  }

  return { targets, unsafe };
}

function extractWriteTargets(command: string): string[] {
  return extractWriteTargetsDetailed(command).targets;
}

function detectWritePathViolations(command: string, workingDir: string, projectPath: string): WriteViolation[] {
  const { targets, unsafe } = extractWriteTargetsDetailed(command);
  const violations: WriteViolation[] = [];

  // Fail-closed for quoted shell expansions: a double-quoted write target
  // containing `$`/backtick expands at runtime to a value this guard cannot
  // see. The old masked parser rejected these by accident; keep rejecting
  // them on purpose.
  for (const u of unsafe) {
    violations.push({ path: u, reason: 'write target contains a shell expansion (`$…`/backtick) whose value cannot be verified — use a literal path' });
  }

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

/**
 * Single mutex covering both install commands AND dependency-manifest
 * writes. Exported so `editFile.ts` / `createFile.ts` can wrap their
 * manifest-write critical section in `packageManagerMutex.runExclusive`,
 * making "snapshot scan + violation check + actual write" atomic with
 * respect to concurrent install commands. Without the shared mutex two
 * parallel setup workers (different `packageGroup`) could each scan
 * before the other's write commits, both pass the conflict check, and
 * land different specs on disk.
 *
 * R5 — single instance per process; `editFile` / `createFile` /
 * `runCommand` MUST import from this module (no parallel mutex
 * declarations elsewhere).
 */
export const packageManagerMutex = new AsyncMutex();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Policy-rejection `ToolResult` (exitCode: -1 sentinel = "did not execute").
 * The `[Policy]` content prefix + omitted `error` field prevents the
 * tool_result formatter from prepending `Error:` and misleading the LLM
 * into treating an internal guard as a command execution failure.
 *
 * Always routes the rejection through `chatStatus.commandComplete` so
 * chat.jsonl receives exactly one `run_command` line per invocation —
 * success, non-zero exit, or rejection. No separate rejection line type;
 * the -1 sentinel + `[Policy] ...` prefix in stdout identify rejections
 * for downstream readers.
 */
/**
 * Shell constructs the allowlist still rejects after loops/conditionals were
 * admitted (keyword-aware head validation in NodeCommandAdapter): `case`
 * pattern arms cannot be head-validated by a stateless segmenter, `select`
 * is interactive, function definitions and `[[`/`{` groups stay fail-closed.
 * Used only to make the rejection message name the construct.
 */
const UNSUPPORTED_SHELL_CONSTRUCTS = new Set(['case', 'select', 'function', '[[', '{']);

const NFD_MISS_SIGNATURE = /no such file or directory|not found|cannot (?:stat|open|access)|does not exist/i;

/**
 * One-line hint appended to run_command results that look like a byte-match
 * miss while the command names normalization-sensitive text (Hangul/accents):
 * on-disk names/content from macOS uploads are NFD while the model types NFC —
 * visually identical, byte-different — so find/grep/cmp miss files that
 * visibly exist (navy-dropping-crowd). The command itself is NEVER normalized
 * (byte-faithful arguments are legitimate); this only annotates the result.
 */
export function nfdCommandHint(command: string, output: string, success: boolean): string {
  if (command.normalize('NFC') === command.normalize('NFD')) return '';
  const isMiss = success
    ? output.trim().length === 0
    : output.trim().length === 0 || NFD_MISS_SIGNATURE.test(output);
  if (!isMiss) return '';
  return (
    '\n\n💡 Unicode note: this command names non-ASCII paths/text. On-disk filenames and file ' +
    'content may be NFD-encoded (macOS uploads) while your text is NFC — visually identical but ' +
    'byte-different, so exact shell matching can miss a file that exists. Use list_files / ' +
    'search_code (both NFC-tolerant) to locate it, or match via glob wildcards instead of typing the name.'
  );
}

async function makeRejection(
  ctx: ToolExecutionContext,
  command: string,
  displayText: string,
  _cardId: string | undefined,
  verifies?: Gate,
): Promise<ToolResult> {
  const content = `[Policy] ${displayText}`;
  await ctx.chatStatus.commandComplete(command, false, -1, content);
  return {
    content,
    sideEffects: [makeCommandExecuted({ exitCode: -1, command, success: false, hasWarnings: false, verifies })],
  };
}

/**
 * Single-call constructor for the `commandExecuted` side effect. Centralises
 * the `verifies` propagation so every `runCommand` exit path (early
 * rejection, long-run, stub, stall, server-detected, completion, error)
 * carries the LLM's gate-intent declaration into the verification session
 * via `tasks/_shared/verify/toolHook.ts::onEvent`.
 *
 * `verifies` is optional — non-gate commands (install, ls, cat, edits)
 * legitimately omit it.
 */
function makeCommandExecuted(input: {
  exitCode: number;
  command: string;
  success: boolean;
  hasWarnings: boolean;
  verifies?: Gate;
  cacheReplayed?: boolean;
}): ToolSideEffect {
  const { exitCode, command, success, hasWarnings, verifies, cacheReplayed } = input;
  const effect: ToolSideEffect = { type: 'commandExecuted', exitCode, command, success, hasWarnings };
  if (verifies) (effect as { verifies?: Gate }).verifies = verifies;
  if (cacheReplayed) (effect as { cacheReplayed?: boolean }).cacheReplayed = true;
  return effect;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Watchdog thresholds — single resolver for ProgressSupervisor
//
// Watchdog signal logic lives in ./progressSupervisor.ts. This handler only
// resolves the per-invocation thresholds (install commands get a longer
// noOutput / hardTimeout window because cold installs can legitimately
// stall for minutes between banner lines).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HARD_TIMEOUT_DEFAULT_MS = 10 * 60_000;
const HARD_TIMEOUT_INSTALL_MS = 20 * 60_000;
const NO_OUTPUT_INSTALL_MS = 5 * 60_000;
// Build/test gates legitimately go silent for minutes (Next.js bundling, Rust
// codegen, Vitest run before first test prints, etc.). DEFAULT_NO_OUTPUT_MS
// (60s) was tripping them; 180s aligns with observed Next.js cold-build
// timings. Tune via ANT_NO_OUTPUT_BUILD_MS.
const NO_OUTPUT_BUILD_DEFAULT_MS = 3 * 60_000;
const INSTALL_COMMAND_RE = /\b(npm|pnpm|yarn)\s+(ci|install)\b/;
const GO_DEPENDENCY_COMMAND_RE = /\bgo\s+mod\s+(tidy|download)\b/;
const BUILD_COMMAND_RE =
  /\b(?:next\s+build|vite\s+build|tsc(?:\s+-p\b|\s+--build\b|\s*$)|vitest\s+run|jest(?:\s|$)|playwright\s+test|go\s+build|cargo\s+build|turbo\s+run\s+build|npm\s+run\s+build|pnpm\s+(?:run\s+)?build|yarn\s+(?:run\s+)?build|npm\s+test|pnpm\s+test|yarn\s+test|npm\s+run\s+typecheck|pnpm\s+(?:run\s+)?typecheck)\b/;

function isLikelyInstallCommand(command: string): boolean {
  return INSTALL_COMMAND_RE.test(command) || GO_DEPENDENCY_COMMAND_RE.test(command);
}

function isLikelyBuildCommand(command: string): boolean {
  return BUILD_COMMAND_RE.test(command);
}

const ONESHOT_POST_OUTPUT_IDLE_MS = 3_000;

// memoryBudget fires when sampled container memory crosses this fraction of the
// cgroup limit — below the kernel's 100% OOM-kill so the watchdog aborts the
// command first. Tune via ANT_CMD_MEMORY_HIGH_PCT (percent, e.g. 85).
const MEMORY_HIGH_FRACTION_DEFAULT = 0.85;

function memoryHighFraction(env: NodeJS.ProcessEnv = process.env): number {
  const pct = Number.parseInt(env.ANT_CMD_MEMORY_HIGH_PCT ?? '', 10);
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct / 100 : MEMORY_HIGH_FRACTION_DEFAULT;
}

function resolveThresholds(
  command: string,
  opts: { oneshot: boolean; cgroupMemBytes?: number },
): SupervisorThresholds {
  const isInstall = isLikelyInstallCommand(command);
  const isBuild = !isInstall && isLikelyBuildCommand(command);
  // Arm the memory watchdog only for heavy (build/test) commands on a
  // cgroup-limited host — light commands (ls/cat/grep) never start the poll.
  const memoryBudgetBytes =
    (isBuild || isTestCommand(command)) && opts.cgroupMemBytes !== undefined
      ? Math.floor(opts.cgroupMemBytes * memoryHighFraction())
      : undefined;
  return {
    serverDetectionMs: readPositiveInt(process.env.ANT_SERVER_DETECTION_MS, DEFAULT_SERVER_DETECTION_MS),
    serverOutputPattern: SERVER_OUTPUT_PATTERNS,
    repeatGraceMs: readPositiveInt(process.env.ANT_REPEAT_GRACE_MS, DEFAULT_REPEAT_GRACE_MS),
    repeatThreshold: readPositiveInt(process.env.ANT_REPEAT_THRESHOLD, DEFAULT_REPEAT_THRESHOLD),
    noOutputMs: readPositiveInt(
      process.env.ANT_NO_OUTPUT_MS,
      isInstall
        ? NO_OUTPUT_INSTALL_MS
        : isBuild
          ? readPositiveInt(process.env.ANT_NO_OUTPUT_BUILD_MS, NO_OUTPUT_BUILD_DEFAULT_MS)
          : DEFAULT_NO_OUTPUT_MS,
    ),
    hardTimeoutMs: isInstall ? HARD_TIMEOUT_INSTALL_MS : HARD_TIMEOUT_DEFAULT_MS,
    postOutputIdleMs: opts.oneshot ? ONESHOT_POST_OUTPUT_IDLE_MS : undefined,
    memoryBudgetBytes,
  };
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
  args: { command: string; working_directory?: string; keep_running?: boolean; oneshot?: boolean; verifies?: Gate },
): Promise<ToolResult> {
  if (ctx.allowShellExecution !== true) {
    const { rejectRunCommand } = await import('./codebaseGate');
    return rejectRunCommand();
  }
  const isInstall = PACKAGE_MANAGER_INSTALL_PATTERNS.some(p => p.test(args.command));
  if (isInstall) {
    console.log(`🔒 [RunCommand] Package manager command detected — acquiring mutex: ${args.command}`);
    return packageManagerMutex.runExclusive(async () => {
      // Workspace dep-pin guard. Runs INSIDE the mutex so the snapshot
      // scan reflects every prior install/manifest write that already
      // landed (either from another runCommand call or from an
      // editFile/createFile manifest write that takes the same mutex).
      // Bare installs (no `name@spec`) and add commands without an
      // explicit version pass through — `extractInstallVersionTargets`
      // returns an empty list and the policy helper short-circuits.
      const featureRootPath = ctx.fileSystem.getRootPath();
      const rejection = await enforceManifestPinPolicyForInstall(args.command, featureRootPath);
      if (rejection) {
        return makeRejection(ctx, args.command, rejection.display, undefined, args.verifies);
      }
      return executeCommandLogic(ctx, args);
    });
  }
  return executeCommandLogic(ctx, args);
}

async function executeCommandLogic(
  ctx: ToolExecutionContext,
  args: { command: string; working_directory?: string; keep_running?: boolean; oneshot?: boolean; verifies?: Gate },
): Promise<ToolResult> {
  const { working_directory, keep_running, oneshot, verifies } = args;
  // `command` is reassigned once below to apply test-runner concurrency caps;
  // all downstream uses (cardId, classification, spawn) see the capped form.
  let command = args.command;
  // Mutually exclusive intent flags: keep_running ("long-running server, leave
  // alive") and oneshot ("must exit after output"). When both are set, prefer
  // keep_running so the server contract is preserved.
  let oneshotEffective = Boolean(oneshot);
  if (oneshotEffective && keep_running) {
    console.warn(`   ⚠️ [RunCommand] Both keep_running and oneshot were set — preferring keep_running. Command: ${args.command}`);
    oneshotEffective = false;
  }
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
    return makeRejection(
      ctx,
      command,
      `⚠️ COMMAND MAY HANG: ${command}\n\nThis command typically requires interactive input.\n\n✅ Add -y or --yes flag to skip prompts.`,
      undefined,
      verifies,
    );
  }

  // Size the test-runner pool to the pod's REAL CPU count (cgroup quota, not the
  // host cores vitest would otherwise read), reserving a core for the heartbeat.
  // Computed once and reused for the spawn env + long-running path below.
  // See commandResourceLimits.ts / cgroupLimits.ts (RCA: worker_stalled).
  const cgroupCpu = readCgroupCpuLimit();
  const testWorkers = deriveTestWorkers({ effectiveCpu: cgroupCpu });
  // Memory budget: default heap cap (spawn env) + watchdog budget (below).
  const cgroupMemBytes = readCgroupMemoryLimit();
  const cmdIsTest = isTestCommand(command);
  const heapCap = resolveHeapCapMb({ isTestCommand: cmdIsTest }, testWorkers, cgroupMemBytes);
  logResourceCapsOnce(
    testWorkers,
    cgroupCpu,
    cgroupMemBytes,
    readCgroupMemoryUsage(),
    heapCap ? (heapCap.source === 'optin' ? `optin-${heapCap.mb}` : heapCap.mb) : undefined,
  );
  // Pipe-AWARE concurrency cap for vitest 4 (vitest 2.x is capped via spawn env).
  // No-op for non-test commands.
  const cappedCommand = appendVitestMaxWorkers(command, testWorkers);
  if (cappedCommand !== command) {
    console.log(`   🧵 [RunCommand] Capped test-runner concurrency: ${cappedCommand}`);
    command = cappedCommand;
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
      return makeRejection(ctx, command, `SKIPPED: ${skipReason}`, undefined, verifies);
    }
  }

  const cardId = await ctx.chatStatus.commandStart(command);

  // Allowlist pre-check for EVERY command (was long-running-only): rejections
  // get the `[Policy] ❌ COMMAND NOT ALLOWED` framing instead of surfacing as
  // a thrown `COMMAND EXECUTION ERROR` from the adapter (which reads as a
  // runtime failure and amplifies blind retries). Runs before the write-path
  // guard so a still-unsupported construct (`case …`) is named precisely
  // instead of being masked by an expansion-target message. The adapter's own
  // `execute` throw stays as the backstop for other call sites.
  if (!commandPort.isAllowed(command)) {
    const head = commandPort.firstDisallowedHead?.(command);
    const constructNote = head && UNSUPPORTED_SHELL_CONSTRUCTS.has(head)
      ? `'${head}' is a shell construct that is not supported here. Use if/&& chains, \`find … -exec\`, xargs, or per-file commands instead.\n\n`
      : '';
    return makeRejection(
      ctx,
      command,
      `❌ COMMAND NOT ALLOWED: ${command}\n\n${constructNote}${commandPort.notAllowedGuidance?.() ?? 'Only whitelisted commands are permitted.'}`,
      cardId,
      verifies,
    );
  }

  const isLongRunning = LONG_RUNNING_PATTERNS.some(p => p.test(command));
  const isInstallCommand = isLikelyInstallCommand(command);
  const hasShellOperators = /(\|\||&&|;)/.test(command);
  // CI=true (non-install, or install w/o shell operators) + vitest pool env sized
  // to testWorkers + default/opt-in heap cap (sized from cgroupMemBytes). See
  // commandResourceLimits.ts.
  const spawnEnv = buildSpawnEnv(
    { isInstallCommand, hasShellOperators, isTestCommand: cmdIsTest },
    testWorkers,
    process.env,
    cgroupMemBytes,
  );

  const projectPath = featureRootPath;
  refreshGoPrivateEnv(command, projectPath);

  let workingDir: string;
  if (working_directory) {
    if (path.isAbsolute(working_directory)) {
      workingDir = working_directory;
    } else if (ctx.pathAutoCorrect === 'none') {
      // Non-canonical root (universal artifact tree) — no codebase/ prefixing.
      workingDir = path.join(projectPath, working_directory);
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

  // The codebase/-bound write-path policy only applies to canonical feature
  // roots; a non-canonical root has no codebase/ tree to protect (the sandbox
  // is the fileSystem root itself).
  const writeViolations = ctx.pathAutoCorrect === 'none'
    ? []
    : detectWritePathViolations(command, workingDir, projectPath);
  if (writeViolations.length > 0) {
    const msg = writeViolations.map(v => `  - "${v.path}" → ${v.reason}`).join('\n');
    console.error(`\n   ❌ [run_command] Write path violation detected:\n${msg}\n`);
    return makeRejection(
      ctx,
      command,
      `❌ COMMAND REJECTED: File write targets outside codebase/ directory.\n\nViolations:\n${msg}\n\nAll file writes must target paths under codebase/.`,
      cardId,
      verifies,
    );
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
      const r = await handleLongRunningCommand(
        ctx, command, workingDir, cardId, Boolean(keep_running), spawnEnv,
      );
      sideEffects.push(makeCommandExecuted({
        exitCode: r.exitCode ?? (r.success ? 0 : 1),
        command,
        success: r.success,
        hasWarnings: false,
        verifies,
      }));
      if (r.serverPid) {
        sideEffects.push({ type: 'serverStarted', pid: r.serverPid, command, workingDir, port: r.serverPort });
      }
      return { content: r.output, sideEffects };
    }

    // Normal command path

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
        invalidateBufferedFiles();
        const output = injected.stdout + injected.stderr;
        sideEffects.push(makeCommandExecuted({ exitCode: injected.exitCode, command, success: injected.success, hasWarnings: false, verifies }));
        await ctx.chatStatus.commandComplete(command, injected.success, injected.exitCode, output);
        return {
          content: injected.success
            ? `✅ COMMAND SUCCEEDED: ${command}\nExit Code: ${injected.exitCode}\n\nOutput:\n${output}`
            : `❌ COMMAND FAILED: ${command}\nExit Code: ${injected.exitCode}\n\n📋 ERROR OUTPUT:\n${output}`,
          error: injected.success ? undefined : output,
          sideEffects,
        };
      }
      // 'overlay' mode falls through to real execution; result is rewritten below.
    }

    streamer = createOutputStreamer(ctx.chatStatus, command, () => streamedStdout + streamedStderr);

    const controller = new AbortController();
    const supervisor = new ProgressSupervisor({
      command,
      thresholds: resolveThresholds(command, { oneshot: oneshotEffective, cgroupMemBytes }),
      sampleMemoryBytes: () => readCgroupMemoryUsage(),
    });

    const commandPromise = commandPort.execute(command, {
      cwd: workingDir,
      signal: controller.signal,
      env: spawnEnv,
      onStdout: (chunk: string) => {
        streamedStdout += chunk;
        console.log(chunk);
        supervisor.ingestChunk(chunk);
        streamer!.schedule();
      },
      onStderr: (chunk: string) => {
        streamedStderr += chunk;
        console.error(chunk);
        supervisor.ingestChunk(chunk);
        streamer!.schedule();
      },
      onExit: (code: number) => {
        console.log(`   Exit code: ${code}`);
      },
    });

    const raceResult = await Promise.race([
      commandPromise.then(r => ({ kind: 'completed' as const, result: r })),
      supervisor.signal().then(signal => ({ kind: 'terminated' as const, signal })),
    ]);

    if (raceResult.kind === 'terminated') {
      // Explicit kill — no orphan child process leak.
      controller.abort();
      await commandPromise.catch(() => {});
      supervisor.dispose();

      invalidateBufferedFiles();
      const allOutput = streamedStdout + streamedStderr;
      streamer.flush();

      const termination = ProgressSupervisor.renderTermination(raceResult.signal, {
        command,
        output: allOutput,
        tailChars: 5000,
      });

      await ctx.chatStatus.commandComplete(command, termination.success, termination.exitCode, termination.content);
      sideEffects.push(makeCommandExecuted({
        exitCode: termination.exitCode,
        command,
        success: termination.success,
        hasWarnings: termination.hasWarnings,
        verifies,
      }));

      return {
        content: termination.content,
        error: termination.success ? undefined : allOutput,
        sideEffects,
      };
    }

    // Normal completion — race finished via commandPromise.
    supervisor.dispose();
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
    await ctx.chatStatus.commandComplete(command, success, exitCode, output);

    if (!success) {
      sideEffects.push(makeCommandExecuted({ exitCode: exitCode ?? 1, command, success: false, hasWarnings: false, verifies }));
      // When the command produced no captured output, do NOT claim an error is
      // present to read — there is none. Empty output on failure almost always
      // means the command redirected its output to a file (`> file`, `2> file`,
      // `1>/dev/null`) or simply produced nothing. Guide the LLM to a diagnosable
      // form instead of sending it guessing.
      const content = (output.trim().length > 0
        ? `❌ COMMAND FAILED: ${command}\nExit Code: ${exitCode}\n\n📋 ERROR OUTPUT:\n${output}\n\n⚠️  You MUST read the error above and fix the specific issue mentioned.\nDO NOT guess - the error tells you exactly what's wrong.`
        : `❌ COMMAND FAILED: ${command}\nExit Code: ${exitCode}\n\n📋 ERROR OUTPUT: (none captured)\n\n⚠️  The command failed but produced NO output to read. Likely causes:\n- Output was redirected to a file (e.g. \`> out.txt\`, \`2> err.log\`, \`1>/dev/null\`) — re-run WITHOUT redirecting so the output is returned to you, or read the file you wrote.\n- The command genuinely produced no output before failing.\nDo NOT keep retrying the same command with different redirection — change the approach so the output reaches you.`)
        + nfdCommandHint(command, output, false);
      return {
        content,
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
    // Cache replay detection — only meaningful for verification gate
    // commands. A passing exit code that came from a cached artifact
    // pre-dates any fix applied in this verification cycle, so the gate
    // observation is untrusted; the plan-side prompt rule consumes this
    // flag and instructs the LLM to re-run with a cache-bypass argument.
    const cacheReplayed = verifies
      ? detectCacheReplay(`${stdout}\n${stderr}`).replayed
      : false;
    sideEffects.push(makeCommandExecuted({ exitCode: 0, command, success: true, hasWarnings, verifies, cacheReplayed }));

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
        : `✅ COMMAND SUCCEEDED: ${command}\nExit Code: 0\n(No output)` + nfdCommandHint(command, output, true),
      sideEffects,
    };
  } catch (error) {
    invalidateBufferedFiles();
    streamer?.flush();
    const errorMessage = (error as Error).message;
    console.error(`\n   ❌ Command execution error: ${errorMessage}\n`);
    await ctx.chatStatus.commandComplete(command, false, -1, errorMessage);

    sideEffects.push(makeCommandExecuted({ exitCode: -1, command, success: false, hasWarnings: false, verifies }));
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

/**
 * Long-running command wrapper. Returns an objective fact report — the LLM
 * judges success vs failure from the embedded `exit:` / `http_probe:` /
 * `stdout:` / `stderr:` fields. No regex pattern-matching, no editorial
 * `✅` / `❌` prefix.
 *
 * `success` is a deterministic predicate: the child exited cleanly (or is
 * still running and we killed it) AND the HTTP probe (when run) returned a
 * status < 500.
 */
export async function handleLongRunningCommand(
  ctx: ToolExecutionContext,
  command: string,
  workingDir: string,
  _cardId: string | undefined,
  keepRunning: boolean,
  spawnEnv?: Record<string, string>,
): Promise<{
  success: boolean;
  output: string;
  exitCode: number | null;
  httpProbe?: { ok: boolean; status?: number; error?: string };
  serverPid?: number;
  serverPort?: number;
}> {
  const { spawn } = await import('child_process');
  const startedAt = Date.now();
  // Separate function scope from the short-running path — read the (memoized)
  // cgroup memory limit here so the memoryBudget watchdog arms for long-running
  // build/test commands too.
  const cgroupMemBytes = readCgroupMemoryLimit();

  // SSOT: ant-cli's DevProcessControl handles dev-server cleanup, descendant
  // discovery (pgrep BFS), and framework lock files (.next/dev/server.json).
  // We delegate kill + pre-flight cleanup to it instead of re-implementing.
  const devControl = getDefaultDevProcessControl();

  // Pre-flight: clear any stale Next.js dev lock left by a prior crashed
  // run. Idempotent — no-op when no lock exists. This prevents the "Another
  // dev server is already running" cascade observed across verification
  // cycles that share a working directory.
  try { await devControl.cleanupStaleLocks(workingDir); } catch { /* best-effort */ }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const streamer = createOutputStreamer(ctx.chatStatus, command, () => stdout + stderr);
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    console.log(`   🐚 Spawning: ${shell} ${shellArgs[0]} "${command}"`);

    // Long-running LLM command shares the worker UID otherwise — drop to the
    // child identity and fail closed in cloud when the drop is unavailable, the
    // same as the short command path in NodeCommandAdapter (M-014).
    assertUserCodeIsolationOrThrow('run_command:long-running');
    const child = spawn(shell, shellArgs, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Same cgroup-derived spawn env (CI + heap cap + vitest pool) as the
      // standard path — long-running dev servers / smoke gates were previously
      // unbounded. See commandResourceLimits.ts.
      env: cleanCommandEnv(spawnEnv),
      detached: process.platform !== 'win32',
      ...childSpawnIdentity(),
    });

    console.log(`   📋 Process spawned with PID: ${child.pid}`);

    // Supervisor for in-flight watchdog (post-startup hang detection).
    // serverStartedPattern is excluded — startup HTTP probe below is the
    // canonical "is this a real server?" signal for long-running commands.
    const supervisor = new ProgressSupervisor({
      command,
      thresholds: resolveThresholds(command, { oneshot: false, cgroupMemBytes }),
      sampleMemoryBytes: () => readCgroupMemoryUsage(),
      enabledSignals: ['repeatedSignature', 'noOutput', 'hardTimeout', 'memoryBudget'] as const,
    });

    let resolved = false;
    let httpProbe: { ok: boolean; status?: number; error?: string } | undefined;
    let exitSignal: NodeJS.Signals | null = null;
    let resolvedPort: number | undefined;

    // `alive` is non-null only when the child was intentionally left running
    // (keepRunning && exit===null). In that case the label MUST NOT claim
    // `killed-after-verification` — the server is up and the LLM needs its
    // PID/URL to probe routes (http_request) and to kill it before <done>.
    const buildOutput = (exit: number | null, alive: { pid?: number; port?: number } | null) => {
      const lines = [
        `command: ${command}`,
        `duration_ms: ${Date.now() - startedAt}`,
        `exit: ${
          exit !== null
            ? String(exit)
            : alive
              ? 'still-running (keep_running)'
              : (exitSignal ? `signal:${exitSignal}` : 'killed-after-verification')
        }`,
      ];
      if (alive?.pid) lines.push(`server_pid: ${alive.pid}`);
      if (alive?.port) lines.push(`server_url: http://localhost:${alive.port}`);
      lines.push(
        `http_probe: ${
          httpProbe
            ? (httpProbe.ok
                ? `${httpProbe.status}`
                : `failed: ${httpProbe.error ?? `HTTP ${httpProbe.status ?? '?'}`}`)
            : 'skipped'
        }`,
        `stdout:`,
        stdout.slice(0, 8000),
        `stderr:`,
        stderr.slice(0, 4000),
      );
      return lines.join('\n');
    };

    const finalize = async (exit: number | null, opts: { kill: boolean }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      supervisor.dispose();
      streamer.flush();
      if (opts.kill && child.exitCode === null) {
        // Use DevProcessControl.killTree (pgrep BFS for descendants) so that
        // next dev → next-server worker chains are reaped together. Falling
        // back to processTree.terminateProcessTree if killTree itself fails
        // (e.g. pgrep absent on a stripped image) keeps the kill best-effort.
        try {
          await devControl.killTree(child);
        } catch {
          if (child.pid) await terminateProcessTree(child.pid);
          else child.kill('SIGTERM');
        }
      }
      // EADDRINUSE in stderr means the child reported a port conflict even
      // if it then exited 0 (next dev does this). Suppress the spurious
      // "server started" signal — there is no live server to track.
      const addressInUse = /EADDRINUSE|address already in use/i.test(stderr);
      // exit === null means the child is still alive (we intentionally kill
      // it, or keepRunning=true and we leave it running); treat as exit-OK.
      // The httpProbe (if performed) is the second axis: status < 500 is OK.
      const exitOk = exit === null || exit === 0;
      const probeOk = httpProbe?.ok ?? true;
      const success = exitOk && probeOk && !addressInUse;
      const serverPid = keepRunning && success && !addressInUse ? child.pid : undefined;
      // Left alive iff keepRunning and the child didn't exit on its own — the
      // auto-kill path only runs when !keepRunning (see finalize opts.kill).
      const alive = keepRunning && exit === null ? { pid: serverPid, port: resolvedPort } : null;
      const output = buildOutput(exit, alive);
      await ctx.chatStatus.commandComplete(command, success, exit ?? -1, output);
      resolve({
        success,
        output,
        exitCode: exit,
        httpProbe,
        serverPid,
        serverPort: resolvedPort,
      });
    };

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log(chunk);
      supervisor.ingestChunk(chunk);
      streamer.schedule();
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.error(chunk);
      supervisor.ingestChunk(chunk);
      streamer.schedule();
    });

    // Watchdog termination — if supervisor fires before startup probe / exit,
    // kill the child and resolve with the watchdog's LLM-facing message
    // instead of the fact-report format. dispose() inside finalize() prevents
    // double-resolution if startup/exit fires first.
    void supervisor.signal().then(async (signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      streamer.flush();
      try {
        await devControl.killTree(child);
      } catch {
        if (child.pid) await terminateProcessTree(child.pid);
      }
      const allOutput = stdout + stderr;
      const termination = ProgressSupervisor.renderTermination(signal, {
        command,
        output: allOutput,
        tailChars: 5000,
      });
      await ctx.chatStatus.commandComplete(
        command,
        termination.success,
        termination.exitCode,
        termination.content,
      );
      resolve({
        success: termination.success,
        output: termination.content,
        exitCode: termination.exitCode,
        httpProbe,
        serverPid: undefined,
      });
    });

    child.on('error', async (err) => {
      // Node occasionally fires both 'error' and 'exit'; first one to
      // finalize wins. Spawn failure is encoded as exit:-1 in the fact
      // report (the fact-report builder shows `signal:` if no exit code
      // is available, otherwise the numeric exit).
      if (resolved) return;
      stderr += `\n[spawn error] ${err.message}`;
      await finalize(-1, { kill: false });
    });

    const isCompileRun = COMPILE_RUN_PATTERNS.some(p => p.test(command));
    const effectiveStartupTimeout = isCompileRun ? COMPILE_RUN_STARTUP_TIMEOUT : STARTUP_VERIFICATION_TIMEOUT;

    const startupTimeout = setTimeout(async () => {
      if (resolved || child.exitCode !== null) return;

      console.log(`\n   🔎 Verifying server response...`);
      const portMatch = stdout.match(/localhost:(\d+)|port\s+(\d+)|:(\d{4,5})\b/i);
      const port = portMatch ? parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10) : 3000;
      resolvedPort = port;
      try {
        httpProbe = await probeHttp('localhost', port, '/', 15_000);
      } catch (err) {
        httpProbe = { ok: false, error: (err as Error).message };
      }

      // Verification window over: kill if user didn't request keep-running,
      // otherwise leave the child alive but still report.
      await finalize(child.exitCode, { kill: !keepRunning });
    }, effectiveStartupTimeout);

    child.on('exit', async (code, signal) => {
      if (resolved) return;
      exitSignal = signal;
      await finalize(code, { kill: false });
    });
  });
}

// Re-export utilities needed by Code command policy
export { isBareInstallCommand, PACKAGE_MANAGER_INSTALL_PATTERNS };
// Pure policy helpers exposed for unit tests.
export { extractWriteTargets, detectWritePathViolations, isLikelyBuildCommand };
