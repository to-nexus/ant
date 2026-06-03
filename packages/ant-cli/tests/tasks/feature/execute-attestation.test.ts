/**
 * Pre-`<done>` contract attestation — feature/ui execute hook gate var.
 *
 * Locks the consumer/author scope: ordinary feature (band undefined) and
 * integration feature attest; foundation/platform features (authors of shared
 * surfaces) do not. UI always attests (no band axis).
 */

import { describe, it, expect } from 'vitest';

import { extraTemplateVars as featureExecuteVars } from '../../../src/agents/architect/graph/code/tasks/feature/hooks/execute';
import { extraTemplateVars as uiExecuteVars } from '../../../src/agents/architect/graph/code/tasks/ui/hooks/execute';
import type { CodeTask } from '../../../src/agents/architect/types/task';
import type { ExecutePromptCtx } from '../../../src/agents/architect/graph/code/tasks/_shared/types';

function ctx(task: Partial<CodeTask>): ExecutePromptCtx {
  return {
    state: {} as any,
    task: { id: 't', name: 't', priority: 300, description: 'd', ...task } as CodeTask,
  };
}

describe('feature execute hook — requiresAttestation by band (consumer, not author)', () => {
  it('ordinary feature (band undefined) → true', () => {
    expect(featureExecuteVars(ctx({ type: 'feature' }))).toEqual({ requiresAttestation: true });
  });
  it('integration feature → true (heaviest cross-package consumer)', () => {
    expect(featureExecuteVars(ctx({ type: 'feature', band: 'integration' } as any))).toEqual({
      requiresAttestation: true,
    });
  });
  it('foundation feature → false (authors shared surfaces)', () => {
    expect(featureExecuteVars(ctx({ type: 'feature', band: 'foundation' } as any))).toEqual({
      requiresAttestation: false,
    });
  });
  it('platform feature → false (author)', () => {
    expect(featureExecuteVars(ctx({ type: 'feature', band: 'platform' } as any))).toEqual({
      requiresAttestation: false,
    });
  });
});

describe('ui execute hook — always attests (no band axis)', () => {
  it('ui → true', () => {
    expect(uiExecuteVars(ctx({ type: 'ui' }))).toEqual({ requiresAttestation: true });
  });
});
