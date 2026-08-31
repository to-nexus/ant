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
import { handleReadAntSource, handleListAntFiles, handleSearchAntCode } from '../../src/agents/common/tool/handlers/antSource';
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
    ['pipeline.ts', 'shared'], // @ant/shared contract source is a probed root
    ['no/such/file/anywhere.ts', undefined],
    ['config/.env', undefined], // FORBIDDEN_PATTERNS — never probed
    ['', undefined],
  ];
  it.each(rows)('%s → %s', (rel, expected) => {
    expect(findInAntSourceRoots(rel)).toBe(expected);
  });
});

describe('shared source root — the BE↔FE contract SSOT is reachable (pine-crafting-cargo)', () => {
  it('resolveSourceRoot("shared") points at packages/ant-shared/src', () => {
    const root = resolveSourceRoot('shared');
    expect(root.replace(/\\/g, '/')).toMatch(/packages\/ant-shared\/src$/);
    expect(fs.existsSync(path.join(root, 'pipeline.ts'))).toBe(true);
  });

  it('readAntSource reads a shared contract file', async () => {
    const res = await readAntSource({ path: 'pipeline.ts', source: 'shared' });
    expect(res.success).toBe(true);
    expect(res.content).toContain('PipelineDef');
  });

  it('antSourceToCodebasePath maps shared into the clone namespace', () => {
    expect(antSourceToCodebasePath('shared', 'pipeline.ts')).toBe(
      'codebase/packages/ant-shared/src/pipeline.ts',
    );
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

// The clone redirect must cover the SIBLINGS too (small-longing-drive: 21
// un-redirected list/search calls explored the in-image tree and seeded a
// sealed plan with in-image-coordinate citations, which execute could not
// resolve). Same rule as read: redirect only when the workspace-equivalent
// tool is dispatchable; ask-shaped tool sets keep in-image serving.
describe('handleListAntFiles / handleSearchAntCode — workspace-clone redirect', () => {
  function siblingCtx(opts: { cloneExists: boolean; tools: string[] }): ToolExecutionContext {
    return {
      fileSystem: {
        isDirectory: async (p: string) => opts.cloneExists && p === 'codebase/packages/ant-cli/src',
      } as any,
      chatStatus: silentChatStatus(),
      workingDir: '/tmp',
      availableToolNames: new Set(opts.tools),
    } as ToolExecutionContext;
  }

  it('list: clone + list_files dispatchable → instructive redirect naming the mapped path', async () => {
    const res = await handleListAntFiles(siblingCtx({ cloneExists: true, tools: ['list_files', 'list_ant_files'] }), {
      path: 'agents', source: 'cli',
    });
    expect(res.error).toBeDefined();
    expect(res.content).toContain('list_files("codebase/packages/ant-cli/src/agents")');
    expect(res.content).toContain('DIFFERENT version');
  });

  it('list: clone but list_files NOT dispatchable → in-image listing proceeds', async () => {
    const res = await handleListAntFiles(siblingCtx({ cloneExists: true, tools: ['list_ant_files'] }), {
      path: 'agents', source: 'cli',
    });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('common');
  });

  it('search: clone + search_code dispatchable → instructive redirect', async () => {
    const res = await handleSearchAntCode(siblingCtx({ cloneExists: true, tools: ['search_code', 'search_ant_code'] }), {
      query: 'ToolExecutionContext', source: 'cli',
    });
    expect(res.error).toBeDefined();
    expect(res.content).toContain('search_code');
    expect(res.content).toContain('codebase/packages/ant-cli/src');
  });

  it('search: no clone → in-image search proceeds', async () => {
    const res = await handleSearchAntCode(siblingCtx({ cloneExists: false, tools: ['search_code', 'search_ant_code'] }), {
      query: 'ToolExecutionContext', source: 'cli',
    });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('ToolExecutionContext');
  });
});

// Suffix-tolerant not-found resolve (small-longing-drive friction ①): a
// citation omitting one intermediate directory (the `packages/` monorepo
// level) is served directly on a UNIQUE match instead of costing list_files
// rediscovery turns; ambiguity names the candidates instead of guessing.
describe('handleReadFile — unique segment-insertion fallback on not-found', () => {
  let ws: string;

  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-segment-probe-'));
    fs.mkdirSync(path.join(ws, 'codebase/packages/ant-ui/src/utils'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'codebase/packages/ant-ui/src/utils/actor-utils.ts'), 'export const ACTOR_INFO = 1;\n');
  });
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  function wsCtx(): ToolExecutionContext {
    return {
      fileSystem: new FileSystemAdapter(ws),
      chatStatus: silentChatStatus(),
      workingDir: ws,
    } as ToolExecutionContext;
  }

  it('a unique one-segment insertion is served with the corrected path named', async () => {
    const res = await handleReadFile(wsCtx(), { path: 'codebase/ant-ui/src/utils/actor-utils.ts' });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('[Path corrected:');
    expect(res.content).toContain('codebase/packages/ant-ui/src/utils/actor-utils.ts');
    expect(res.content).toContain('export const ACTOR_INFO = 1;');
  });

  it('ambiguous insertions name the candidates instead of guessing', async () => {
    fs.mkdirSync(path.join(ws, 'codebase/vendored/ant-ui/src/utils'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'codebase/vendored/ant-ui/src/utils/actor-utils.ts'), 'export const OTHER = 2;\n');
    const res = await handleReadFile(wsCtx(), { path: 'codebase/ant-ui/src/utils/actor-utils.ts' });
    expect(res.error).toBeDefined();
    expect(res.content).toContain('Similar paths exist');
    expect(res.content).toContain('codebase/packages/ant-ui/src/utils/actor-utils.ts');
    expect(res.content).toContain('codebase/vendored/ant-ui/src/utils/actor-utils.ts');
    fs.rmSync(path.join(ws, 'codebase/vendored'), { recursive: true, force: true });
  });

  it('an exact-match read stays byte-faithful with no correction note', async () => {
    const res = await handleReadFile(wsCtx(), { path: 'codebase/packages/ant-ui/src/utils/actor-utils.ts' });
    expect(res.error).toBeUndefined();
    expect(res.content).not.toContain('[Path corrected:');
    expect(res.content).toContain('export const ACTOR_INFO = 1;');
  });

  it('a genuinely absent file still errors with the canonical guidance', async () => {
    const res = await handleReadFile(wsCtx(), { path: 'codebase/no-such/anything.ts' });
    expect(res.error).toBeDefined();
    expect(res.content).toContain('File not found');
  });
});
