import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  detectWritePathViolations,
  extractWriteTargets,
  isLikelyBuildCommand,
} from '../../src/agents/common/tool/handlers/runCommand';

describe('extractWriteTargets', () => {
  it('extracts a simple `> file` redirect target', () => {
    expect(extractWriteTargets('echo hi > codebase/log.txt')).toContain('codebase/log.txt');
  });

  it('extracts `mkdir -p` targets', () => {
    expect(extractWriteTargets('mkdir -p codebase/build codebase/dist')).toEqual(
      expect.arrayContaining(['codebase/build', 'codebase/dist']),
    );
  });

  it('does NOT extract `{` from JS arrow-function body inside `node -e`', () => {
    // Regression: log idx 163 — false positive `Violations: "{" → resolves to "{"`
    const cmd = `node -e "(async () => { const fetchOpts = { redirect: 'manual' }; for (const p of ['/','/sign-in']) { console.log(p); } })()"`;
    const targets = extractWriteTargets(cmd);
    expect(targets).not.toContain('{');
    // The command has no real redirect target, so nothing legitimate is captured either
    expect(targets).toEqual([]);
  });

  it('does NOT extract pseudo-targets from quoted strings', () => {
    expect(extractWriteTargets(`echo "hello > /etc/passwd" > codebase/log.txt`)).toEqual([
      'codebase/log.txt',
    ]);
  });

  it('extracts `cp` last argument as destination', () => {
    expect(extractWriteTargets('cp -r codebase/src codebase/backup')).toContain(
      'codebase/backup',
    );
  });

  // zinc-bracing-gavel: quoted paths with spaces/Korean were masked into bare
  // `"` tokens, producing garbage `Violations: - """` on legitimate copies.
  it('extracts the real destination from a double-quoted cp with spaces and Korean', () => {
    const cmd = 'cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.28.03.png" codebase/images/screenshot-1.png';
    expect(extractWriteTargets(cmd)).toEqual(['codebase/images/screenshot-1.png']);
  });

  it('extracts a quoted destination itself as its unquoted value', () => {
    const cmd = 'cp source.png "codebase/images/한글 이름.png"';
    expect(extractWriteTargets(cmd)).toEqual(['codebase/images/한글 이름.png']);
  });

  it('extracts quoted mkdir/touch/mv targets with spaces', () => {
    expect(extractWriteTargets('mkdir -p "codebase/my dir"')).toEqual(['codebase/my dir']);
    expect(extractWriteTargets('touch "codebase/a b.txt"')).toEqual(['codebase/a b.txt']);
    expect(extractWriteTargets('mv "old name.txt" "codebase/new name.txt"')).toEqual(['codebase/new name.txt']);
  });

  it('extracts a quoted redirect target (previous false negative)', () => {
    expect(extractWriteTargets('echo hi > "codebase/out dir/log.txt"')).toEqual(['codebase/out dir/log.txt']);
  });

  it('does NOT treat fd duplication (`2>&1`) as a write target', () => {
    expect(extractWriteTargets('npm run build > codebase/build.log 2>&1')).toEqual(['codebase/build.log']);
  });
});

describe('detectWritePathViolations', () => {
  const project = '/srv/workspace';
  const workingDir = '/srv/workspace/codebase';

  it('reports `/tmp/...` redirect as escape', () => {
    const v = detectWritePathViolations(
      'npm run dev > /tmp/dev.log 2>&1',
      workingDir,
      project,
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/escape|outside/i);
  });

  it('does NOT flag `node -e` arrow-function as a violation', () => {
    const cmd = `node -e "(async () => { console.log('hi') })()"`;
    expect(detectWritePathViolations(cmd, workingDir, project)).toEqual([]);
  });

  it('flags `.git` writes', () => {
    const v = detectWritePathViolations(
      'echo break > codebase/.git/config',
      workingDir,
      project,
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/\.git/);
  });

  it('allows a quoted-space Korean cp into codebase/ (zinc-bracing-gavel)', () => {
    // Default workingDir is the feature root (no working_directory arg).
    const cmd = 'cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.28.03.png" codebase/images/screenshot-1.png && cp "visual/ui/handoff/스크린샷 2026-08-21 오후 11.33.05.png" codebase/images/screenshot-2.png && echo "copy done"';
    expect(detectWritePathViolations(cmd, project, project)).toEqual([]);
  });

  it('still rejects a quoted destination outside codebase/', () => {
    const v = detectWritePathViolations('cp a.txt "/etc/target file"', workingDir, project);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/escape|outside/i);
  });

  it('rejects double-quoted shell expansions as write targets (fail-closed)', () => {
    const v = detectWritePathViolations('cp a.txt "$HOME/evil.txt"', workingDir, project);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toMatch(/expansion/);
  });
});

describe('isLikelyBuildCommand', () => {
  for (const cmd of [
    'npm run build',
    'pnpm build',
    'pnpm run build',
    'yarn build',
    'next build',
    'vite build',
    'tsc -p tsconfig.build.json',
    'tsc --build',
    'tsc',
    'vitest run',
    'jest',
    'playwright test',
    'go build ./...',
    'cargo build',
    'turbo run build',
    'npm test',
    'pnpm test',
    'npm run typecheck',
  ]) {
    it(`recognises: ${cmd}`, () => {
      expect(isLikelyBuildCommand(cmd)).toBe(true);
    });
  }

  for (const cmd of [
    'npm run dev',
    'next dev',
    'vite',
    'cargo run',
    'echo hi',
    'ls',
  ]) {
    it(`does NOT match: ${cmd}`, () => {
      expect(isLikelyBuildCommand(cmd)).toBe(false);
    });
  }
});
