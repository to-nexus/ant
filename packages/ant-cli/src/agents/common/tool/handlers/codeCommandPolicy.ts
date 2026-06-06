/**
 * CodeCommandPolicy — Code job-specific guards for run_command
 *
 * Only applied to Code job's tool registry. Design/Plan/Ask jobs use the
 * base executeCommand without these policies.
 *
 * R1 — task-type-blind body. Guard logic lives in
 * `tasks/{type}/hooks/command.ts` and is dispatched via the shared
 * registry. Only cross-task concerns (Go build block outside
 * verification responsibility) remain inline.
 */

import * as path from 'path';
import type { ToolExecutionContext, ToolResult } from '../types';
import type { TaskType } from '@ant/shared';
import { hooksForTaskType } from '../../../architect/graph/code/tasks/_shared/registry';
import { detectMonorepoLayout } from '../../graph/nodes/triage/workspaceAnalyzer';

export interface CodeCommandPolicyResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Policy-rejection `ToolResult`. Policy-level Go allow-list rejection is
 * NOT a command execution failure — the content is tagged with `[Policy]`
 * so the tool_result formatter doesn't prepend `Error:` (which would make
 * the LLM mis-handle it as a real build failure). Aligned with
 * `common/tool/handlers/runCommand.ts::makeRejection` and the task-hook
 * reject()s in verification/error.
 */
function makeRejection(command: string, reason: string): ToolResult {
  return {
    content: `[Policy] ${reason}`,
    sideEffects: [{ type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false }],
  };
}

/**
 * Install-locality guard predicate.
 *
 * Matches the leading mutating verb across the JS / Rust / Python / Bun
 * ecosystems whose lockfiles are workspace-scoped. Mirrors
 * `tasks/test-code/hooks/command.ts::INSTALL_PATTERNS` but stays
 * separate because the locality concern is task-blind (every code task
 * suffers the duplicate-tree symptom when it installs from a member
 * directory) while the test-code guard is sub-task-scoped (lockfile
 * race with siblings).
 *
 * Excludes `poetry add` (poetry monorepos are not workspace-rooted) and
 * `go get` (Go workspaces keep per-module dependency graphs by design,
 * see the `go-workspace` branch in `monorepo-install-locality.md`).
 */
const LOCALITY_INSTALL_PATTERNS: readonly RegExp[] = [
  /^\s*(npm|pnpm|yarn|bun)\s+(install|i|ci|add|remove|rm|uninstall)\b/,
  /^\s*cargo\s+(add|remove|install)\b/,
  /^\s*uv\s+(add|remove|sync|pip\s+install)\b/,
];

function isLocalityRelevantInstall(command: string): boolean {
  return LOCALITY_INSTALL_PATTERNS.some((pat) => pat.test(command));
}

/**
 * Resolve the `working_directory` argument relative to the codebase
 * root, matching the resolution rules in `runCommand.executeCommandLogic`.
 * Absolute paths are returned as-is; relative paths join against
 * `<featurePath>/codebase`. `undefined` working_directory falls back to
 * the codebase root (the policy's reference frame).
 */
function resolveCmdCwd(featurePath: string, codebaseAbs: string, working_directory?: string): string {
  if (!working_directory) return codebaseAbs;
  if (path.isAbsolute(working_directory)) return working_directory;
  // The runCommand handler `normalizeToCodebasePath`s relative inputs
  // against the project root. We approximate that here — exact mirror
  // is not required for the locality check, only the relative-position
  // reasoning between cwd and codebase root.
  const trimmed = working_directory.replace(/^\.\/?/, '').replace(/^codebase\/?/, '');
  if (trimmed === '' || trimmed === '.') return codebaseAbs;
  return path.join(codebaseAbs, trimmed);
}

/**
 * Install-locality guard.
 *
 * Reject mutating dependency commands (install / add / remove) issued
 * from a member directory when the codebase root carries a workspace
 * marker. The lockfile authority is at the marker — running an install
 * inside a member produces either a duplicate dependency tree or a
 * stalled invocation behind the package-manager mutex (depending on
 * the manager).
 *
 * Read-only commands (`pnpm why`, `cat`, `<binary> --version`) are
 * untouched — only the patterns in {@link LOCALITY_INSTALL_PATTERNS}
 * trigger the check.
 *
 * Markers handled per-manager:
 *   - `pnpm-workspace`, `npm-workspaces`, `yarn-workspaces`,
 *     `bun-workspaces`, `cargo-workspace`, `uv-workspace` — guard fires
 *   - `go-workspace` — guard does NOT fire (per-member `go get` is the
 *     documented Go workspace flow)
 *   - poetry — never detected as a workspace (no single root marker),
 *     so guard naturally does not fire
 *
 * Returns `null` when the command is not mutating, the codebase has no
 * workspace marker, the cwd already resolves to the workspace root, or
 * the marker is `go-workspace`.
 */
function applyInstallLocalityGuard(
  ctx: ToolExecutionContext,
  args: { command: string; working_directory?: string },
): ToolResult | null {
  const { command, working_directory } = args;
  if (!isLocalityRelevantInstall(command)) return null;

  const featurePath = ctx.featurePath;
  if (!featurePath) return null;
  const codebaseAbs = path.join(featurePath, 'codebase');
  const layout = detectMonorepoLayout(codebaseAbs);
  if (!layout) return null;
  if (layout.manager === 'go-workspace') return null;

  const cmdCwd = resolveCmdCwd(featurePath, codebaseAbs, working_directory);
  // Normalise both sides so trailing-slash / `.` / symlink-equivalent
  // forms compare equal.
  const cwdNorm = path.resolve(cmdCwd);
  const rootNorm = path.resolve(codebaseAbs);
  if (cwdNorm === rootNorm) return null;

  // Only reject when the cwd is strictly inside the workspace root.
  // Outside-codebase cwds (rare) are someone else's problem.
  const rel = path.relative(rootNorm, cwdNorm);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  console.warn(
    `   ⛔ [RunCommand] Install-locality violation — ${command} from ${rel} ` +
    `(workspace marker: ${layout.rootMarker} / ${layout.manager})`,
  );
  return makeRejection(
    command,
    `⛔ BLOCKED: ${command}\n\n` +
    `This codebase is a ${layout.manager} workspace (root marker: ${layout.rootMarker}). ` +
    `Mutating dependency commands MUST be issued from the workspace root \`${layout.rootPath}\`, ` +
    `not from the member directory \`${rel}\`. Running install/add/remove inside a member ` +
    `produces either a duplicate dependency tree or stalls behind the package-manager's global mutex.\n\n` +
    `✅ Re-issue from the workspace root using the manager's member-targeting flag — see the ` +
    `"Monorepo Install Locality" section of your prompt for the exact invocation form.`,
  );
}

/**
 * Manual dev-server backgrounding guard.
 *
 * Shell-backgrounding a dev server (`&` / `nohup` / `disown` / `setsid`) orphans
 * the process — the runtime can't track its PID/port and won't reap it (the exact
 * pattern that stalled the `dark-crafting-adder` cycle). This is wrong regardless
 * of whether persistent processes are unlocked, so the guard fires in BOTH states
 * and only the recovery instruction adapts:
 *   - unlocked → start it with `keep_running: true` + probe via `http_request`
 *   - locked   → persistent servers aren't available here; use the bounded
 *     `keep_running: false` probe instead
 *
 * Narrow by construction: fires only when BOTH a dev-server token and a
 * backgrounding token are present, so legitimate `cmd & wait` pipelines and
 * non-server background jobs are untouched.
 */
const DEV_SERVER_TOKEN = /\b(next|vite|nuxt|remix|astro)\b[^\n]*\bdev\b|\b(npm|pnpm|yarn|bun)\b[^\n]*\b(dev|start|serve|preview)\b/;
const BACKGROUNDING_TOKEN = /(^|[^&])&(?!&)|\bnohup\b|\bdisown\b|\bsetsid\b/;

function applyDevBackgroundingGuard(
  ctx: ToolExecutionContext,
  args: { command: string },
): ToolResult | null {
  const { command } = args;
  if (!DEV_SERVER_TOKEN.test(command) || !BACKGROUNDING_TOKEN.test(command)) return null;
  console.warn(`   ⛔ [RunCommand] Blocked manual dev-server backgrounding: ${command}`);
  const recovery = ctx.allowPersistentProcesses === true
    ? `✅ Start it with \`run_command\` and \`keep_running: true\` (the result reports server_pid + ` +
      `server_url), then verify specific routes with the \`http_request\` tool (it auto-targets the ` +
      `running server's port). Kill server_pid before <done>.`
    : `✅ Persistent servers + route probing aren't available in this context. For a one-shot "does it ` +
      `boot" check, run the same command with \`run_command\` and \`keep_running: false\` (the default) — ` +
      `it spawns, waits the startup window, probes \`/\` once, and auto-kills.`;
  return makeRejection(
    command,
    `⛔ BLOCKED: ${command}\n\n` +
    `Do NOT background a dev server with \`&\` / \`nohup\` / \`disown\` / \`setsid\` — it orphans the ` +
    `process (the runtime can't track its PID/port and won't reap it).\n\n` +
    recovery,
  );
}

/**
 * Persistent keep_running gate.
 *
 * `keep_running: true` (persist the server alive across tool calls) is the other
 * half of the runtime-reproduction set paired with `http_request`; both are gated
 * by the same `allowPersistentProcesses` SSOT. When that gate is closed, a request
 * to keep a server alive is rejected with an explicit pointer to the bounded
 * `keep_running: false` probe (which stays ungated — cheap and self-cleaning). No
 * silent downgrade: the contract is kept explicit so the LLM learns the boundary.
 */
function applyPersistentKeepRunningGate(
  ctx: ToolExecutionContext,
  args: { command: string; keep_running?: boolean },
): ToolResult | null {
  if (args.keep_running !== true) return null;
  if (ctx.allowPersistentProcesses === true) return null;
  console.warn(`   ⛔ [RunCommand] Blocked keep_running:true outside a reproduction context: ${args.command}`);
  return makeRejection(
    args.command,
    `⛔ BLOCKED: keep_running: true\n\n` +
    `Keeping a server alive across tool calls (and probing it with \`http_request\`) is available only ` +
    `in a reproduction context — an error task or a verification / self-verify RCA cycle. This is an ` +
    `apply phase, so the persistent-process set is locked.\n\n` +
    `✅ For a one-shot "does it boot" check, re-run with \`keep_running: false\` (the default): it spawns, ` +
    `waits the startup window, probes \`/\` once, and auto-kills. Leave route-level verification to the ` +
    `following verification cycle.`,
  );
}

/**
 * Apply Code-specific policy guards before executing a command.
 * Returns a ToolResult if the command is rejected, or null if it should proceed.
 */
export function applyCodeCommandPolicy(
  ctx: ToolExecutionContext,
  args: { command: string; verifies?: string; working_directory?: string; keep_running?: boolean },
): ToolResult | null {
  const { command } = args;
  const taskType = ctx.currentTaskType;

  // Go build/test/run/vet block. Verification responsibility holders run
  // these as part of their verify cycle (`ctx.verifyModeActive === true`).
  // Apply-phase callers (Tier 2 self-verify before reverify, Tier 3/4
  // error/feature/ui/setup) never run Go build gates directly — they apply
  // fixes and defer verification to the dedicated cycle.
  const GO_BUILD_PATTERNS = /\bgo\s+(build|test|run|vet)\b/;
  const allowedByVerifyMode = ctx.verifyModeActive === true;
  if (GO_BUILD_PATTERNS.test(command) && !allowedByVerifyMode) {
    console.warn(`   ⛔ [RunCommand] Blocked Go build command in ${taskType} task: ${command}`);
    return makeRejection(
      command,
      `⛔ BLOCKED: ${command}\n\nGo build/test/run/vet commands are allowed only during a verification cycle (verification task, or self-verify task in reverify phase). For apply-phase fixes, the following verification cycle owns build/test — it re-verifies automatically after your fix lands.\nContinue writing code files and output <done>true</done> when complete.`,
    );
  }

  // Cross-task install-locality guard — fires before task-type guards so
  // sub-task install attempts produce the locality-aware message instead
  // of the lockfile-race message when both apply.
  const localityRejection = applyInstallLocalityGuard(ctx, args);
  if (localityRejection) return localityRejection;

  // Manual dev-server backgrounding guard — never background a dev server;
  // recovery instruction adapts to whether persistent processes are unlocked.
  const backgroundingRejection = applyDevBackgroundingGuard(ctx, args);
  if (backgroundingRejection) return backgroundingRejection;

  // Persistent keep_running gate — `keep_running:true` is set-gated with
  // `http_request` behind `allowPersistentProcesses`; locked contexts get the
  // bounded `keep_running:false` probe instead.
  const keepRunningRejection = applyPersistentKeepRunningGate(ctx, args);
  if (keepRunningRejection) return keepRunningRejection;

  // Task-type-specific guards.
  return hooksForTaskType(taskType as TaskType | undefined)?.command?.guard(ctx, args as any) ?? null;
}
