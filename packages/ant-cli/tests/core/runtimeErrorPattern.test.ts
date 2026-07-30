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
import {
  containsRuntimeErrorPattern,
  containsMachineFailureSignal,
} from '../../src/core/utils/runtimeErrorPattern';
import { detectPotentialMisclassification } from '../../src/agents/architect/graph/code/nodes/decompose/validation';
import type { CodeTask } from '../../src/agents/architect/types/task';

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

describe('containsMachineFailureSignal (strict variant)', () => {
  describe('verbatim machine output — detected', () => {
    it.each([
      'Error: Cannot find module foo',
      'TypeError: Cannot read property of undefined',
      'NullPointerException in UserService',
      '    at Module._load (node:internal/modules/cjs/loader:1051:27)',
      'command exited, exit code: 2',
      'failed to compile ./src/App.tsx',
      'Build failed with 3 errors',
      'npm ERR! code ENOENT',
      'ELIFECYCLE  Command failed',
      '2 tests failed in auth.spec.ts',
      'assertion `x === y` failed',
      'expected 200 but got 500',
    ])('detects %j', input => {
      expect(containsMachineFailureSignal(input)).toBe(true);
    });
  });

  describe('failure vocabulary alone — NOT detected', () => {
    it.each([
      'there is an error in the layout, fix it',
      'this button is broken, it feels like a bug',
      'fix the failed design of the settings page',
      'clicking save does nothing, please fix this error',
      '저장 버튼이 에러야, 고쳐줘',
      'the app crashes my workflow productivity',
      'login failed for user when the form is empty',
      'refactor the user service to use dependency injection',
      '',
    ])('returns false for %j', input => {
      expect(containsMachineFailureSignal(input)).toBe(false);
    });
  });

  it('returns false for undefined / null', () => {
    expect(containsMachineFailureSignal(undefined)).toBe(false);
    expect(containsMachineFailureSignal(null)).toBe(false);
  });
});

// Sole consumer alignment: the decompose error-vs-feature misclassification
// check must key off the STRICT predicate — a directive that merely *calls*
// something an error must not warn when the LLM (correctly) emits non-error
// tasks, per the decompose Task Type Rules ("error" requires a machine signal).
describe('detectPotentialMisclassification — machine-signal alignment', () => {
  const task = (type: CodeTask['type']): CodeTask =>
    ({ id: `${type}-1`, name: `${type} task`, type, priority: 300, description: 'x' }) as CodeTask;

  const MACHINE_SIGNAL_DIRECTIVE =
    'TypeError: Cannot read properties of undefined\n    at render (App.tsx:10:5)';
  const VOCABULARY_ONLY_DIRECTIVE = 'this page is an error, fix it so saving works';

  it('warns when a machine signal exists but no task is error-type', () => {
    const r = detectPotentialMisclassification(MACHINE_SIGNAL_DIRECTIVE, [task('feature')]);
    expect(r.hasMisclassification).toBe(true);
  });

  it('does NOT warn on vocabulary-only directives classified as non-error', () => {
    const r = detectPotentialMisclassification(VOCABULARY_ONLY_DIRECTIVE, [
      task('feature'),
      task('ui'),
    ]);
    expect(r.hasMisclassification).toBe(false);
  });

  it('does NOT warn when the machine signal is matched by an error task', () => {
    const r = detectPotentialMisclassification(MACHINE_SIGNAL_DIRECTIVE, [
      task('error'),
      task('verification'),
    ]);
    expect(r.hasMisclassification).toBe(false);
  });

  it('does NOT warn on an empty directive', () => {
    expect(detectPotentialMisclassification(undefined, [task('feature')]).hasMisclassification).toBe(
      false,
    );
  });
});
