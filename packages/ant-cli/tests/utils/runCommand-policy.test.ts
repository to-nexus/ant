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
