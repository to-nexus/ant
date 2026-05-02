/**
 * test-code/hooks/command.ts — TaskCommandHook.guard
 *
 * Guards a single but critical invariant of the test-code batch-split
 * design: sub-tasks spawned from a parent test-code's `batches[]` MUST
 * NOT install dependencies or otherwise mutate the shared dependency
 * manifest. The parent already installed the test runner during its
 * plan phase (see `plan/variants/test-code/base.md`) and dropped itself;
 * the sub-tasks run in parallel with distinct `parallelGroup`s and
 * `blocksTestgen=false`, so two siblings simultaneously issuing
 * `npm install` would race on `package-lock.json` and either corrupt
 * the lockfile or stall each other behind the package-manager's global
 * mutex.
 *
 * The prompt variant (execute/variants/test-code/base.md) also carries
 * this constraint in natural-language form for the LLM to read, but the
 * guard here is the hardware-level defence — a prompt can be misread or
 * overridden by retry violations, this cannot.
 *
 * Parent test-code tasks (no `prePlanText`) are deliberately untouched:
 * their plan phase legitimately installs dependencies before emitting
 * the batch list. This mirrors `error/hooks/command.ts`, which scopes
 * its build/test/typecheck block to the execute phase and lifts it for
 * Tier 2 self-verify tasks.
 *
 * R1 — this module is the only place where test-code-specific command
 * behaviour lives. The common handler (`codeCommandPolicy.ts`) dispatches
 * here blindly via `hooksForTaskType('test-code')?.command?.guard`.
 */

import type { ToolExecutionContext, ToolResult } from '../../../../../../common/tool/types';

/**
 * Match install / add commands across the Node / Python / Ruby / Rust
 * ecosystems we currently generate tests for. Kept as a module-local
 * pattern rather than hoisted into `common/tool/constants` because it
 * encodes test-code-specific semantics (what "install" means in a
 * test-gen context) — verification's install handling already lives
 * inside `dependencyStatus` hints, not a shared predicate.
 *
 * Matches leading command invocations. Does not match subcommands
 * inside scripts (`npm run test:install`) because a shell operator is
 * a separate concern handled by `runCommand.ts`. Inside a `&&` chain
 * the LLM is still free to run scripts; what we block is the direct
 * install-the-world verb.
 */
const INSTALL_PATTERNS: readonly RegExp[] = [
  /\b(npm|pnpm|yarn)\s+(install|i|ci|add)\b/,
  /\bnpx\s+--yes\b/,
  /\b(pip|pip3)\s+install\b/,
  /\bpoetry\s+(add|install)\b/,
  /\buv\s+(pip\s+install|add)\b/,
  /\bbundle\s+install\b/,
  /\bcargo\s+(add|install)\b/,
  /\bgo\s+get\b/,
];

function isInstallInvocation(command: string): boolean {
  return INSTALL_PATTERNS.some((pat) => pat.test(command));
}

function reject(command: string, reason: string): ToolResult {
  return {
    content: `[Policy] ${reason}`,
    sideEffects: [
      { type: 'commandExecuted', exitCode: -1, command, success: false, hasWarnings: false },
    ],
  };
}

/**
 * Block install-class commands when the current test-code task is a
 * batch-split sub-task, and reject any verification gate command (the
 * `verifies` declaration is the SSOT — see
 * `docs/tmp/gate-classification-postmortem.md`). Returns `null` for every
 * other command (and for parent test-code tasks issuing non-install
 * commands) so the common handler's default execution path proceeds.
 */
export function guard(
  ctx: ToolExecutionContext,
  args: { command: string; verifies?: string },
): ToolResult | null {
  const { command, verifies } = args;

  // Verification gates belong to the dedicated verification task — a
  // test-code task (parent or sub) declaring `verifies` is a contract
  // violation, regardless of phase.
  if (verifies) {
    return reject(
      command,
      'BLOCKED: Test-code tasks generate test files only and must not run verification gates. ' +
        'Drop the `verifies` argument and write the test files for your assigned slice; ' +
        'the next verification task runs typecheck/build/test once your tests are in place.',
    );
  }

  // Parent test-code tasks handle install in their plan tool-loop; guard
  // only fires on sub-tasks (`prePlanText` present). See the header for
  // the full lockfile-race rationale.
  if (ctx.currentTaskHasPrePlanText !== true) return null;

  if (isInstallInvocation(command)) {
    return reject(
      command,
      'BLOCKED: Test-code sub-tasks MUST NOT install dependencies or modify package manifests. ' +
        'The parent test-code task already installed the test runner during its plan phase; ' +
        'running an install here races with sibling sub-tasks on the lockfile. ' +
        'Write the test files for your assigned slice and output <done>true</done>.',
    );
  }

  return null;
}
