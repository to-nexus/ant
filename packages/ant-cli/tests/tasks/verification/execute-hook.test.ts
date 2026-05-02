/**
 * L2 — `tasks/verification/hooks/execute.ts` adapter invariants.
 *
 * Locks the execute-phase contract lifted from `nodes/execute/
 * buildMessages.ts` at T6b-ι:
 *
 *   - variant template paths (verification/base + verification/rules)
 *   - skipExamples + skipCrossTaskContext (heaviest skip set)
 *   - sanitizeDirective blanks any user directive
 *   - runtimePlanFraming uses the REMEDIATION label/description pair
 *   - emptyPlanFallback returns the "build/test passed" sentence
 *   - includeDirectoryTree is on
 *   - registry entry exposes the hook under the `execute` slot
 */

import { describe, it, expect } from 'vitest';

import { executeHook } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/hooks/executeHook';
import { hooks as verificationBundle } from '../../../src/agents/architect/graph/code/tasks/verification';
import { hooksForTaskType } from '../../../src/agents/architect/graph/code/tasks/_shared/registry';

import type { CodeTask } from '../../../src/agents/architect/types/task';

const dummyTask: CodeTask = {
  id: 'v1',
  name: 'final verification',
  type: 'verification',
  priority: 1000,
  description: 'verify build passes',
} as CodeTask;

describe('tasks/verification/hooks/execute', () => {
  it('targets the verification template variant', () => {
    expect(executeHook.templatePaths).toEqual({
      base: 'jobs/code/nodes/execute/variants/verification/base',
      rules: 'jobs/code/nodes/execute/variants/verification/rules',
    });
  });

  it('skips examples AND cross-task context (FoundationContract / SchemaAnchor)', () => {
    expect(executeHook.skipExamples).toBe(true);
    expect(executeHook.skipCrossTaskContext).toBe(true);
  });

  it('blanks any user-supplied directive so the plan JSON drives the fix', () => {
    expect(executeHook.sanitizeDirective?.('please also refactor foo')).toBe('');
    expect(executeHook.sanitizeDirective?.('')).toBe('');
  });

  it('runtimePlanFraming publishes the REMEDIATION label', () => {
    expect(executeHook.runtimePlanFraming?.label).toContain('REMEDIATION');
    expect(executeHook.runtimePlanFraming?.description).toContain('diagnostic');
  });

  it('emptyPlanFallback tells the LLM to emit <done>true</done>', () => {
    const msg = executeHook.emptyPlanFallback?.(dummyTask);
    expect(msg).toContain('Build/test passed');
    expect(msg).toContain('<done>true</done>');
  });

  it('registers the execute hook under the verification bundle', () => {
    expect(verificationBundle.execute).toBe(executeHook);
    expect(hooksForTaskType('verification')?.execute).toBe(executeHook);
  });
});
