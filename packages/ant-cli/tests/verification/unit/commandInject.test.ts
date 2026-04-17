/**
 * L1 unit — commandInject overlay utility.
 *
 * Covers:
 *   - inactive when env vars missing
 *   - inactive when one of the two env vars is missing
 *   - stub vs overlay mode selection
 *   - pattern matching (first match wins)
 *   - buildInjectedResult defaults
 *   - overlayResult composition
 *   - malformed JSON → inactive (not crashing)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  lookupInjection,
  buildInjectedResult,
  overlayResult,
  isCommandInjectActive,
  __resetCommandInjectCache,
} from '../../../src/utils/commandInject';

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
