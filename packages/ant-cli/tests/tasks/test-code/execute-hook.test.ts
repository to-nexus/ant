/**
 * L2 — `tasks/test-code/hooks/execute.ts` adapter invariants (T6b-ι).
 *
 *   - targets the test-code template variant
 *   - skips examples; keeps cross-task context (tests may reference
 *     foundation symbols / schema)
 *   - no directive sanitisation, no remediation framing, no directoryTree
 *   - bundle registration
 */

import { describe, it, expect } from 'vitest';

import { executeHook } from '../../../src/agents/architect/graph/code/tasks/test-code/hooks/execute';
import { hooks as testCodeBundle } from '../../../src/agents/architect/graph/code/tasks/test-code';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

describe('tasks/test-code/hooks/execute', () => {
  it('targets the test-code template variant', () => {
    expect(executeHook.templatePaths).toEqual({
      base: 'jobs/code/nodes/execute/variants/test-code/base',
      rules: 'jobs/code/nodes/execute/variants/test-code/rules',
    });
  });

  it('skips examples only', () => {
    expect(executeHook.skipExamples).toBe(true);
    expect(executeHook.skipCrossTaskContext).toBeUndefined();
  });

  it('publishes no remediation framing or empty-plan fallback', () => {
    expect(executeHook.runtimePlanFraming).toBeUndefined();
    expect(executeHook.emptyPlanFallback).toBeUndefined();
  });

  it('does not sanitise directives or inject directoryTree', () => {
    expect(executeHook.sanitizeDirective).toBeUndefined();
    expect(executeHook.includeDirectoryTree).toBeUndefined();
    expect(executeHook.extraTemplateVars).toBeUndefined();
  });

  it('registers the execute hook under the test-code bundle', () => {
    expect(testCodeBundle.execute).toBe(executeHook);
    expect(hooksForTaskType('test-code')?.execute).toBe(executeHook);
  });
});
