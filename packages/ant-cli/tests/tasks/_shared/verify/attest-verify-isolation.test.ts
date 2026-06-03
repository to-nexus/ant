/**
 * attest × physical verify phase isolation.
 *
 * For a Tier-2 self-verify feature task, attestation (design-conformance) runs
 * in the APPLY phase and physical verify (build/typecheck/test) runs in the
 * REVERIFY phase. `activeExecuteHook` dispatches on `_verifyEntered`, so the
 * two never collide in one phase:
 *   - apply  (_verifyEntered=false) → feature apply hook → injects requiresAttestation
 *   - verify (_verifyEntered=true)  → shared verify hook → physical template, NO requiresAttestation
 */

import { describe, it, expect } from 'vitest';

import { activeExecuteHook } from '../../../../src/agents/architect/graph/code/tasks/_shared/verify/activeHooks';

function state(verifyEntered: boolean): any {
  return {
    currentTask: { type: 'feature', id: 't', name: 't', priority: 300, description: 'd' },
    _verifyEntered: verifyEntered,
  };
}

describe('attest × physical verify phase isolation (activeExecuteHook)', () => {
  it('apply mode → feature apply hook injects requiresAttestation, keeps default template', () => {
    const hook = activeExecuteHook(state(false));
    expect(hook).toBeDefined();
    // No templatePaths → default execute template is used.
    expect(hook?.templatePaths).toBeUndefined();
    const vars = hook?.extraTemplateVars?.({ state: state(false), task: state(false).currentTask });
    expect(vars).toEqual({ requiresAttestation: true });
  });

  it('verify mode → shared verify hook drives the physical template and injects NO requiresAttestation', () => {
    const hook = activeExecuteHook(state(true));
    expect(hook).toBeDefined();
    // Verify hook owns its own (physical) template...
    expect(hook?.templatePaths).toBeDefined();
    // ...and never sets the attestation gate var → attestation block stays unrendered in reverify.
    expect(hook?.extraTemplateVars).toBeUndefined();
  });
});
