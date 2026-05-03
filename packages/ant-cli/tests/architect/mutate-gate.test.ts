/**
 * Codebase mutation gate — handler-level path guard tests.
 *
 * Locks the policy SSOT defined in `agents/common/tool/handlers/codebaseGate.ts`:
 *   - `allowMutateInCodebase === true` → mutate handlers may write
 *     under `codebase/`. (architect/code job's `execute` phase only.)
 *   - `allowMutateInCodebase !== true` → mutate handlers reject paths
 *     under `codebase/` and `run_command` is rejected outright. Every
 *     other phase (architect/design plan + docGen, architect/code
 *     plan, planner/plan) leaves the flag falsy.
 *
 * Artifact paths (architecture/, plan/, assets/, visual/, meta/) stay
 * mutable across the matrix — refactor / document-update intents need
 * them.
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

function makeCtx(workspacePath: string, allow: boolean | undefined): ToolExecutionContext {
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
    allowMutateInCodebase: allow,
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

describe('codebase mutation gate — gate closed (allowMutateInCodebase !== true)', () => {
  it('rejects edit_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\/foo\.ts/);
    expect(result.content).toMatch(/read-only/);
    // File on disk MUST be untouched.
    expect(fs.readFileSync(path.join(workspacePath, 'codebase/foo.ts'), 'utf-8'))
      .toBe('export const a = 1;\n');
  });

  it('rejects delete_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleDeleteFile(ctx, { path: 'codebase/foo.ts' });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/codebase\/foo\.ts/);
    expect(fs.existsSync(path.join(workspacePath, 'codebase/foo.ts'))).toBe(true);
  });

  it('rejects mkdir under codebase/', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleMkdir(ctx, { path: 'codebase/newdir' });
    expect(result.error).toBeDefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/newdir'))).toBe(false);
  });

  it('rejects create_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleCreateFile(ctx, {
      path: 'codebase/new.ts',
      content: 'export const x = 1;\n',
    });
    expect(result.error).toBeDefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/new.ts'))).toBe(false);
  });

  it('rejects run_command outright (no path inference possible)', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleRunCommand(ctx, { command: 'ls' });
    expect(result.error).toBeDefined();
    expect(result.content).toMatch(/run_command/);
    expect(result.content).toMatch(/unavailable in this phase/);
  });

  it('allows edit_file on artifact path (architecture/spec/...)', async () => {
    const ctx = makeCtx(workspacePath, false);
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
    const ctx = makeCtx(workspacePath, false);
    const result = await handleDeleteFile(ctx, { path: 'plan/prd.md' });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'plan/prd.md'))).toBe(false);
  });

  it('allows create_file on artifact path (architecture/...)', async () => {
    const ctx = makeCtx(workspacePath, false);
    const result = await handleCreateFile(ctx, {
      path: 'architecture/spec/new-spec.md',
      content: '# New\n',
    });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'architecture/spec/new-spec.md'))).toBe(true);
  });
});

describe('codebase mutation gate — gate open (allowMutateInCodebase === true, code execute)', () => {
  it('allows edit_file under codebase/', async () => {
    const ctx = makeCtx(workspacePath, true);
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
    const ctx = makeCtx(workspacePath, true);
    const result = await handleDeleteFile(ctx, { path: 'codebase/foo.ts' });
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, 'codebase/foo.ts'))).toBe(false);
  });
});

describe('codebase mutation gate — undefined flag defaults to closed (safe default)', () => {
  it('rejects edit_file under codebase/ when allowMutateInCodebase is omitted', async () => {
    const ctx: ToolExecutionContext = {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: silentChatStatus(),
      workingDir: workspacePath,
      // allowMutateInCodebase intentionally omitted
    };
    const result = await handleEditFile(ctx, {
      path: 'codebase/foo.ts',
      old_str: 'export const a = 1;',
      new_str: 'export const a = 2;',
    });
    expect(result.error).toBeDefined();
  });
});
