/**
 * marble-jumping-grove RCA — basis pre-fetch + plan-rag normalize SSOT.
 *
 * The original failure (logged in
 * `to.nexus/probe/gamehub-fe/features/base/sessions/chat.jsonl` at
 * lines 6072–6076 of marble-jumping-grove turn t-fac11e3c):
 *
 *   user_turn directive contained `apps/console/postcss.config.mjs` (raw,
 *   no `codebase/` prefix). decompose's autonomous tool loop dispatched
 *   read_file / list_files calls with the LLM-written raw path, which
 *   the dedicated `discoveryTools` fork rooted at `featurePath` (workspace
 *   root) instead of the actual codebase tree → "Read Failed" cards.
 *
 *   Worker turns later read the same file successfully because they went
 *   through the common `read_file` handler + `normalizeToCodebasePath`
 *   SSOT — only the basis pre-fetch path was broken.
 *
 * The fix (commits c1–c4 of this RCA chain) collapses the discoveryTools
 * fork into the common handler surface and routes plan-rag's
 * `loadErrorFiles` / `loadRequiredFiles` / keyword JSON parsing through
 * the same SSOT. This file locks the resulting invariants.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { handleReadFile, handleListFiles } from '../../src/agents/common/tool/handlers';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';
import { normalizePathArray } from '../../src/agents/architect/graph/code/nodes/plan/rag/keyword';
import { decideRacGate } from '../../src/agents/architect/graph/code/nodes/decompose/racGate';

// ─────────────────────────────────────────────────────────────────────
// Shared fixture — mimics the marble-jumping-grove workspace shape:
//   features/base/codebase/apps/console/postcss.config.mjs
//   features/base/codebase/apps/console/package.json
//   features/base/architecture/spec/spec-foo.md (sibling tree)
// ─────────────────────────────────────────────────────────────────────

const POSTCSS_NEEDLE = '__POSTCSS_CONFIG_NEEDLE__';
const PACKAGE_NEEDLE = '__PACKAGE_JSON_NEEDLE__';

let workspacePath: string;

beforeAll(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-marble-grove-'));
  fs.mkdirSync(path.join(workspacePath, 'codebase/apps/console'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'codebase/apps/console/postcss.config.mjs'),
    `export default { /* ${POSTCSS_NEEDLE} */ };\n`,
  );
  fs.writeFileSync(
    path.join(workspacePath, 'codebase/apps/console/package.json'),
    JSON.stringify({ name: PACKAGE_NEEDLE }, null, 2),
  );
  fs.mkdirSync(path.join(workspacePath, 'architecture/spec'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'architecture/spec/spec-foo.md'),
    '# spec-foo\n',
  );
});

afterAll(() => {
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

function silentChatStatus(): ToolExecutionContext['chatStatus'] {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

function ctx(): ToolExecutionContext {
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Behavioral — common read_file / list_files handle the marble case
// ─────────────────────────────────────────────────────────────────────

describe('marble-jumping-grove — common read_file resolves raw apps/ path', () => {
  it('handleReadFile finds apps/console/postcss.config.mjs (no codebase/ prefix)', async () => {
    const result = await handleReadFile(ctx(), { path: 'apps/console/postcss.config.mjs' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(POSTCSS_NEEDLE);
  });

  it('handleReadFile finds apps/console/package.json (no codebase/ prefix)', async () => {
    const result = await handleReadFile(ctx(), { path: 'apps/console/package.json' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(PACKAGE_NEEDLE);
  });

  it('handleListFiles enumerates apps/console (no codebase/ prefix)', async () => {
    const result = await handleListFiles(ctx(), { directory: 'apps/console' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('postcss.config.mjs');
    expect(result.content).toContain('package.json');
  });

  it('handleReadFile honors the codebase/ prefix when given (idempotent)', async () => {
    const result = await handleReadFile(ctx(), { path: 'codebase/apps/console/postcss.config.mjs' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(POSTCSS_NEEDLE);
  });

  it('handleReadFile reads sibling-tree (architecture/) verbatim', async () => {
    // Locks the orthogonality contract — sibling paths must NOT get a
    // `codebase/` prefix glued in front of them.
    const result = await handleReadFile(ctx(), { path: 'architecture/spec/spec-foo.md' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('# spec-foo');
  });
});

// ─────────────────────────────────────────────────────────────────────
// decompose RAC wrapper — codebase/sibling dispatch via normalize SSOT
// ─────────────────────────────────────────────────────────────────────

describe('marble-jumping-grove — decompose RAC gate dispatches via normalize SSOT', () => {
  it('raw apps/ paths normalize to codebase/ → orthogonal to RAC (always allowed)', () => {
    // The exact LLM input shape from the original session.
    expect(decideRacGate(
      'apps/console/postcss.config.mjs',
      { refs: [], context: ['plan/prd.md'] },
    ).allowed).toBe(true);

    expect(decideRacGate(
      'apps/console/package.json',
      { refs: [], context: ['plan/prd.md'] },
    ).allowed).toBe(true);
  });

  it('apps/ list_files directory is also orthogonal to RAC', () => {
    expect(decideRacGate(
      'apps/console',
      { refs: [], context: ['plan/prd.md'] },
    ).allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// keyword.normalizePathArray — normalize-at-source contract
// ─────────────────────────────────────────────────────────────────────

describe('marble-jumping-grove — keyword normalizePathArray cleans LLM JSON', () => {
  it('prepends codebase/ to bare apps/ paths', () => {
    expect(normalizePathArray(['apps/console/postcss.config.mjs'])).toEqual([
      'codebase/apps/console/postcss.config.mjs',
    ]);
  });

  it('preserves sibling-prefixed paths verbatim', () => {
    expect(normalizePathArray([
      'plan/prd.md',
      'architecture/spec/spec-foo.md',
      'visual/ui/handoff/img.png',
    ])).toEqual([
      'plan/prd.md',
      'architecture/spec/spec-foo.md',
      'visual/ui/handoff/img.png',
    ]);
  });

  it('idempotent on already-normalized codebase/ paths', () => {
    expect(normalizePathArray(['codebase/src/foo.ts'])).toEqual(['codebase/src/foo.ts']);
  });

  it('drops empty / non-string entries', () => {
    expect(normalizePathArray(['apps/x.ts', '', '  ', 42, null, undefined])).toEqual([
      'codebase/apps/x.ts',
    ]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizePathArray(undefined)).toEqual([]);
    expect(normalizePathArray('apps/foo.ts')).toEqual([]);
    expect(normalizePathArray(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Source-text guards — lock the SSOT discipline at every fixed site
// ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

describe('marble-jumping-grove — SSOT discipline source-text guards', () => {
  it('sourceSelector emits chat-status with normalizeToCodebasePath result, not raw tc.input', () => {
    const src = readSrc('agents/architect/graph/design/nodes/docGen/sourceSelector.ts');
    expect(src).toContain('normalizeToCodebasePath');
    // The fixed path uses `displayPath` (the normalized form) — assert
    // both addReadingFile and addReadComplete bind it.
    expect(src).toMatch(/addReadingFile\(displayPath\)/);
    expect(src).toMatch(/addReadComplete\(displayPath \?\? tc\.input\.path/);
    // The bare `tc.input.path` argument must NOT remain on the start
    // emission for read_file (the bug shape).
    expect(src).not.toMatch(/addReadingFile\(tc\.input\.path\)/);
  });

  it('combine.loadRequiredFiles uses normalizeToCodebasePath (not path.join + relative chain)', () => {
    const src = readSrc('agents/architect/graph/code/nodes/plan/rag/combine.ts');
    expect(src).toContain('normalizeToCodebasePath');
    // Lock the new shape inside loadRequiredFiles.
    const fnIdx = src.indexOf('async function loadRequiredFiles(');
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/normalizeToCodebasePath\(filePath\)\.normalized/);
    // The old manual chain MUST be gone from this function.
    expect(fnBody).not.toMatch(/path\.join\(state\.context\.workingDir,\s*filePath\)/);
  });

  it('errorFiles.loadErrorFiles uses normalizeToCodebasePath on resolvedPath', () => {
    const src = readSrc('agents/architect/graph/code/nodes/plan/rag/errorFiles.ts');
    expect(src).toContain('normalizeToCodebasePath');
    expect(src).toMatch(/normalizeToCodebasePath\(resolvedPath\)\.normalized/);
    // Manual chain must be gone.
    expect(src).not.toMatch(/path\.join\(state\.context\.workingDir,\s*resolvedPath\)/);
  });

  it('keyword.ts populates errorFiles + requiredFiles via normalizePathArray', () => {
    const src = readSrc('agents/architect/graph/code/nodes/plan/rag/keyword.ts');
    expect(src).toContain('normalizePathArray');
    // Both fields routed through the helper.
    expect(src).toMatch(/errorFiles:\s*normalizePathArray\(/);
    expect(src).toMatch(/requiredFiles:\s*normalizePathArray\(/);
    // The raw `Array.isArray(parsed.errorFiles) ? parsed.errorFiles : ...`
    // shape MUST be gone for these two fields.
    expect(src).not.toMatch(/errorFiles:\s*Array\.isArray\(parsed\.errorFiles\)/);
    expect(src).not.toMatch(/requiredFiles:\s*Array\.isArray\(parsed\.requiredFiles\)/);
  });

  it('decompose/index.ts wires common handlers + decideRacGate (no discoveryTools resurrection)', () => {
    const src = readSrc('agents/architect/graph/code/nodes/decompose/index.ts');
    expect(src).toContain('handleReadFile');
    expect(src).toContain('handleListFiles');
    expect(src).toContain('decideRacGate');
    // discoveryTools must stay deleted.
    expect(src).not.toContain("from './discoveryTools'");
    expect(src).not.toContain("import('./discoveryTools')");
    expect(src).not.toContain('createDiscoveryToolHandler');
  });
});
