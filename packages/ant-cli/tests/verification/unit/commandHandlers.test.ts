/**
 * Command-handler SSOT — three orthogonal helpers around shell command
 * execution in the agent tool layer:
 *
 *   1. applyCodeCommandPolicy (L1 — post plan §5.4)
 *      Runtime guards: Go build allow-list (verification-cycle-only) and
 *      per-task-type guard dispatch (error task blocks verifies-declared
 *      gates in execute phase).
 *
 *   2. commandInject overlay utility (L1 unit)
 *      Test-time fault injection / overlay for shell command results.
 *      Activation gating, pattern matching, buildInjectedResult defaults,
 *      overlayResult composition.
 *
 *   3. isBareInstallCommand (slim-burning-melon / lime-diving-minty regression)
 *      Detects whether a package-manager install command is "bare" (no
 *      positional package arg, no reinstall-intent flag) and thus
 *      eligible for the run-command skip guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyCodeCommandPolicy } from '../../../src/agents/common/tool/handlers/codeCommandPolicy';
import {
  lookupInjection,
  buildInjectedResult,
  overlayResult,
  isCommandInjectActive,
  __resetCommandInjectCache,
} from '../../../src/utils/commandInject';
import { isBareInstallCommand } from '../../../src/agents/common/tool/handlers/runCommand';
import type { ToolExecutionContext } from '../../../src/agents/common/tool/types';

// ════════════════════════════════════════════════════════════════════════════
// 1. applyCodeCommandPolicy
// ════════════════════════════════════════════════════════════════════════════

function makeCtx(opts: {
  taskType?: string;
  activePhase?: 'plan' | 'execute';
  verifyModeActive?: boolean;
} = {}): ToolExecutionContext {
  return {
    activePhase: opts.activePhase ?? 'plan',
    currentTaskType: opts.taskType ?? 'verification',
    verifyModeActive: opts.verifyModeActive ?? false,
    fileSystem: undefined as any,
    chatStatus: undefined as any,
    workingDir: '/tmp',
  } as unknown as ToolExecutionContext;
}

describe('codeCommandPolicy — Go build allow-list (verification-cycle-only)', () => {
  it('blocks `go build` in an error task', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/verification cycle/);
    expect(result?.error).toBeUndefined();
  });

  it('blocks `go test` in an error task', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go test ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('blocks `go vet` in a feature task', () => {
    const ctx = makeCtx({ taskType: 'feature', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go vet ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('allows `go build` when verify-mode is active', () => {
    const ctx = makeCtx({ taskType: 'verification', verifyModeActive: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result).toBeNull();
  });
});

describe('codeCommandPolicy — error command.guard (execute-phase gate block)', () => {
  it('blocks any verifies-declared gate in error task execute phase', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/remediation plan/);

    expect(applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' })?.content).toMatch(/BLOCKED/);
    expect(applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' })?.content).toMatch(/BLOCKED/);
  });

  it('allows commands without verifies (installs, edits, inspections)', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    expect(applyCodeCommandPolicy(ctx, { command: 'pnpm install foo' })).toBeNull();
    expect(applyCodeCommandPolicy(ctx, { command: 'npm run build' })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. commandInject overlay utility
// ════════════════════════════════════════════════════════════════════════════

function setEnv(rules: unknown, mode?: string) {
  if (rules !== undefined) {
    process.env.ANT_COMMAND_INJECT = typeof rules === 'string' ? rules : JSON.stringify(rules);
  } else {
    delete process.env.ANT_COMMAND_INJECT;
  }
  if (mode) {
    process.env.ANT_COMMAND_OVERLAY_MODE = mode;
  } else {
    delete process.env.ANT_COMMAND_OVERLAY_MODE;
  }
  __resetCommandInjectCache();
}

describe('commandInject utility', () => {
  beforeEach(() => setEnv(undefined));
  afterEach(() => setEnv(undefined));

  describe('activation gating', () => {
    it('returns undefined when both env vars are missing', () => {
      expect(isCommandInjectActive()).toBe(false);
      expect(lookupInjection('pnpm test')).toBeUndefined();
    });

    it('returns undefined when mode is missing', () => {
      setEnv({ rules: [{ pattern: '.*', exitCode: 1 }] });
      expect(isCommandInjectActive()).toBe(false);
    });

    it('returns undefined when rules are missing', () => {
      process.env.ANT_COMMAND_OVERLAY_MODE = 'stub';
      __resetCommandInjectCache();
      expect(isCommandInjectActive()).toBe(false);
    });

    it('malformed JSON → inactive (no crash)', () => {
      setEnv('not valid json {{', 'stub');
      expect(isCommandInjectActive()).toBe(false);
    });

    it('unknown mode → inactive', () => {
      setEnv({ rules: [{ pattern: '.*' }] }, 'bogus');
      expect(isCommandInjectActive()).toBe(false);
    });
  });

  describe('pattern matching', () => {
    it('returns first matching rule', () => {
      setEnv({
        rules: [
          { pattern: 'pnpm test', exitCode: 1, stderr: 'test failed' },
          { pattern: 'tsc', exitCode: 2 },
        ],
      }, 'stub');
      const d = lookupInjection('pnpm test');
      expect(d?.rule.exitCode).toBe(1);
      expect(d?.rule.stderr).toBe('test failed');
    });

    it('first match wins even when multiple rules match', () => {
      setEnv({
        rules: [
          { pattern: 'tsc', exitCode: 1, tag: 'first' },
          { pattern: 'tsc', exitCode: 2, tag: 'second' },
        ],
      }, 'stub');
      expect(lookupInjection('tsc -b')?.rule.tag).toBe('first');
    });

    it('no matching rule → undefined', () => {
      setEnv({ rules: [{ pattern: '^pnpm build$', exitCode: 1 }] }, 'stub');
      expect(lookupInjection('pnpm test')).toBeUndefined();
    });

    it('regex anchors work as expected', () => {
      setEnv({ rules: [{ pattern: '^tsc$', exitCode: 1 }] }, 'stub');
      expect(lookupInjection('tsc')?.rule.exitCode).toBe(1);
      expect(lookupInjection('tsc --noEmit')).toBeUndefined();
    });

    it('propagates configured mode onto decision', () => {
      setEnv({ rules: [{ pattern: '.*', exitCode: 0 }] }, 'overlay');
      expect(lookupInjection('x')?.mode).toBe('overlay');

      setEnv({ rules: [{ pattern: '.*', exitCode: 0 }] }, 'stub');
      expect(lookupInjection('x')?.mode).toBe('stub');
    });
  });

  describe('buildInjectedResult', () => {
    it('defaults exitCode to 0 and stdout/stderr to empty', () => {
      const r = buildInjectedResult({ pattern: '.*' });
      expect(r.exitCode).toBe(0);
      expect(r.success).toBe(true);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    });

    it('success=false when exitCode !== 0', () => {
      const r = buildInjectedResult({ pattern: '.*', exitCode: 1 });
      expect(r.success).toBe(false);
    });

    it('includes provided stdout/stderr verbatim', () => {
      const r = buildInjectedResult({ pattern: '.*', stdout: 'ok', stderr: 'warn' });
      expect(r.stdout).toBe('ok');
      expect(r.stderr).toBe('warn');
    });
  });

  describe('overlayResult', () => {
    const real = { stdout: 'real-out\n', stderr: 'real-err\n', exitCode: 0, success: true };

    it('overrides exitCode with rule value and recomputes success', () => {
      const o = overlayResult(real, { pattern: '.*', exitCode: 1 });
      expect(o.exitCode).toBe(1);
      expect(o.success).toBe(false);
    });

    it('appends rule stdout/stderr to real output', () => {
      const o = overlayResult(real, { pattern: '.*', stdout: 'extra', stderr: 'extra-err' });
      expect(o.stdout).toBe('real-out\nextra');
      expect(o.stderr).toBe('real-err\nextra-err');
    });

    it('keeps real output when rule does not specify stdout/stderr', () => {
      const o = overlayResult(real, { pattern: '.*', exitCode: 2 });
      expect(o.stdout).toBe('real-out\n');
      expect(o.stderr).toBe('real-err\n');
    });

    it('falls back to real exitCode when rule omits it', () => {
      const o = overlayResult({ ...real, exitCode: 7, success: false }, { pattern: '.*' });
      expect(o.exitCode).toBe(7);
      expect(o.success).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. isBareInstallCommand (skip-guard eligibility)
// ════════════════════════════════════════════════════════════════════════════

describe('isBareInstallCommand', () => {
  describe('bare install commands (skip-guard eligible)', () => {
    it('detects plain `pnpm install`', () => {
      expect(isBareInstallCommand('pnpm install')).toBe(true);
    });

    it('detects plain `npm install` and `npm i` and `npm ci`', () => {
      expect(isBareInstallCommand('npm install')).toBe(true);
      expect(isBareInstallCommand('npm i')).toBe(true);
      expect(isBareInstallCommand('npm ci')).toBe(true);
    });

    it('detects plain `yarn install` and bare `yarn`', () => {
      expect(isBareInstallCommand('yarn install')).toBe(true);
      expect(isBareInstallCommand('yarn')).toBe(true);
    });

    it('detects `pip install -r requirements.txt`', () => {
      expect(isBareInstallCommand('pip install -r requirements.txt')).toBe(true);
    });

    it('detects `poetry install` / `bundle install`', () => {
      expect(isBareInstallCommand('poetry install')).toBe(true);
      expect(isBareInstallCommand('bundle install')).toBe(true);
    });
  });

  describe('reinstall-intent flags (skip-guard bypass)', () => {
    it('treats `pnpm install --force` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --force')).toBe(false);
    });

    it('treats `pnpm install --no-frozen-lockfile` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --no-frozen-lockfile')).toBe(false);
    });

    it('treats `pnpm install --frozen-lockfile=false` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --frozen-lockfile=false')).toBe(false);
    });

    it('treats `pnpm install --fix-lockfile` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --fix-lockfile')).toBe(false);
    });

    it('treats `pnpm install --shamefully-hoist` as non-bare', () => {
      expect(isBareInstallCommand('pnpm install --shamefully-hoist')).toBe(false);
    });

    it('treats `pnpm install -f` (short flag) as non-bare', () => {
      expect(isBareInstallCommand('pnpm install -f')).toBe(false);
    });

    it('treats `npm install --force` as non-bare', () => {
      expect(isBareInstallCommand('npm install --force')).toBe(false);
    });
  });

  describe('install with package arg (not bare)', () => {
    it('`pnpm add pkg` is not an install command', () => {
      expect(isBareInstallCommand('pnpm add react')).toBe(false);
    });

    it('`pnpm install some-pkg` is not bare (has positional arg)', () => {
      expect(isBareInstallCommand('pnpm install react')).toBe(false);
    });

    it('`npm install lodash` is not bare', () => {
      expect(isBareInstallCommand('npm install lodash')).toBe(false);
    });

    it('`npm install --save-dev jest` is not bare (flag + positional) — lime-diving-minty', () => {
      expect(isBareInstallCommand('npm install --save-dev jest')).toBe(false);
    });

    it('`npm install --save-dev jest @testing-library/react` is not bare', () => {
      expect(
        isBareInstallCommand('npm install --save-dev jest @testing-library/react'),
      ).toBe(false);
    });

    it('`npm install -D jest` (short dev flag) is not bare', () => {
      expect(isBareInstallCommand('npm install -D jest')).toBe(false);
    });

    it('`pnpm install --save-dev @types/jest` is not bare', () => {
      expect(isBareInstallCommand('pnpm install --save-dev @types/jest')).toBe(false);
    });

    it('positional pkg followed by flag is still not bare', () => {
      expect(isBareInstallCommand('npm install jest --save-dev')).toBe(false);
    });

    it('install piped into another command still respects positional target', () => {
      expect(
        isBareInstallCommand('npm install --save-dev jest | tail -5'),
      ).toBe(false);
    });
  });

  describe('install with flags only (still bare)', () => {
    it('`npm install --save-dev` (no pkg target) is bare', () => {
      expect(isBareInstallCommand('npm install --save-dev')).toBe(true);
    });

    it('`npm install --silent` is bare', () => {
      expect(isBareInstallCommand('npm install --silent')).toBe(true);
    });

    it('`npm install 2>&1` (stderr redirect only) is bare', () => {
      expect(isBareInstallCommand('npm install 2>&1')).toBe(true);
    });
  });

  describe('non-install commands', () => {
    it('build / test / arbitrary commands are not install', () => {
      expect(isBareInstallCommand('pnpm run test')).toBe(false);
      expect(isBareInstallCommand('pnpm run build')).toBe(false);
      expect(isBareInstallCommand('tsc --noEmit')).toBe(false);
      expect(isBareInstallCommand('echo hi')).toBe(false);
    });

    it('go / cargo dep commands are explicitly excluded', () => {
      expect(isBareInstallCommand('go mod tidy')).toBe(false);
      expect(isBareInstallCommand('go mod download')).toBe(false);
      expect(isBareInstallCommand('go get ./...')).toBe(false);
      expect(isBareInstallCommand('cargo build')).toBe(false);
    });
  });
});
