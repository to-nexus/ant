/**
 * Command Injection Overlay — Test-only fault injection for command execution.
 *
 * Activated by two env vars, both required for injection to take effect:
 *   - ANT_COMMAND_INJECT: JSON-encoded rule set (see `CommandInjectRules`).
 *   - ANT_COMMAND_OVERLAY_MODE: 'overlay' | 'stub'
 *       • 'overlay' → run the real command, then override its result with the
 *         first matching rule. Useful when some real execution is needed (e.g.
 *         to cause side effects in the workspace) but the observed output must
 *         be deterministic.
 *       • 'stub'    → never run the real command; return the rule directly.
 *
 * When either env var is absent, `lookupInjection` returns undefined and the
 * runCommand handler follows the normal execution path. This means the
 * production code path in `runCommand.ts` is unaffected unless both vars are
 * set in the process environment (E2E / scenario-runner use only).
 *
 * See docs/testing/verification-scenarios.md for the full test harness design.
 */

export interface CommandInjectRule {
  /** Regex pattern (string form) matched against the raw command. */
  pattern: string;
  /** Exit code to report. Defaults to 0 for passthrough-style stubs. */
  exitCode?: number;
  /** Text appended to stdout in the injected result. */
  stdout?: string;
  /** Text appended to stderr in the injected result. */
  stderr?: string;
  /** Optional human-readable tag surfaced in logs for debugging. */
  tag?: string;
}

export interface CommandInjectRules {
  rules: CommandInjectRule[];
}

export type CommandInjectMode = 'overlay' | 'stub';

export interface CommandInjectionDecision {
  mode: CommandInjectMode;
  rule: CommandInjectRule;
  /** Compiled regex (cached; not a fresh object per call). */
  regex: RegExp;
}

export interface InjectedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module state — parse env once; re-used across invocations.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ParsedConfig {
  mode: CommandInjectMode;
  compiled: Array<{ regex: RegExp; rule: CommandInjectRule }>;
}

let cached: ParsedConfig | null | undefined;

function readMode(): CommandInjectMode | null {
  const raw = process.env.ANT_COMMAND_OVERLAY_MODE;
  if (raw === 'overlay' || raw === 'stub') return raw;
  return null;
}

function parseRules(): CommandInjectRules | null {
  const raw = process.env.ANT_COMMAND_INJECT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CommandInjectRules;
    if (!parsed || !Array.isArray(parsed.rules)) return null;
    return parsed;
  } catch (err) {
    console.warn(`⚠️  [CommandInject] Failed to parse ANT_COMMAND_INJECT as JSON: ${(err as Error).message}`);
    return null;
  }
}

function loadConfig(): ParsedConfig | null {
  if (cached !== undefined) return cached;
  const mode = readMode();
  const rules = parseRules();
  if (!mode || !rules) {
    cached = null;
    return null;
  }
  const compiled = rules.rules.map(rule => ({
    regex: new RegExp(rule.pattern),
    rule,
  }));
  cached = { mode, compiled };
  return cached;
}

/**
 * Test-only hook: clear the cached config so the next call re-reads process.env.
 * Useful in unit tests that mutate `process.env.ANT_COMMAND_INJECT` between cases.
 */
export function __resetCommandInjectCache(): void {
  cached = undefined;
}

/**
 * Look up the first matching injection rule for the given command.
 * Returns undefined when injection is not active or no rule matches.
 */
export function lookupInjection(command: string): CommandInjectionDecision | undefined {
  const cfg = loadConfig();
  if (!cfg) return undefined;
  for (const { regex, rule } of cfg.compiled) {
    if (regex.test(command)) {
      return { mode: cfg.mode, rule, regex };
    }
  }
  return undefined;
}

/**
 * Build the synthetic command result from a matched rule.
 * Exit code defaults to 0 (success) so rules can stub happy paths
 * without specifying every field.
 */
export function buildInjectedResult(rule: CommandInjectRule): InjectedCommandResult {
  const exitCode = rule.exitCode ?? 0;
  return {
    stdout: rule.stdout ?? '',
    stderr: rule.stderr ?? '',
    exitCode,
    success: exitCode === 0,
  };
}

/**
 * Compose the real-execution result with an overlay rule.
 * Preserves stdout (so real side effects remain visible in logs) but takes
 * the rule's exitCode and appends its stdout/stderr, making the failure
 * signal deterministic.
 */
export function overlayResult(
  realResult: { stdout: string; stderr: string; exitCode: number; success: boolean },
  rule: CommandInjectRule,
): InjectedCommandResult {
  const exitCode = rule.exitCode ?? realResult.exitCode;
  const stdout = rule.stdout !== undefined ? `${realResult.stdout}${rule.stdout}` : realResult.stdout;
  const stderr = rule.stderr !== undefined ? `${realResult.stderr}${rule.stderr}` : realResult.stderr;
  return {
    stdout,
    stderr,
    exitCode,
    success: exitCode === 0,
  };
}

/**
 * Human-readable log line for a matched injection decision.
 * Uses a distinctive emoji prefix so injection events are easy to spot
 * in scenario-runner output.
 */
export function describeInjection(decision: CommandInjectionDecision, command: string): string {
  const tag = decision.rule.tag ? ` [${decision.rule.tag}]` : '';
  return `🧪 [CommandInject][${decision.mode}]${tag} pattern=${decision.rule.pattern} exit=${decision.rule.exitCode ?? 0} → ${command}`;
}

/**
 * Convenience helper: is injection currently active for any command?
 * Used by diagnostic code that wants to assert the production path is not
 * inadvertently running overlays.
 */
export function isCommandInjectActive(): boolean {
  return loadConfig() !== null;
}
