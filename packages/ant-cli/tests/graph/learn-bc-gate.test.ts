/**
 * `learn` BC emission gate — outer policy that decides whether
 * `executionTier.breadcrumb` is invoked at all.
 *
 * Regression for the verification-tail BC drop (`young-melting-plier`):
 *   - `chat.jsonl` had two `file_create` events recorded by workers
 *   - the final task was a `verification` task with empty `touchedFiles`
 *   - `state.violations.length > 0` made `taskFailed` truthy
 *   - the previous gate `if (isLastTask && !taskFailed)` silently dropped
 *     the BC even though the turn had clearly modified files
 *
 * The new policy is `isLastTask && (turnTouchedAny || failureSignal)`.
 * failureSignal = taskFailed || hasOrchestratorFailure.
 * `taskFailed` is still surfaced in the diagnostic line. The
 * inner skip sites (`mode='explain'` / `touched=0` / session-or-context
 * missing) are unaffected and live in
 * `tests/core/executionTier/silentSkipDiagnostics.test.ts`.
 *
 * The diagnostic line format is asserted because operators rely on it as
 * the SSOT grep target when "BC line 0개" is reported in the field.
 */

import { describe, it, expect } from 'vitest';
import { evaluateBcGate, type BcGateInputs } from '../../src/agents/architect/graph/code/nodes/learn/bcGate';

const baseline: BcGateInputs = {
  isLastTask: true,
  taskFailed: false,
  isWorkerContext: false,
  hasOrchestratorFailure: false,
  touchedSize: 2,
  mode: 'generate',
  currentTaskType: 'feature',
  violationsLen: 0,
};

describe('evaluateBcGate', () => {
  it('emits when last task touched files in this turn (happy path)', () => {
    const out = evaluateBcGate(baseline);
    expect(out.bcShouldEmit).toBe(true);
    expect(out.turnTouchedAny).toBe(true);
  });

  it('emits on a verification-tail turn with worker file_* events (the original bug)', () => {
    // Mirrors `young-melting-plier`: tail task is verification, violations
    // jam the legacy `taskFailed` gate, but workers wrote 2 files in the
    // turn — BC must still emit.
    const out = evaluateBcGate({
      ...baseline,
      currentTaskType: 'verification',
      violationsLen: 2,
      taskFailed: true,
      touchedSize: 2,
    });
    expect(out.bcShouldEmit).toBe(true);
  });

  it('emits on an error-tail turn with violations when turn touched files', () => {
    const out = evaluateBcGate({
      ...baseline,
      currentTaskType: 'error',
      violationsLen: 1,
      taskFailed: true,
      touchedSize: 1,
    });
    expect(out.bcShouldEmit).toBe(true);
  });

  it('skips when the current learn invocation is not the last task', () => {
    const out = evaluateBcGate({ ...baseline, isLastTask: false });
    expect(out.bcShouldEmit).toBe(false);
    expect(out.turnTouchedAny).toBe(true);
  });

  it('skips when the turn touched zero files (touched=0 inner skip is logged separately)', () => {
    const out = evaluateBcGate({ ...baseline, touchedSize: 0 });
    expect(out.bcShouldEmit).toBe(false);
    expect(out.turnTouchedAny).toBe(false);
    expect(out.failureSignal).toBe(false);
  });

  it('emits when touched=0 but the turn ended in failure (failureSignal=true)', () => {
    const out = evaluateBcGate({
      ...baseline,
      touchedSize: 0,
      taskFailed: true,
    });
    expect(out.bcShouldEmit).toBe(true);
    expect(out.turnTouchedAny).toBe(false);
    expect(out.failureSignal).toBe(true);
  });

  it('does NOT skip on hasOrchestratorFailure or isWorkerContext alone — the outer learn caller gates those', () => {
    // The gate helper is policy-pure: surrounding context (orchestrator
    // failure, worker subgraph) is decided by `learn/index.ts` before
    // `evaluateBcGate` is called. We only assert that the helper itself
    // does not bake in those gates.
    const out = evaluateBcGate({
      ...baseline,
      hasOrchestratorFailure: true,
      isWorkerContext: true,
    });
    expect(out.bcShouldEmit).toBe(true);
  });
});

describe('evaluateBcGate — diagnostic line', () => {
  it('emits a single-line BC eval log containing every gate input (SSOT grep target)', () => {
    const out = evaluateBcGate({
      isLastTask: true,
      taskFailed: true,
      isWorkerContext: false,
      hasOrchestratorFailure: false,
      touchedSize: 2,
      mode: 'refactor',
      currentTaskType: 'verification',
      violationsLen: 2,
    });

    // Operators grep for `📝 [Learn] BC eval` first; lock the prefix.
    expect(out.diagnosticLine.startsWith('📝 [Learn] BC eval — ')).toBe(true);

    // Every input is rendered as `key=value` so the line stays one-line
    // greppable; lock each key=value pair so future refactors that drop a
    // field break this test.
    const expectedPairs = [
      'isLastTask=true',
      'bcShouldEmit=true',
      'taskFailed=true',
      'isWorkerContext=false',
      'hasOrchestratorFailure=false',
      'failureSignal=true',
      'touched=2',
      'mode=refactor',
      'currentTaskType=verification',
      'violationsLen=2',
    ];
    for (const pair of expectedPairs) {
      expect(out.diagnosticLine).toContain(pair);
    }

    // Single-line invariant: the diagnostic must not embed newlines so
    // downstream log shippers (line-oriented) keep it intact.
    expect(out.diagnosticLine).not.toMatch(/\n/);
  });

  it('reflects bcShouldEmit=false in the diagnostic when the gate skips', () => {
    const out = evaluateBcGate({ ...baseline, touchedSize: 0 });
    expect(out.diagnosticLine).toContain('bcShouldEmit=false');
    expect(out.diagnosticLine).toContain('touched=0');
  });

  it('renders mode=undefined and currentTaskType=undefined as literal "undefined" (not blank)', () => {
    // Operators distinguish "no mode resolved" (resolve regression) from
    // "mode='generate'" by reading this line — blanks would erase the
    // signal.
    const out = evaluateBcGate({
      ...baseline,
      mode: undefined,
      currentTaskType: undefined,
    });
    expect(out.diagnosticLine).toContain('mode=undefined');
    expect(out.diagnosticLine).toContain('currentTaskType=undefined');
  });
});
