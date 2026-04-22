/**
 * L2 — `tasks/doc/hooks/execute.ts` adapter invariants (T6b-ι).
 *
 *   - targets the docgen template variant
 *   - skips examples; keeps cross-task context (docs reference the full
 *     codebase surface)
 *   - opts into directoryTree injection so the LLM can cross-reference
 *     files without list_files
 *   - no directive sanitisation, no remediation framing, no extra vars
 *   - bundle registration
 */

import { describe, it, expect } from 'vitest';

import { executeHook } from '../../../src/agents/architect/graph/code/tasks/doc/hooks/execute';
import { hooks as docBundle } from '../../../src/agents/architect/graph/code/tasks/doc';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

describe('tasks/doc/hooks/execute', () => {
  it('targets the docgen template variant', () => {
    expect(executeHook.templatePaths).toEqual({
      base: 'jobs/code/nodes/execute/variants/docgen/base',
      rules: 'jobs/code/nodes/execute/variants/docgen/rules',
    });
  });

  it('skips examples only', () => {
    expect(executeHook.skipExamples).toBe(true);
    expect(executeHook.skipCrossTaskContext).toBeUndefined();
  });

  it('publishes no remediation framing or extra vars', () => {
    expect(executeHook.runtimePlanFraming).toBeUndefined();
    expect(executeHook.emptyPlanFallback).toBeUndefined();
    expect(executeHook.extraTemplateVars).toBeUndefined();
    expect(executeHook.sanitizeDirective).toBeUndefined();
  });

  it('registers the execute hook under the doc bundle', () => {
    expect(docBundle.execute).toBe(executeHook);
    expect(hooksForTaskType('doc')?.execute).toBe(executeHook);
  });
});
