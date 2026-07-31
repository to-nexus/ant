/**
 * list_files — glob patterns and honest empty results (level-dashing-plumb RCA).
 *
 * `pattern` was a bare `String.includes` while both the architect tool catalog
 * (`pattern="*.tsx"`) and the schema description advertised glob syntax. Every
 * glob therefore matched NOTHING — `'Duck.glb'.includes('*')` is false — and the
 * handler returned an empty string with NO error, which `messageBuilder` hands
 * the LLM as a blank tool_result: indistinguishable from "this directory is
 * empty".
 *
 * In the incident, four probes came back blank, including
 * `list_files('codebase/public/models', '*')` on the directory that held the
 * very file being replaced. The model's own reasoning recorded the consequence:
 * "I'm realizing the list I have is blank, which isn't helpful."
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleListFiles } from '../../src/agents/common/tool/handlers/listFiles';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

function makeCtx(workspacePath: string): ToolExecutionContext {
  const noop = async () => undefined as any;
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
    workingDir: workspacePath,
  } as ToolExecutionContext;
}

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-list-files-'));
  fs.mkdirSync(path.join(ws, 'codebase/public/models'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'codebase/public/models/Duck.glb'), 'x');
  fs.mkdirSync(path.join(ws, 'codebase/src'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'codebase/src/App.tsx'), 'x');
  fs.writeFileSync(path.join(ws, 'codebase/src/main.ts'), 'x');
  fs.writeFileSync(path.join(ws, 'codebase/src/Button.tsx'), 'x');
});

afterEach(() => {
  if (ws) fs.rmSync(ws, { recursive: true, force: true });
});

describe("list_files — pattern '*' (the incident probe)", () => {
  it("pattern '*' lists everything instead of filtering everything out", async () => {
    const result = await handleListFiles(makeCtx(ws), {
      directory: 'codebase/public/models',
      pattern: '*',
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Duck.glb');
  });

  it("pattern '*' on a populated source dir returns all entries", async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: '*' });
    expect(result.content).toContain('App.tsx');
    expect(result.content).toContain('main.ts');
    expect(result.content).toContain('Button.tsx');
  });
});

describe('list_files — glob vs substring', () => {
  it("glob '*.tsx' matches only .tsx (the syntax the prompt documents)", async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: '*.tsx' });
    expect(result.content).toContain('App.tsx');
    expect(result.content).toContain('Button.tsx');
    expect(result.content).not.toContain('main.ts\n');
    expect(result.content?.includes('main.ts')).toBe(false);
  });

  it("glob '?pp.tsx' honors single-character wildcards", async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: '?pp.tsx' });
    expect(result.content).toContain('App.tsx');
    expect(result.content).not.toContain('Button.tsx');
  });

  it('a plain substring pattern keeps working (backward compatible)', async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: 'Butt' });
    expect(result.content).toContain('Button.tsx');
    expect(result.content).not.toContain('App.tsx');
  });

  it('matches a directory entry despite its trailing slash', async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase', pattern: 'pub*' });
    expect(result.content).toContain('public');
  });

  it('an unparseable glob degrades to substring instead of throwing', async () => {
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: '[' });
    expect(result.error).toBeUndefined();
    expect(typeof result.content).toBe('string');
  });
});

describe('list_files — an empty result must speak', () => {
  it('a no-match pattern says so, names the count, and never returns a blank string', async () => {
    const result = await handleListFiles(makeCtx(ws), {
      directory: 'codebase/src',
      pattern: '*.nope',
    });
    expect(result.error).toBeUndefined();
    expect(String(result.content).trim()).not.toBe('');
    expect(result.content).toContain('no entry matching');
    expect(result.content).toContain('3 entries present');
  });

  it('a genuinely empty directory is reported as empty, not as blank output', async () => {
    fs.mkdirSync(path.join(ws, 'codebase/empty'), { recursive: true });
    const result = await handleListFiles(makeCtx(ws), { directory: 'codebase/empty' });
    expect(String(result.content).trim()).not.toBe('');
    expect(result.content).toContain('exists but is empty');
  });

  it('distinguishes "filtered out" from "empty" — the ambiguity that caused the incident', async () => {
    fs.mkdirSync(path.join(ws, 'codebase/empty'), { recursive: true });
    const filtered = await handleListFiles(makeCtx(ws), { directory: 'codebase/src', pattern: 'zzz' });
    const empty = await handleListFiles(makeCtx(ws), { directory: 'codebase/empty' });
    expect(filtered.content).not.toBe(empty.content);
  });
});
