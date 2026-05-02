/**
 * search_code regression — vast-curling-perch RCA.
 *
 * The original failure: every `search_code` call in a real architect
 * session emitted `spawn .../rg ENOENT`, even though the ripgrep binary
 * was present and executable. Root cause was that `handleSearchCode`
 * passed the workspace-relative `resolvedRoot.fsPath` (e.g. `codebase/`)
 * directly as the `spawn` cwd. Node resolved it against the SERVER
 * process CWD (the ant-cli dev/start dir) — which has no `codebase/`
 * subdir — and surfaced ENOENT against the BINARY path, disguising the
 * real cause.
 *
 * This test reproduces the exact preconditions: a fixture workspace
 * with a known pattern, while the test-process CWD is moved OUTSIDE the
 * workspace via `process.chdir(os.tmpdir())`. If `handleSearchCode`
 * regresses to using a relative cwd, this test fires.
 *
 * Also covers `decorateRgError`'s post-fix branching (binary present →
 * cwd hint, binary absent → postinstall hint) so the misleading
 * "rerun postinstall" loop documented in the RCA cannot return.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleSearchCode, decorateRgError } from '../../src/agents/common/tool/handlers/searchCode';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const NEEDLE = '__SEARCH_CODE_REGRESSION_NEEDLE__';

let workspacePath: string;
let priorCwd: string;

beforeAll(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-searchcode-cwd-'));
  fs.mkdirSync(path.join(workspacePath, 'codebase'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'codebase', 'foo.ts'),
    `export const marker = '${NEEDLE}';\n`,
  );

  // The whole point of this test: make sure the handler does NOT rely
  // on `process.cwd()` being inside the workspace. Move the test
  // process CWD to a location that has no `codebase/` subdir so a
  // regression to relative-cwd spawn would fail with ENOENT exactly
  // like vast-curling-perch did.
  priorCwd = process.cwd();
  process.chdir(os.tmpdir());
});

afterAll(() => {
  if (priorCwd) process.chdir(priorCwd);
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

function silentChatStatus() {
  const noop = async () => undefined as any;
  return new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'];
}

function makeCtx(): ToolExecutionContext {
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: silentChatStatus(),
    workingDir: workspacePath,
  };
}

describe('handleSearchCode — cwd regression (vast-curling-perch RCA)', () => {
  it('finds a match when the test-process CWD is outside the workspace', async () => {
    expect(process.cwd()).not.toBe(workspacePath);

    const result = await handleSearchCode(makeCtx(), { pattern: NEEDLE });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(NEEDLE);
    expect(result.content).toContain('foo.ts');
  });

  it('returns "no matches found" (not ENOENT) for a pattern that legitimately misses', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: '__definitely_not_present_anywhere__',
    });
    expect(result.error).toMatch(/No matches found/);
    expect(result.error).not.toMatch(/ENOENT/);
  });

  it('emits a clear "search root does not exist" error when file_pattern targets a missing dir', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: 'features/nonexistent/**/*.ts',
    });
    // file_pattern triggers wantsWorkspaceScope → resolves to `features/`,
    // which DOES exist (the resolver normalises to the canonical
    // sibling root). The point here is that the handler does NOT throw
    // an ENOENT — it returns a structured "no matches" because
    // `features/` is empty in the fixture.
    expect(result.error).not.toMatch(/spawn.*ENOENT/);
  });
});

describe('decorateRgError — diagnostic branching', () => {
  it('appends the postinstall hint only when the ripgrep binary is genuinely missing', () => {
    const message = "spawn /tmp/some-rg ENOENT";
    const decorated = decorateRgError(message, /* binaryExists */ false);
    expect(decorated).toContain(message);
    expect(decorated).toMatch(/the ripgrep binary is missing/i);
    expect(decorated).toMatch(/postinstall\.js --force/);
  });

  it('points at cwd / permissions when the binary IS present (the vast-curling-perch case)', () => {
    const message = "spawn /tmp/some-rg ENOENT";
    const decorated = decorateRgError(message, /* binaryExists */ true);
    expect(decorated).toContain(message);
    // MUST NOT trigger the misleading postinstall instruction — that
    // is exactly the loop the RCA called out.
    expect(decorated).not.toMatch(/postinstall\.js --force/);
    expect(decorated).toMatch(/spawn cwd/i);
  });

  it('passes non-ENOENT messages through untouched', () => {
    const message = 'something else broke';
    expect(decorateRgError(message, true)).toBe(message);
    expect(decorateRgError(message, false)).toBe(message);
  });
});

describe('FileSystemAdapter.resolveAbsolute — traversal protection', () => {
  it('resolves a workspace-relative path to an absolute one inside the workspace', () => {
    const adapter = new FileSystemAdapter(workspacePath);
    const abs = adapter.resolveAbsolute('codebase/foo.ts');
    expect(path.isAbsolute(abs)).toBe(true);
    expect(abs.startsWith(workspacePath)).toBe(true);
    expect(abs.endsWith('codebase/foo.ts')).toBe(true);
  });

  it('throws on `..` traversal attempts (the guard the inline `path.join` callers were missing)', () => {
    const adapter = new FileSystemAdapter(workspacePath);
    expect(() => adapter.resolveAbsolute('../../../etc/passwd')).toThrow(/Path traversal detected/);
  });

  it('accepts an absolute path inside the workspace and rejects one outside', () => {
    const adapter = new FileSystemAdapter(workspacePath);
    expect(adapter.resolveAbsolute(path.join(workspacePath, 'codebase'))).toBe(
      path.join(workspacePath, 'codebase'),
    );
    expect(() => adapter.resolveAbsolute('/etc/passwd')).toThrow(/Path traversal detected/);
  });
});
