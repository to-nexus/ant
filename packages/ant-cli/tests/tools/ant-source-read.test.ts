/**
 * ant-source read contract — range support + the two cross-namespace
 * redirects (narrow-ending-flour).
 *
 * Locks three behaviors:
 *  1. `readAntSource` honors startLine/endLine (numeric strings included) and
 *     applies the char cap AFTER slicing — a large file's tail is reachable.
 *  2. `handleReadFile`'s not-found reply redirects a platform-source path to
 *     `read_ant_source` instead of suggesting rediscovery/creation — only
 *     when that tool is dispatchable.
 *  3. `handleReadAntSource` redirects to the workspace clone (`codebase/`)
 *     when the same file exists there and `read_file` is dispatchable —
 *     the clone is the SSOT for a job editing the platform itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readAntSource,
  resolveSourceRoot,
  sanitizeOutput,
  findInAntSourceRoots,
  antSourceToCodebasePath,
} from '../../src/agents/common/tool/antSource/core';
import { handleReadAntSource } from '../../src/agents/common/tool/handlers/antSource';
import { handleReadFile } from '../../src/agents/common/tool/handlers/readFile';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

// Real in-repo targets — the roots resolve through WorkspacePathResolver and
// tests run inside the monorepo.
const SMALL_CLI_FILE = 'agents/common/tool/handlers/lineRange.ts';
const LARGE_CLI_FILE = 'agents/common/tool/toolSchemas.ts';
const PLATFORM_FILE = 'core/ports/workflow.ts';

function silentChatStatus(): ToolExecutionContext['chatStatus'] {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

describe('readAntSource — startLine/endLine', () => {
  it('returns the requested slice with a [Lines X-Y of N] header', async () => {
    const root = resolveSourceRoot('cli');
    const total = fs.readFileSync(path.join(root, SMALL_CLI_FILE), 'utf-8').split('\n').length;
    const res = await readAntSource({ path: SMALL_CLI_FILE, startLine: 2, endLine: 4 });
    expect(res.success).toBe(true);
    expect(res.content).toContain(`[Lines 2-4 of ${total}]`);
  });

  it('numeric-string range args coerce — byte-identical to the numeric call', async () => {
    // The incident's shape: GLM sent startLine as "650" and four different
    // ranges returned byte-identical full-head reads.
    const numeric = await readAntSource({ path: SMALL_CLI_FILE, startLine: 2, endLine: 4 });
    const strings = await readAntSource({ path: SMALL_CLI_FILE, startLine: '2', endLine: '4' });
    expect(strings).toEqual(numeric);
  });

  it('caps AFTER slicing — a range past the 10K cap still returns content', async () => {
    const root = resolveSourceRoot('cli');
    const sanitized = sanitizeOutput(fs.readFileSync(path.join(root, LARGE_CLI_FILE), 'utf-8'));
    expect(sanitized.length).toBeGreaterThan(10000);
    const lines = sanitized.split('\n');
    let acc = 0;
    let startLine = 0;
    for (let i = 0; i < lines.length; i++) {
      acc += lines[i].length + 1;
      if (acc > 10000) { startLine = i + 2; break; }
    }
    const endLine = Math.min(startLine + 4, lines.length);
    const res = await readAntSource({ path: LARGE_CLI_FILE, startLine, endLine });
    expect(res.success).toBe(true);
    expect(res.content).toContain(`[Lines ${startLine}-${endLine} of ${lines.length}]`);
    expect(res.content).toContain(lines[startLine - 1]);
  });

  it('full-read truncation names startLine/endLine and the total line count', async () => {
    const root = resolveSourceRoot('cli');
    const sanitized = sanitizeOutput(fs.readFileSync(path.join(root, LARGE_CLI_FILE), 'utf-8'));
    const total = sanitized.split('\n').length;
    const res = await readAntSource({ path: LARGE_CLI_FILE });
    expect(res.success).toBe(true);
    expect(res.content).toContain('startLine/endLine');
    expect(res.content).toContain(`file has ${total} lines`);
  });

  it('startLine > endLine is an explicit error', async () => {
    const res = await readAntSource({ path: SMALL_CLI_FILE, startLine: 9, endLine: 3 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('startLine (9) > endLine (3)');
  });
});

describe('findInAntSourceRoots', () => {
  const rows: Array<[string, string | undefined]> = [
    [PLATFORM_FILE, 'cli'],
    ['no/such/file/anywhere.ts', undefined],
    ['config/.env', undefined], // FORBIDDEN_PATTERNS — never probed
    ['', undefined],
  ];
  it.each(rows)('%s → %s', (rel, expected) => {
    expect(findInAntSourceRoots(rel)).toBe(expected);
  });
});

describe('handleReadFile — platform-source redirect on not-found', () => {
  let workspacePath: string;

  beforeAll(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-antsrc-redirect-'));
  });
  afterAll(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  function ctx(withAntSource: boolean): ToolExecutionContext {
    return {
      fileSystem: new FileSystemAdapter(workspacePath),
      chatStatus: silentChatStatus(),
      workingDir: workspacePath,
      ...(withAntSource ? { availableToolNames: new Set(['read_ant_source']) } : {}),
    };
  }

  it('redirects a bare platform path to read_ant_source and forbids create_file', async () => {
    const res = await handleReadFile(ctx(true), { path: PLATFORM_FILE });
    expect(res.error).toBeDefined();
    expect(res.content).toContain(`read_ant_source({ path: "${PLATFORM_FILE}", source: "cli" })`);
    expect(res.content).toContain('Do not create this file');
    expect(res.content).not.toContain('call create_file');
  });

  it('without read_ant_source in the tool set, the canonical error is unchanged', async () => {
    const res = await handleReadFile(ctx(false), { path: PLATFORM_FILE });
    expect(res.error).toBeDefined();
    expect(res.content).toContain('call create_file');
    expect(res.content).not.toContain('read_ant_source');
  });

  it('a workspace-addressed path (codebase/) is never probed', async () => {
    const res = await handleReadFile(ctx(true), { path: `codebase/${PLATFORM_FILE}` });
    expect(res.error).toBeDefined();
    expect(res.content).not.toContain('read_ant_source');
  });
});

describe('handleReadAntSource — workspace-clone redirect', () => {
  function cloneCtx(opts: { cloneHasFile: boolean; hasReadFile: boolean }): ToolExecutionContext {
    return {
      fileSystem: {
        fileExists: async (p: string) =>
          opts.cloneHasFile && p === antSourceToCodebasePath('cli', PLATFORM_FILE),
      } as any,
      chatStatus: silentChatStatus(),
      workingDir: '/tmp',
      availableToolNames: new Set(opts.hasReadFile ? ['read_file', 'read_ant_source'] : ['read_ant_source']),
    };
  }

  it('clone hit + read_file dispatchable → instructive redirect to the codebase path', async () => {
    const res = await handleReadAntSource(cloneCtx({ cloneHasFile: true, hasReadFile: true }), {
      path: PLATFORM_FILE,
    });
    expect(res.error).toBeDefined();
    expect(res.content).toContain(`read_file("codebase/packages/ant-cli/src/${PLATFORM_FILE}")`);
    expect(res.content).toContain('DIFFERENT version');
  });

  it('clone hit but read_file NOT dispatchable (ask-shaped set) → in-image read proceeds', async () => {
    const res = await handleReadAntSource(cloneCtx({ cloneHasFile: true, hasReadFile: false }), {
      path: PLATFORM_FILE,
    });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('WorkflowStateUpdatePort');
  });

  it('probe miss → in-image read proceeds', async () => {
    const res = await handleReadAntSource(cloneCtx({ cloneHasFile: false, hasReadFile: true }), {
      path: PLATFORM_FILE,
    });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('WorkflowStateUpdatePort');
  });
});
