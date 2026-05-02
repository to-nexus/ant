/**
 * search_code regression suite — accumulated RCAs.
 *
 * Two RCAs are locked here against re-introduction:
 *
 * 1. vast-curling-perch — every search_code call returned
 *    `spawn .../rg ENOENT` because the handler passed the workspace-
 *    relative `resolvedRoot.fsPath` (e.g. `codebase/`) directly as
 *    `spawn`'s cwd. Node resolved it against the SERVER process CWD
 *    (which has no `codebase/`) and surfaced ENOENT against the BINARY
 *    path, disguising the real cause. Tests below move the test
 *    process CWD outside the workspace via `process.chdir(os.tmpdir())`
 *    so a regression to relative-cwd spawn fires loudly.
 *
 * 2. next-intl — search_code returned 0 matches for patterns LLMs would
 *    naturally write (`codebase/.../node_modules/.../**`) because three
 *    defects multiplied: (A) `--glob !node_modules` was added even when
 *    the file_pattern explicitly targeted node_modules; (B) ripgrep's
 *    default ignore stack re-cut node_modules via .gitignore even with
 *    `include_dependencies: true`; (C) the handler set cwd to `codebase/`
 *    and forwarded the file_pattern verbatim, so a `codebase/`-prefixed
 *    glob became `codebase/codebase/...` and could never match.
 *    Tests below cover each defect plus the diagnostics that prevent
 *    a future false negative from being misread as ground truth.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  handleSearchCode,
  decorateRgError,
  planSearch,
  formatZeroMatchMessage,
} from '../../src/agents/common/tool/handlers/searchCode';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const NEEDLE = '__SEARCH_CODE_REGRESSION_NEEDLE__';
const DEPS_NEEDLE = '__SEARCH_CODE_DEPS_NEEDLE__';

let workspacePath: string;
let priorCwd: string;

beforeAll(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-searchcode-cwd-'));

  // Codebase fixture — the canonical NEEDLE in a normal source file.
  fs.mkdirSync(path.join(workspacePath, 'codebase'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'codebase', 'foo.ts'),
    `export const marker = '${NEEDLE}';\n`,
  );

  // Sibling tree fixture — `plan/` is a CANONICAL_FEATURE_DIRS sibling
  // (the SSOT considers it not-codebase), so a file_pattern starting
  // with `plan/` should be searched verbatim, not auto-prefixed with
  // `codebase/`. This is the contract the deleted `wantsWorkspaceScope`
  // branch was approximating; routing through normalizeToCodebasePath
  // makes search_code obey the same canonical set as every other tool.
  fs.mkdirSync(path.join(workspacePath, 'plan'), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, 'plan', 'tracker.md'),
    `# Plan\n\nTracker: ${NEEDLE}\n`,
  );

  // Dependency fixture — file_pattern targeting node_modules MUST find
  // this even though .gitignore below would normally cut it.
  const depDir = path.join(workspacePath, 'codebase', 'apps', 'hub', 'node_modules', 'demo-lib', 'dist');
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(
    path.join(depDir, 'index.js'),
    `module.exports = "${DEPS_NEEDLE}";\n`,
  );
  // Realistic .gitignore that would mask node_modules from ripgrep's
  // default scan — this is the defect-B trigger.
  fs.writeFileSync(
    path.join(workspacePath, '.gitignore'),
    'node_modules/\ndist/\nbuild/\n',
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

  it('returns a structured "no matches" (never spawn ENOENT) when file_pattern targets a non-existent path', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: 'features/nonexistent/**/*.ts',
    });
    expect(result.error).not.toMatch(/spawn.*ENOENT/);
    expect(result.error).toMatch(/No matches found/);
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

// ─────────────────────────────────────────────────────────────────────
// next-intl RCA — defects A·B·C·D
// ─────────────────────────────────────────────────────────────────────

describe('handleSearchCode — file_pattern unification (next-intl RCA)', () => {
  it('defect C: matches even when file_pattern carries a `codebase/` prefix (no double-up)', async () => {
    // Pre-fix: cwd was already `codebase/`, so this glob became
    // `codebase/codebase/foo.ts` and could never match. Post-fix:
    // normalizeToCodebasePath collapses the double-prefix.
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: 'codebase/foo.ts',
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(NEEDLE);
    expect(result.content).toContain('codebase/foo.ts');
  });

  it('defect C: matches when file_pattern carries no prefix at all (auto-codebase)', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: '**/*.ts',
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(NEEDLE);
  });

  it('exposes the normalize correction to the caller (filePatternFix notice in success path)', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: '**/*.ts',  // bare glob → normalize prepends `codebase/`
    });
    expect(result.content).toMatch(/file_pattern auto-corrected/);
    expect(result.content).toMatch(/\*\*\/\*\.ts/);
    expect(result.content).toMatch(/codebase\/\*\*\/\*\.ts/);
  });

  it('defect A+B: file_pattern targeting node_modules auto-enables deps mode AND bypasses .gitignore', async () => {
    // The killer case from the next-intl session — workspace gitignores
    // node_modules, file_pattern explicitly targets it, no
    // include_dependencies hint. Pre-fix returned 0 matches; post-fix
    // must find the dep needle.
    const result = await handleSearchCode(makeCtx(), {
      pattern: DEPS_NEEDLE,
      file_pattern: 'codebase/apps/hub/node_modules/demo-lib/**/*.js',
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(DEPS_NEEDLE);
    expect(result.content).toContain('demo-lib');
  });

  it('defect A+B: explicit include_dependencies still works (the documented @types/* use case)', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: DEPS_NEEDLE,
      include_dependencies: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(DEPS_NEEDLE);
  });

  it('default search (no file_pattern, no include_dependencies) does NOT leak deps results', async () => {
    // The flip side — must not regress the perf-default by accidentally
    // searching node_modules in routine project searches.
    const result = await handleSearchCode(makeCtx(), {
      pattern: DEPS_NEEDLE,
    });
    expect(result.error).toMatch(/No matches found/);
    expect(result.content).not.toContain('demo-lib');
  });

  it('sibling tree (plan/, architecture/, visual/, assets/, meta/, sessions/) is searchable verbatim', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: NEEDLE,
      file_pattern: 'plan/**/*.md',
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(NEEDLE);
    expect(result.content).toContain('plan/tracker.md');
  });

  it('defect D: zero-match response carries [search context] block with cwd / excludes / deps state', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: '__will_not_match_anywhere__',
    });
    expect(result.error).toMatch(/No matches found/);
    expect(result.error).toContain('[search context]');
    expect(result.error).toContain(`cwd: ${workspacePath}`);
    expect(result.error).toMatch(/appliedExcludes:.*node_modules/);
    expect(result.error).toMatch(/include_dependencies: false/);
    expect(result.error).toMatch(/--no-ignore applied: false/);
  });

  it('defect D: zero-match diagnostics show normalize correction when file_pattern was rewritten', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: '__will_not_match_anywhere__',
      file_pattern: '**/*.nonexistent-extension',
    });
    expect(result.error).toContain('file_pattern normalized');
    expect(result.error).toContain('codebase/**/*.nonexistent-extension');
  });

  it('defect D: zero-match diagnostics flag auto-inferred deps mode explicitly', async () => {
    const result = await handleSearchCode(makeCtx(), {
      pattern: '__will_not_match_anywhere__',
      file_pattern: 'codebase/apps/hub/node_modules/some-lib/**/*.js',
    });
    expect(result.error).toMatch(/include_dependencies: true.*auto-inferred/);
    expect(result.error).toMatch(/--no-ignore applied: true/);
  });
});

describe('planSearch — pure decision logic (encapsulation contract)', () => {
  function fs(): FileSystemAdapter {
    return new FileSystemAdapter(workspacePath);
  }

  it('cwd is always the workspace root (no hidden second prefix layer)', () => {
    const plan = planSearch({ pattern: 'x' }, fs());
    expect(plan.cwd).toBe(workspacePath);
  });

  it('file_pattern with no prefix gets `codebase/` prepended', () => {
    const plan = planSearch({ pattern: 'x', file_pattern: '**/*.ts' }, fs());
    expect(plan.effectiveFilePattern).toBe('codebase/**/*.ts');
    expect(plan.filePatternFix).toMatch(/auto-corrected/);
  });

  it('file_pattern with sibling prefix (plan/, architecture/, ...) is preserved verbatim', () => {
    // The SSOT (CANONICAL_FEATURE_DIRS) treats these as not-codebase,
    // so normalize must NOT prepend `codebase/`.
    for (const sibling of ['plan', 'architecture', 'visual', 'assets', 'meta', 'sessions']) {
      const p = planSearch({ pattern: 'x', file_pattern: `${sibling}/foo.md` }, fs());
      expect(p.effectiveFilePattern, sibling).toBe(`${sibling}/foo.md`);
      expect(p.filePatternFix, sibling).toBeUndefined();
    }
  });

  it('file_pattern targeting node_modules auto-enables deps mode + --no-ignore', () => {
    const plan = planSearch(
      { pattern: 'x', file_pattern: 'codebase/x/node_modules/y/*.js' },
      fs(),
    );
    expect(plan.effectiveIncludeDeps).toBe(true);
    expect(plan.noIgnore).toBe(true);
    expect(plan.appliedExcludes).not.toContain('node_modules');
    expect(plan.appliedExcludes).toContain('.git');
  });

  it('explicit include_dependencies enables deps mode + --no-ignore even without a file_pattern', () => {
    const plan = planSearch({ pattern: 'x', include_dependencies: true }, fs());
    expect(plan.effectiveIncludeDeps).toBe(true);
    expect(plan.noIgnore).toBe(true);
  });

  it('default search keeps DEFAULT_EXCLUDES and does NOT add --no-ignore (perf path)', () => {
    const plan = planSearch({ pattern: 'x' }, fs());
    expect(plan.effectiveIncludeDeps).toBe(false);
    expect(plan.noIgnore).toBe(false);
    expect(plan.appliedExcludes).toEqual(['node_modules', '.git', 'dist', 'build']);
    expect(plan.rgArgs).not.toContain('--no-ignore');
  });

  it('rgArgs is built from the same plan fields — no hidden state', () => {
    const plan = planSearch(
      { pattern: 'foo', file_pattern: '**/*.ts' },
      fs(),
    );
    expect(plan.rgArgs).toContain('--glob');
    expect(plan.rgArgs).toContain('!node_modules');
    expect(plan.rgArgs).toContain('codebase/**/*.ts');
    expect(plan.rgArgs[plan.rgArgs.length - 3]).toBe('--');
    expect(plan.rgArgs[plan.rgArgs.length - 2]).toBe('foo');
    expect(plan.rgArgs[plan.rgArgs.length - 1]).toBe('.');
  });
});

describe('formatZeroMatchMessage — diagnostic shape', () => {
  function basePlan(overrides: Partial<ReturnType<typeof planSearch>> = {}) {
    const fs = new FileSystemAdapter(workspacePath);
    const plan = planSearch({ pattern: 'x' }, fs);
    return { ...plan, ...overrides };
  }

  it('always includes cwd / appliedExcludes / include_dependencies / --no-ignore lines', () => {
    const msg = formatZeroMatchMessage('foo', undefined, basePlan());
    expect(msg).toContain('cwd:');
    expect(msg).toContain('appliedExcludes:');
    expect(msg).toContain('include_dependencies:');
    expect(msg).toContain('--no-ignore applied:');
  });

  it('omits the "file_pattern normalized" line when normalize was a no-op', () => {
    const plan = basePlan({ effectiveFilePattern: 'features/foo.md' });
    const msg = formatZeroMatchMessage('x', 'features/foo.md', plan);
    expect(msg).not.toContain('file_pattern normalized');
  });

  it('includes the "file_pattern normalized" line when raw differs from effective', () => {
    const plan = basePlan({ effectiveFilePattern: 'codebase/**/*.ts' });
    const msg = formatZeroMatchMessage('x', '**/*.ts', plan);
    expect(msg).toContain('file_pattern normalized');
    expect(msg).toContain('"**/*.ts" → "codebase/**/*.ts"');
  });

  it('flags auto-inferred deps mode with an inline note on the include_dependencies line', () => {
    const plan = basePlan({
      effectiveFilePattern: 'codebase/x/node_modules/y/*.js',
      effectiveIncludeDeps: true,
      noIgnore: true,
      appliedExcludes: ['.git'],
    });
    const msg = formatZeroMatchMessage('x', 'codebase/x/node_modules/y/*.js', plan);
    expect(msg).toMatch(/include_dependencies: true.*auto-inferred/);
  });
});
