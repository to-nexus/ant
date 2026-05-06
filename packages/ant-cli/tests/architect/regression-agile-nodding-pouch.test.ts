/**
 * Regression: code-job verification plan silent false-pass
 * (agile-nodding-pouch, 2026-05-06).
 *
 * Reproduces the post-mortem scenario captured in
 * `log-agile-nodding-pouch.json` line 50346-50358 where the final
 * verification task's plan tool-loop attempted:
 *
 *   run_command({ command: 'cd apps/console && pnpm typecheck 2>&1 | head -200',
 *                 working_directory: 'codebase' })
 *
 * and the handler's outer gate rejected it because
 * `allowMutateInCodebase !== true` (plan phase). The LLM gave up and
 * emitted an empty implementation plan with a self-confessing
 * `diagnostics.command: "Static file analysis only — run_command
 * unavailable in this phase"`. `emptyImplShortCircuit` then
 * short-circuited the task to `decision: "done"`, marking the
 * verification "successful" without ever running a single gate.
 *
 * Root cause: the codebase mutation gate (`9ba10de0`, 2026-05-04)
 * coupled two orthogonal responsibilities under a single flag —
 * `codebase/` write protection AND `run_command` shell execution
 * permission. Splitting them into `allowMutateInCodebase` (path-aware)
 * and `allowShellExecution` (binary) restores the verification plan's
 * primary responsibility (running build / typecheck / test gates) while
 * keeping the design-job `total-drying-apron` mutate guard intact.
 *
 * What this test pins:
 *   - The exact ctx shape the code job's tool node now wires for the
 *     verification task's plan phase: mutate gate closed, shell gate
 *     open. The outer shell gate MUST pass.
 *   - The orthogonality: an `edit_file codebase/...` call from the
 *     same ctx is still rejected (the `total-drying-apron` mutate
 *     guard is preserved).
 *
 * If this test fails, recheck:
 *   1. `agents/common/tool/handlers/runCommand.ts` outer gate reads
 *      `allowShellExecution`, NOT `allowMutateInCodebase`.
 *   2. `agents/architect/graph/code/nodes/tool/index.ts` wires
 *      `allowShellExecution: true` unconditionally.
 *   3. `tasks/_shared/verify/markVerifyEntered.ts` set the
 *      `_verifyEntered` channel before this ctx is built (verification
 *      plan first-entry).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleRunCommand } from '../../src/agents/common/tool/handlers/runCommand';
import { handleEditFile } from '../../src/agents/common/tool/handlers/editFile';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

function silentChatStatus(): ToolExecutionContext['chatStatus'] {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

/**
 * Mirror the ctx shape that
 * `architect/graph/code/nodes/tool/index.ts::buildContext` produces for
 * a verification task in plan phase. The two flags below are the post-
 * fix wiring; the rest are minimal scaffolding the handlers need.
 */
function makeCodeVerificationPlanCtx(workspacePath: string): ToolExecutionContext {
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
    featurePath: workspacePath,
    activePhase: 'plan',
    currentTaskType: 'verification',
    verifyModeActive: true,
    // Plan phase — `codebase/` writes still belong to execute. The
    // mutate guard MUST stay closed even though the verification task
    // runs in plan phase.
    allowMutateInCodebase: false,
    // Shell execution — the verification plan tool-loop's primary
    // responsibility is running build / typecheck / test commands.
    // The shell gate is open even though the mutate gate is closed.
    allowShellExecution: true,
  };
}

let workspacePath: string;

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-anp-'));
  fs.mkdirSync(path.join(workspacePath, 'codebase'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'export const a = 1;\n');
});

afterEach(() => {
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

describe('regression — agile-nodding-pouch verification plan silent false-pass', () => {
  it('passes the outer shell gate for `pnpm typecheck` (the exact command the LLM tried)', async () => {
    const ctx = makeCodeVerificationPlanCtx(workspacePath);
    const result = await handleRunCommand(ctx, {
      command: 'pnpm typecheck',
      working_directory: 'codebase',
    });

    // The pre-fix behaviour returned the `rejectRunCommand()` content
    // here ("not available in this job"). After the split, the outer
    // gate passes and execution falls through to the inner CommandPort
    // resolution. The test ctx omits the `command` port deliberately
    // so we observe gate-pass without spawning a real process —
    // executeCommandLogic responds with 'CommandPort not available'
    // when the port is missing.
    expect(result.content).not.toMatch(/not available in this job/);
    expect(result.content).toMatch(/CommandPort not available/);
  });

  it('keeps the `codebase/` mutate guard closed in the same ctx (orthogonality)', async () => {
    const ctx = makeCodeVerificationPlanCtx(workspacePath);
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });

    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\/foo\.ts/);
    expect(result.content).toMatch(/read-only/);
    expect(fs.readFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'utf-8'))
      .toBe('export const a = 1;\n');
  });
});
