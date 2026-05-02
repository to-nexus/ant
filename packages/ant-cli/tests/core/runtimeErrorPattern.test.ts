/**
 * runtimeErrorPattern util — single source of truth for detecting whether
 * a directive describes a runtime error scenario.
 *
 * Replaces two pre-existing definitions (one in `execute/buildMessages.ts`
 * for the runtime-error-fix injection gate, one inline in
 * `decompose/index.ts` for the error-or-general decompose template
 * branch). Both call sites now import this helper; the test suite below
 * locks in the union coverage so neither legacy call site loses
 * detection on a regression.
 */

import { describe, it, expect } from 'vitest';
import { containsRuntimeErrorPattern } from '../../src/core/utils/runtimeErrorPattern';

describe('containsRuntimeErrorPattern', () => {
  describe('verbose pattern set (former buildMessages.ts coverage)', () => {
    it.each([
      'Error: something broke',
      'TypeError: Cannot read property',
      'ReferenceError: foo is not defined',
      'SyntaxError: Unexpected token',
      'RangeError: Maximum call stack',
      'ELIFECYCLE  Command failed',
      'npm ERR! code ENOENT',
      'unexpected token in JSON',
      'module not found',
      'command failed with exit code 1',
      'compilation error in component',
      'Process exited with code 137',
      'test pattern failed in suite',
      'assertion was failed',
      'expected 1 but got 2',
      'cannot find module @tailwindcss/postcss',
      'undefined is not a function',
    ])('detects %j', input => {
      expect(containsRuntimeErrorPattern(input)).toBe(true);
    });

    it('detects stack frame "    at fn (path)" pattern', () => {
      expect(containsRuntimeErrorPattern('    at Module._resolveFilename (loader.js:42)')).toBe(
        true,
      );
    });

    it('detects "node_modules" mentions', () => {
      expect(containsRuntimeErrorPattern('error originated in node_modules/foo/index.js')).toBe(
        true,
      );
    });
  });

  describe('keyword set (former decompose/index.ts coverage)', () => {
    it.each([
      'getting a nasty exception in the handler',
      'login failed for user',
      'check the stack trace for context',
      'cannot read property of undefined',
      'foo is not a function',
      'bar is not defined',
      'unexpected token <',
      'TypeError thrown by middleware',
      'ReferenceError thrown deep in graph',
      'SyntaxError raised by parser',
    ])('detects %j', input => {
      expect(containsRuntimeErrorPattern(input)).toBe(true);
    });
  });

  describe('non-error directives', () => {
    it.each([
      'add a new endpoint to the API',
      'refactor the user service to use dependency injection',
      'document the public types of the foo package',
      'create a settings page with dark mode toggle',
      '',
    ])('returns false for %j', input => {
      expect(containsRuntimeErrorPattern(input)).toBe(false);
    });
  });

  describe('null / undefined safety', () => {
    it('returns false for undefined / null', () => {
      expect(containsRuntimeErrorPattern(undefined)).toBe(false);
      expect(containsRuntimeErrorPattern(null)).toBe(false);
    });
  });

  describe('regression — gleam-growing-grace directive', () => {
    it('detects the original PostCSS Cannot find module trace', () => {
      const directive = `Error evaluating Node.js code
Error: Cannot find module '@tailwindcss/postcss'
Require stack:
- /apps/console/.next/dev/build/chunks/[root-of-the-server]__abc.js
- /apps/console/.next/dev/build/postcss.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)
    at Module._load (node:internal/modules/cjs/loader:1051:27)`;
      expect(containsRuntimeErrorPattern(directive)).toBe(true);
    });
  });
});
