/**
 * L2 — verify-mode `priorPlans` rendering + initSession history transfer
 *
 * Locks the prior-plan visibility contract that prevents the cycle-N+1
 * plan LLM from re-discovering the same diagnosis the apply phase /
 * earlier verify cycles already produced. Direct trigger of the cascade
 * pattern observed in `misty-filling-rivet` (22 min, 5 LLM calls, 4
 * distinct plan bodies, none aware of its predecessor).
 *
 * Coverage:
 *   1. `summarizePlanBody` extracts goal / rootCauses / modify targets
 *      from Format A plans; Format B (batched) plans surface their
 *      `batches[].modify[].target` paths.
 *   2. Unparseable plan bodies fall through to a stub line that still
 *      registers the attempt.
 *   3. `renderPriorPlans` returns `undefined` for empty input and
 *      bullet-joined entries otherwise.
 *   4. `initSession` carries the apply phase's `state.planText` into the
 *      freshly-created Session's `planHistoryBodies()` for self-verify
 *      Tier 2 tasks (the apply→verify boundary that previously dropped
 *      the apply plan).
 *   5. Verification task type (Tier 3/4) does NOT have apply-phase
 *      planText carried — its `state.planText` represents an upstream
 *      task's history, not this Session's.
 */

import { describe, it, expect } from 'vitest';

import {
  summarizePlanBody,
  renderPriorPlans,
  buildPrompt,
} from '../../../src/agents/architect/graph/code/tasks/_shared/verify/buildPlanPrompt';
import { initSession } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/initSession';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/Session';

import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';
import type { PlanPromptCtx } from '../../../src/agents/architect/graph/code/tasks/_shared/types';

// ────────────────────────────────────────────────────────────────────────
// summarizePlanBody — single-body extraction
// ────────────────────────────────────────────────────────────────────────

describe('summarizePlanBody', () => {
  it('extracts goal, rootCauses, and modify targets from a Format A plan', () => {
    const body = JSON.stringify({
      task: { id: 't1', goal: 'Fix enemy spawn timing' },
      diagnostics: {
        rootCauses: [
          { cause: 'Spawn block runs before auto-fire in same tick', affectedFiles: ['reducer.ts'], errorCount: 1 },
        ],
      },
      implementation: {
        modify: [
          { target: 'src/domain/reducer.ts', action: 'Move B1b after B4', changes: ['...'] },
        ],
        create: [],
        delete: [],
      },
    });
    const out = summarizePlanBody(body, 1);
    expect(out).toContain('Attempt 1');
    expect(out).toContain('Fix enemy spawn timing');
    expect(out).toContain('Spawn block runs before auto-fire');
    expect(out).toContain('src/domain/reducer.ts');
  });

  it('extracts modify targets from a Format B (batched) plan', () => {
    const body = JSON.stringify({
      task: { id: 't1', goal: 'Multi-batch remediation' },
      diagnostics: { rootCauses: [{ cause: 'Two unrelated issues', affectedFiles: [], errorCount: 5 }] },
      batches: [
        {
          name: 'batch-A',
          rationale: 'foundation types',
          modify: [
            { target: 'src/types.ts', action: 'add field', changes: ['...'] },
            { target: 'src/types-ext.ts', action: 'add field', changes: ['...'] },
          ],
        },
        {
          name: 'batch-B',
          rationale: 'consumers',
          modify: [{ target: 'src/consumer.ts', action: 'use new field', changes: ['...'] }],
        },
      ],
    });
    const out = summarizePlanBody(body, 2);
    expect(out).toContain('Attempt 2');
    expect(out).toContain('src/types.ts');
    expect(out).toContain('src/types-ext.ts');
    expect(out).toContain('src/consumer.ts');
  });

  it('truncates excessively long root cause text', () => {
    const longCause = 'X'.repeat(500);
    const body = JSON.stringify({
      task: { id: 't1', goal: 'g' },
      diagnostics: { rootCauses: [{ cause: longCause, affectedFiles: [], errorCount: 1 }] },
      implementation: { modify: [], create: [], delete: [] },
    });
    const out = summarizePlanBody(body, 1);
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThan(longCause.length + 100);
    expect(out).toMatch(/X{50,}…/);
  });

  it('handles fenced JSON code blocks', () => {
    const body = '```json\n' + JSON.stringify({
      task: { id: 't1', goal: 'fenced goal' },
      diagnostics: { rootCauses: [] },
      implementation: { modify: [{ target: 'a.ts', action: 'x', changes: [] }], create: [], delete: [] },
    }) + '\n```';
    const out = summarizePlanBody(body, 1);
    expect(out).toContain('fenced goal');
    expect(out).toContain('a.ts');
  });

  it('emits a parse-failure stub for invalid JSON (still registers the attempt)', () => {
    const out = summarizePlanBody('this is not JSON at all', 3);
    expect(out).toContain('Attempt 3');
    expect(out!.toLowerCase()).toContain('could not be parsed');
  });

  it('returns null for empty body', () => {
    expect(summarizePlanBody('', 1)).toBeNull();
  });

  it('handles missing rootCauses / modify gracefully', () => {
    const body = JSON.stringify({ task: { id: 't1', goal: 'minimal' }, diagnostics: {}, implementation: {} });
    const out = summarizePlanBody(body, 1);
    expect(out).toContain('minimal');
    expect(out).toContain('Attempt 1');
  });
});

// ────────────────────────────────────────────────────────────────────────
// renderPriorPlans — buffer rendering
// ────────────────────────────────────────────────────────────────────────

describe('renderPriorPlans', () => {
  it('returns undefined for empty buffer', () => {
    expect(renderPriorPlans([])).toBeUndefined();
  });

  it('returns undefined when every body fails the summarizer (only empty entries)', () => {
    expect(renderPriorPlans(['', ''])).toBeUndefined();
  });

  it('joins multiple entries with double-newline separators in attempt order', () => {
    const bodies = [
      JSON.stringify({ task: { goal: 'first goal' }, diagnostics: {}, implementation: {} }),
      JSON.stringify({ task: { goal: 'second goal' }, diagnostics: {}, implementation: {} }),
    ];
    const out = renderPriorPlans(bodies);
    expect(out).toBeDefined();
    const idxFirst = out!.indexOf('first goal');
    const idxSecond = out!.indexOf('second goal');
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(idxFirst);
    expect(out).toContain('Attempt 1');
    expect(out).toContain('Attempt 2');
  });
});

// ────────────────────────────────────────────────────────────────────────
// initSession — apply→verify history transfer
// ────────────────────────────────────────────────────────────────────────

function selfVerifyTask(): CodeTask {
  return {
    id: 'fix-something',
    name: 'Fix something at runtime',
    type: 'error',
    priority: 900,
    description: 'apply remediation then self-verify',
    selfVerifyOnDone: true,
  } as CodeTask;
}

function verificationTask(): CodeTask {
  return {
    id: 'verify-all',
    name: 'Final verification',
    type: 'verification',
    priority: 1000,
    description: 'run all gates',
  } as CodeTask;
}

describe('initSession — apply-phase planText carry-over', () => {
  it('pushes apply-phase planText into the freshly-created Session for self-verify Tier 2 tasks', () => {
    const applyPlanText = JSON.stringify({
      task: { goal: 'Add missing spawn logic' },
      diagnostics: { rootCauses: [{ cause: 'no spawn step', affectedFiles: ['reducer.ts'], errorCount: 1 }] },
      implementation: { modify: [{ target: 'src/domain/reducer.ts', action: 'add B1b', changes: ['...'] }], create: [], delete: [] },
    });
    const state = {
      verification: undefined,
      currentTask: selfVerifyTask(),
      planText: applyPlanText,
      _nextPlanEntry: 'reverify',
    } as unknown as ArchitectGraphState;

    initSession(state, { isTs: true, hasTests: true });

    expect(state.verification).toBeInstanceOf(VerificationSession);
    expect(state.verification!.planHistoryBodies().length).toBe(1);
    expect(state.verification!.planHistoryBodies()[0]).toBe(applyPlanText);
  });

  it('does NOT carry planText for verification task type (Tier 3/4)', () => {
    const upstreamPlanText = JSON.stringify({
      task: { goal: 'foreign upstream task plan' },
      diagnostics: {},
      implementation: {},
    });
    const state = {
      verification: undefined,
      currentTask: verificationTask(),
      planText: upstreamPlanText,
    } as unknown as ArchitectGraphState;

    initSession(state, { isTs: true, hasTests: true });

    expect(state.verification).toBeInstanceOf(VerificationSession);
    expect(state.verification!.planHistoryBodies()).toEqual([]);
  });

  it('does NOT carry planText when self-verify task is at non-reverify entry (apply phase guard)', () => {
    const state = {
      verification: undefined,
      currentTask: selfVerifyTask(),
      planText: 'some apply phase planText',
      _nextPlanEntry: undefined, // apply phase entry, not reverify
    } as unknown as ArchitectGraphState;

    initSession(state, { isTs: true, hasTests: true });

    // Self-verify gate at L75 returns early without creating a Session.
    expect(state.verification).toBeUndefined();
  });

  it('does NOT push when planText is empty / whitespace', () => {
    const state = {
      verification: undefined,
      currentTask: selfVerifyTask(),
      planText: '   \n  ',
      _nextPlanEntry: 'reverify',
    } as unknown as ArchitectGraphState;

    initSession(state, { isTs: true, hasTests: true });

    expect(state.verification).toBeInstanceOf(VerificationSession);
    expect(state.verification!.planHistoryBodies()).toEqual([]);
  });

  it('carries the apply planText so renderPriorPlans surfaces it on the first verify cycle', () => {
    const applyPlanText = JSON.stringify({
      task: { goal: 'Add missing spawn logic' },
      diagnostics: { rootCauses: [{ cause: 'no spawn step', affectedFiles: ['reducer.ts'], errorCount: 1 }] },
      implementation: { modify: [{ target: 'src/domain/reducer.ts', action: 'add B1b', changes: [] }], create: [], delete: [] },
    });
    const state = {
      verification: undefined,
      currentTask: selfVerifyTask(),
      planText: applyPlanText,
      _nextPlanEntry: 'reverify',
    } as unknown as ArchitectGraphState;

    initSession(state, { isTs: true, hasTests: true });

    const rendered = renderPriorPlans(state.verification!.planHistoryBodies());
    expect(rendered).toBeDefined();
    expect(rendered).toContain('Add missing spawn logic');
    expect(rendered).toContain('src/domain/reducer.ts');
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildPrompt — verifies the verification plan prompt receives priorPlans
// vars (the contract the verification template consumes).
// ────────────────────────────────────────────────────────────────────────

interface CapturedRender {
  template: string;
  vars: Record<string, unknown>;
}

function makePromptBuilderSpy(captured: CapturedRender[]): {
  build: () => unknown;
  render: (template: string, vars: Record<string, unknown>) => Promise<string>;
  renderBasis: () => Promise<string>;
} {
  return {
    build: () => ({}),
    render: async (template, vars) => {
      captured.push({ template, vars });
      return `<rendered:${template}>`;
    },
    renderBasis: async () => '',
  };
}

describe('buildPrompt — priorPlans var injection', () => {
  it('passes priorPlans / hasPriorPlans / priorPlanCount when Session has plan history', async () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    session.onPlanApplied(JSON.stringify({
      task: { goal: 'cycle 1 plan' },
      diagnostics: { rootCauses: [{ cause: 'cause-1', affectedFiles: [], errorCount: 1 }] },
      implementation: { modify: [{ target: 'a.ts', action: 'x', changes: [] }], create: [], delete: [] },
    }));
    session.onPlanApplied(JSON.stringify({
      task: { goal: 'cycle 2 plan' },
      diagnostics: { rootCauses: [{ cause: 'cause-2', affectedFiles: [], errorCount: 1 }] },
      implementation: { modify: [{ target: 'b.ts', action: 'x', changes: [] }], create: [], delete: [] },
    }));

    const captured: CapturedRender[] = [];
    const promptBuilder = makePromptBuilderSpy(captured);

    const state = {
      verification: session,
      deps: { promptBuilder },
      directive: 'fix something',
      resolvedAction: { intent: undefined, basis: {}, domain: undefined },
    } as unknown as ArchitectGraphState;

    const ctx: PlanPromptCtx = {
      state,
      task: selfVerifyTask(),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: true },
      antrulesContent: undefined,
    };

    const result = await buildPrompt(ctx);

    const baseRender = captured.find(c => c.template.includes('plan/variants/verification/base'));
    expect(baseRender).toBeDefined();
    expect(baseRender!.vars.hasPriorPlans).toBe(true);
    expect(baseRender!.vars.priorPlanCount).toBe(2);
    const rendered = baseRender!.vars.priorPlans as string;
    expect(rendered).toContain('cycle 1 plan');
    expect(rendered).toContain('cycle 2 plan');
    expect(rendered).toContain('a.ts');
    expect(rendered).toContain('b.ts');

    expect(result.vars.hasPriorPlans).toBe(true);
    expect(result.vars.priorPlanCount).toBe(2);
  });

  it('passes hasPriorPlans=false / priorPlanCount=0 on a fresh Session (no apply planText carried)', async () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });

    const captured: CapturedRender[] = [];
    const promptBuilder = makePromptBuilderSpy(captured);

    const state = {
      verification: session,
      deps: { promptBuilder },
      directive: 'fix something',
      resolvedAction: { intent: undefined, basis: {}, domain: undefined },
    } as unknown as ArchitectGraphState;

    const ctx: PlanPromptCtx = {
      state,
      task: verificationTask(),
      codeContext: undefined,
      violationsText: undefined,
      uiDoc: undefined,
      remainingTasks: undefined,
      options: { hasTools: true },
      antrulesContent: undefined,
    };

    const result = await buildPrompt(ctx);

    const baseRender = captured.find(c => c.template.includes('plan/variants/verification/base'));
    expect(baseRender).toBeDefined();
    expect(baseRender!.vars.hasPriorPlans).toBe(false);
    expect(baseRender!.vars.priorPlanCount).toBe(0);
    expect(baseRender!.vars.priorPlans).toBeUndefined();
    expect(result.vars.hasPriorPlans).toBe(false);
  });
});
