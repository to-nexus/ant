/**
 * antrulesDecisionCheck regression — Defect 2 (silent skip of ANTRULES detection).
 *
 * green-camping-brick observed: Tier 3/4 final verification closed with
 * `<done>true</done>` and zero ANTRULES.md entries, despite multiple
 * filter-passing candidates (jsdom v24 pin, handoff className verbatim,
 * Icon default export). The prior prompt asked LLMs to apply the
 * 3-condition filter but never asked them to *prove* the filter ran.
 *
 * Fix D introduces a mandatory `<antrules-decision>` tag (none | write |
 * update) plus a ≥10-char `<reply>` justification — checked by
 * `antrulesDecisionCheck` and gated to Tier 3/4 verification tasks via
 * `isVerificationTask(task)` (Tier 2 self-verify is OUT of scope, see
 * `feedback-antrules-broad-role`).
 */

import { describe, it, expect } from 'vitest';
import { antrulesDecisionCheck } from '../../src/agents/architect/graph/code/tasks/_shared/verify/antrulesDecisionCheck';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

function stateWith(opts: {
  taskType?: string;
  done?: boolean;
  rawResponse?: string;
}): ArchitectGraphState {
  return {
    currentTask: opts.taskType
      ? ({ id: 't1', type: opts.taskType } as any)
      : undefined,
    llmResponse: opts.done !== undefined ? { done: opts.done } : undefined,
    rawResponse: opts.rawResponse ?? '',
  } as any;
}

describe('antrulesDecisionCheck — mandatory <antrules-decision> gate', () => {
  it('returns null when task is NOT a verification task (Tier 2 self-verify skip)', async () => {
    const state = stateWith({
      taskType: 'feature',
      done: true,
      rawResponse: '<done>true</done>', // no decision tag — should still be OK
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });

  it('returns null when LLM has not yet emitted <done>true</done>', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: false,
      rawResponse: 'still working',
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });

  it('returns violation when <antrules-decision> tag is missing', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<reply>Verification gate passed.</reply>\n<done>true</done>',
    });
    const v = await antrulesDecisionCheck(state);
    expect(v).not.toBeNull();
    expect(v!.isRetryable).toBe(true);
    expect(v!.message).toContain('<antrules-decision>');
    expect(v!.message).toMatch(/none\|write\|update/);
  });

  it('returns violation when value is outside none|write|update', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<antrules-decision>skip</antrules-decision>\n' +
        '<reply>Reasonable looking justification, more than ten chars.</reply>\n<done>true</done>',
    });
    const v = await antrulesDecisionCheck(state);
    expect(v).not.toBeNull();
    expect(v!.isRetryable).toBe(true);
    expect(v!.message).toContain('Invalid');
    expect(v!.message).toContain('skip');
  });

  it('returns violation when justification reply is < 10 chars', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<antrules-decision>none</antrules-decision>\n<reply>ok</reply>\n<done>true</done>',
    });
    const v = await antrulesDecisionCheck(state);
    expect(v).not.toBeNull();
    expect(v!.isRetryable).toBe(true);
    expect(v!.message).toMatch(/≥10|10 characters/);
  });

  it('returns null when decision=none with adequate justification', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<antrules-decision>none</antrules-decision>\n' +
        '<reply>No filter-passing deviation observed during this job.</reply>\n<done>true</done>',
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });

  it('returns null when decision=update with adequate justification', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<edit path="codebase/ANTRULES.md">...</edit>\n' +
        '<antrules-decision>update</antrules-decision>\n' +
        '<reply>Recorded jsdom v24 pin rationale — not derivable from package.json.</reply>\n<done>true</done>',
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });

  it('accepts decision=write with adequate justification', async () => {
    const state = stateWith({
      taskType: 'verification',
      done: true,
      rawResponse:
        '<file path="codebase/ANTRULES.md">...</file>\n' +
        '<antrules-decision>write</antrules-decision>\n' +
        '<reply>Created ANTRULES with first project-local convention entry.</reply>\n<done>true</done>',
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });

  it('skips when currentTask is undefined (defensive)', async () => {
    const state = stateWith({
      done: true,
      rawResponse: 'anything',
    });
    expect(await antrulesDecisionCheck(state)).toBeNull();
  });
});
