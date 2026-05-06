/**
 * Codebase mutation gate + shell execution gate — handler-level guards.
 *
 * Locks the policy SSOT defined in
 * `agents/common/tool/handlers/codebaseGate.ts`. Two orthogonal gates:
 *
 *   - `allowMutateInCodebase` (path-aware) — `edit_file` / `delete_file`
 *     / `mkdir` / `create_file` reject paths under `codebase/` when
 *     `false`. Set to `true` ONLY for the architect/code job's
 *     `execute` phase.
 *   - `allowShellExecution` (binary) — `run_command` is rejected
 *     outright when `false`. Set to `true` for the architect/code job
 *     (every phase: plan tool-loop runs verification gates / installs
 *     / probes; execute applies fixes). Document- or plan-producing
 *     jobs (architect/design, planner) leave it `false`.
 *
 * Artifact paths (architecture/, plan/, assets/, visual/, meta/) stay
 * mutable across the matrix — refactor / document-update intents need
 * them.
 *
 * The two gates were a single `allowMutateInCodebase` flag historically;
 * the split was made after the `agile-nodding-pouch` silent false-pass
 * regression where the verification task plan phase could not run any
 * gates because it shared `false` with document-producing phases. The
 * matrix below is the canonical truth table for the four ctx shapes
 * each phase produces:
 *
 * | ctx shape                  | mutate | shell | semantics                |
 * |----------------------------|--------|-------|--------------------------|
 * | code-execute               | true   | true  | source code phase        |
 * | code-plan (NEW)            | false  | true  | plan tool-loop runs gates |
 * | design (plan + docGen) /   | false  | false | document-producing phase |
 * |   planner                  |        |       |                          |
 * | undefined / undefined      | n/a    | n/a   | safe default (closed)    |
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleEditFile } from '../../src/agents/common/tool/handlers/editFile';
import { handleDeleteFile } from '../../src/agents/common/tool/handlers/deleteFile';
import { handleMkdir } from '../../src/agents/common/tool/handlers/mkdir';
import { handleCreateFile } from '../../src/agents/common/tool/handlers/createFile';
import { handleRunCommand } from '../../src/agents/common/tool/handlers/runCommand';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

function silentChatStatus(): ToolExecutionContext['chatStatus'] {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

interface CtxFlags {
  /** `allowMutateInCodebase` — omit for the safe-default test. */
  mutate?: boolean;
  /** `allowShellExecution` — omit for the safe-default test. */
  shell?: boolean;
}

function makeCtx(workspacePath: string, flags: CtxFlags = {}): ToolExecutionContext {
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
    allowMutateInCodebase: flags.mutate,
    allowShellExecution: flags.shell,
  };
}

let workspacePath: string;

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-mutate-gate-'));
  fs.mkdirSync(path.join(workspacePath, 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'architecture/spec'), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, 'plan'), { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'export const a = 1;\n');
  fs.writeFileSync(
    path.join(workspacePath, 'architecture/spec/spec.md'),
    '# Spec\nold body\n',
  );
  fs.writeFileSync(path.join(workspacePath, 'plan/prd.md'), '# PRD\nold body\n');
});

afterEach(() => {
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------
// Design / planner ctx — both gates closed.
// ---------------------------------------------------------------------
describe('design / planner ctx (mutate=false, shell=false)', () => {
  it('rejects edit_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
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

  it('rejects delete_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleDeleteFile(ctx, { path: 'codebase/foo.ts' });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\/foo\.ts/);
    expect(fs.existsSync(path.join(workspacePath, 'codebase/foo.ts'))).toBe(true);
  });

  it('rejects mkdir under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleMkdir(ctx, { path: 'codebase/newdir' });
    expect(result.error).toBeDefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/newdir'))).toBe(false);
  });

  it('rejects create_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleCreateFile(ctx, {
      path: 'codebase/new.ts',
      content: 'export const x = 1;\n',
    });
    expect(result.error).toBeDefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/new.ts'))).toBe(false);
  });

  it('rejects run_command outright (no path inference possible)', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleRunCommand(ctx, { command: 'ls' });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/run_command/);
    expect(result.content).toMatch(/not available in this job/);
  });

  it('allows edit_file on artifact path (architecture/spec/...)', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleEditFile(ctx, {
      path: 'architecture/spec/spec.md',
      old_str: 'old body',
      new_str: 'new body',
    });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(workspacePath, 'architecture/spec/spec.md'), 'utf-8'))
      .toContain('new body');
  });

  it('allows delete_file on artifact path (plan/...)', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleDeleteFile(ctx, { path: 'plan/prd.md' });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'plan/prd.md'))).toBe(false);
  });

  it('allows create_file on artifact path (architecture/...)', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: false });
    const result = await handleCreateFile(ctx, {
      path: 'architecture/spec/new-spec.md',
      content: '# New\n',
    });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'architecture/spec/new-spec.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Code execute ctx — both gates open.
// ---------------------------------------------------------------------
describe('code execute ctx (mutate=true, shell=true)', () => {
  it('allows edit_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: true, shell: true });
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'utf-8'))
      .toContain('export const a = 2;');
  });

  it('allows delete_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, { mutate: true, shell: true });
    const result = await handleDeleteFile(ctx, { path: 'codebase/foo.ts' });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/foo.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Code plan ctx — mutate closed, shell open. The orthogonality the
// `agile-nodding-pouch` regression revealed.
// ---------------------------------------------------------------------
describe('code plan ctx (mutate=false, shell=true) — orthogonality regression guard', () => {
  it('still rejects edit_file under codebase/ (mutate gate is independent)', async () => {
    const ctx = makeCtx(workspacePath, { mutate: false, shell: true });
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/read-only/);
    expect(fs.readFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'utf-8'))
      .toBe('export const a = 1;\n');
  });

  it('passes outer shell gate for run_command (verification / test-code / error / dep-discovery sites)', async () => {
    // The handler returns 'CommandPort not available' when the outer
    // shell gate passes but no `command` port is wired (the test ctx
    // intentionally omits the port so we can assert gate-pass without
    // executing real shell commands). The pre-fix behaviour returned
    // `rejectRunCommand()` content here; this case pins the post-fix
    // wiring so future regressions of the gate cannot silently revert
    // it.
    const ctx = makeCtx(workspacePath, { mutate: false, shell: true });
    const result = await handleRunCommand(ctx, { command: 'pnpm typecheck' });
    expect(result.content).not.toMatch(/not available in this job/);
    expect(result.content).toMatch(/CommandPort not available/);
  });
});

// ---------------------------------------------------------------------
// Safe defaults — both flags omitted → both gates closed.
// ---------------------------------------------------------------------
describe('safe defaults (both flags omitted) → both gates closed', () => {
  it('rejects edit_file under codebase/ when allowMutateInCodebase is omitted', async () => {
    const ctx = makeCtx(workspacePath);
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });
    expect(result.error).toBeDefined();
  });

  it('rejects run_command when allowShellExecution is omitted', async () => {
    const ctx = makeCtx(workspacePath);
    const result = await handleRunCommand(ctx, { command: 'ls' });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/not available in this job/);
  });
});
