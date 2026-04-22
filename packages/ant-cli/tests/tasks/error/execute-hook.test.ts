/**
 * L2 — `tasks/error/hooks/execute.ts` adapter invariants (T6b-ι).
 *
 *   - targets the error template variant
 *   - skips examples, KEEPS cross-task context (error may need foundation
 *     symbols / schema anchor when patching upstream)
 *   - emptyPlanFallback announces "no changes needed" + <done>true</done>
 *   - runtimePlanFraming uses REMEDIATION framing (shared with verification)
 *   - extraTemplateVars exposes `remediationMode{Upstream,Refactor}` flags
 *     gated by `task.remediationMode`
 *   - bundle registration
 */

import { describe, it, expect } from 'vitest';

import { executeHook } from '../../../src/agents/architect/graph/code/tasks/error/hooks/execute';
import { hooks as errorBundle } from '../../../src/agents/architect/graph/code/tasks/error';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

function errorTask(mode?: 'upstream' | 'refactor' | 'patch'): CodeTask {
  return {
    id: 'e1',
    name: 'fix runtime error',
    type: 'error',
    priority: 900,
    description: 'resolve crash in auth flow',
    remediationMode: mode,
  } as CodeTask;
}

describe('tasks/error/hooks/execute', () => {
  it('targets the error template variant', () => {
    expect(executeHook.templatePaths).toEqual({
      base: 'jobs/code/nodes/execute/variants/error/base',
      rules: 'jobs/code/nodes/execute/variants/error/rules',
    });
  });

  it('skips examples only — cross-task context stays enabled', () => {
    expect(executeHook.skipExamples).toBe(true);
    expect(executeHook.skipCrossTaskContext).toBeUndefined();
  });

  it('does NOT sanitise the directive (error tasks carry user-reported error text)', () => {
    expect(executeHook.sanitizeDirective).toBeUndefined();
  });

  it('runtimePlanFraming shares the REMEDIATION label with verification', () => {
    expect(executeHook.runtimePlanFraming?.label).toContain('REMEDIATION');
  });

  it('emptyPlanFallback announces "no changes needed" + <done>true</done>', () => {
    const msg = executeHook.emptyPlanFallback?.(errorTask());
    expect(msg).toContain('Error investigation found no code changes needed');
    expect(msg).toContain('<done>true</done>');
  });

  it('extraTemplateVars flags remediationModeUpstream when the task selects it', () => {
    const vars = executeHook.extraTemplateVars?.({
      state: {} as any,
      task: errorTask('upstream'),

    });
    expect(vars).toEqual({
      remediationModeUpstream: true,
      remediationModeRefactor: false,
    });
  });

  it('extraTemplateVars flags remediationModeRefactor when the task selects it', () => {
    const vars = executeHook.extraTemplateVars?.({
      state: {} as any,
      task: errorTask('refactor'),

    });
    expect(vars).toEqual({
      remediationModeUpstream: false,
      remediationModeRefactor: true,
    });
  });

  it('extraTemplateVars leaves both flags false for the default patch mode', () => {
    const vars = executeHook.extraTemplateVars?.({
      state: {} as any,
      task: errorTask('patch'),

    });
    expect(vars).toEqual({
      remediationModeUpstream: false,
      remediationModeRefactor: false,
    });
  });

  it('extraTemplateVars leaves both flags false when remediationMode is absent', () => {
    const vars = executeHook.extraTemplateVars?.({
      state: {} as any,
      task: errorTask(undefined),

    });
    expect(vars).toEqual({
      remediationModeUpstream: false,
      remediationModeRefactor: false,
    });
  });

  it('registers the execute hook under the error bundle', () => {
    expect(errorBundle.execute).toBe(executeHook);
    expect(hooksForTaskType('error')?.execute).toBe(executeHook);
  });
});
