/**
 * Regression — empty-plan sentinel 게이트는 task type 무관 일관 계약이다.
 *
 * Two RCAs converge here:
 *
 *   - `solar-coming-bough`: Tier-2 self-verify error 태스크가 verify-mode에서
 *     no-errors sentinel을 emit했는데도 plan 사이클이 종료되지 않았던 결함.
 *     fix 1차로 verify-mode (`isVerifyModeActive(state)`) 기반 게이트로 교체.
 *
 *   - `hidden-mooring-rivet`: error / feature / ui 등 apply-mode 태스크가
 *     sibling이 이미 처리한 work를 받았을 때(중복 task) "이미 다 됐다" 를
 *     surface로 확인하고도 empty plan을 emit해도 execute로 라우팅되어 불필요한
 *     verification command (tsc 등) 를 호출하다 worker stall로 죽었던 결함.
 *     fix 2차로 verify-mode 게이트를 제거 — base.md / rules.md / variants 모든
 *     plan template이 동일 empty-plan 계약 ("investigation이 surface에서 no-op
 *     을 확인하면 empty implementation JSON emit") 을 가르치므로 finalize는
 *     task type을 분기하지 않는다.
 *
 * 새 contract: planText === '' && !batchSplitOccurred → isDone:true,
 *             task.type 무관 / verify-mode 진입 무관.
 *
 * verify-mode 여부는 `isRemediationTask` trace 채널로 별도로 보존된다 (
 * downstream 노드의 task-type 분기에는 영향 없음).
 */

import { describe, it, expect } from 'vitest';
import { finalizePlanOutcome } from '../../src/agents/architect/graph/code/nodes/plan/outcome/finalize';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../src/agents/architect/types/task';

function makeTask(over: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 't1',
    name: 'task',
    description: 'desc',
    type: 'error',
    priority: 900,
    selfVerifyOnDone: true,
    ...over,
  } as CodeTask;
}

function makeState(over: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: makeTask(),
    conversations: {},
    completedTasksDetails: [],
    recursionCount: 0,
    recursionLimit: 200,
    _verifyEntered: false,
    ...over,
  } as unknown as ArchitectGraphState;
}

describe('finalizePlanOutcome — empty-plan sentinel 게이트 (solar-coming-bough + hidden-mooring-rivet 회귀)', () => {
  it('Tier-2 self-verify error + verify-mode + 빈 planText → isDone:true (solar-coming-bough)', () => {
    // Plan-tool-loop의 sentinel shortcut이 sentinel을 ''로 비웠다고 가정
    // (`nodes/plan/llm/tools.ts`). finalize는 빈 planText를 done 처리해야 한다.
    const task = makeTask({ type: 'error', selfVerifyOnDone: true });
    const state = makeState({ _verifyEntered: true, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(true);
    expect(result.planText).toBe('');
  });

  it('error apply-mode + 빈 planText → isDone:true (hidden-mooring-rivet)', () => {
    // 새 contract: apply-mode error task가 sibling이 이미 처리한 work를 받아
    // surface로 "이미 다 됐다"를 확인하고 empty plan을 emit하면 즉시 done.
    // 이전엔 verify-mode 게이트에 막혀 execute로 라우팅됐고 거기서 불필요한
    // verification command 호출이 stall로 이어졌다.
    const task = makeTask({ type: 'error', selfVerifyOnDone: undefined as any });
    const state = makeState({ _verifyEntered: false, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(true);
  });

  it('Tier-3/4 verification task + verify-mode + 빈 planText → isDone:true (기존 동작 보존)', () => {
    const task = makeTask({
      id: 'v1',
      type: 'verification',
      priority: 1000,
      selfVerifyOnDone: undefined as any,
    });
    const state = makeState({ _verifyEntered: true, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(true);
  });

  it('feature 태스크 + selfVerifyOnDone + verify-mode + 빈 planText → isDone:true', () => {
    const task = makeTask({
      id: 'f1',
      type: 'feature',
      priority: 400,
      selfVerifyOnDone: true,
    });
    const state = makeState({ _verifyEntered: true, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(true);
  });

  it('feature 태스크 apply-mode + 빈 planText → isDone:true (hidden-mooring-rivet — task type 무관 일관 계약)', () => {
    // user 확인 원칙: feature/ui/design-system도 sibling 중복 시나리오에서
    // 동일하게 empty-plan-as-done으로 빠져나올 수 있어야 한다. base.md /
    // rules.md가 모든 default-template task type에 동일 empty-plan 계약을
    // 가르치므로 finalize는 task type을 분기하지 않는다.
    const task = makeTask({
      id: 'f2',
      type: 'feature',
      priority: 400,
      selfVerifyOnDone: undefined as any,
    });
    const state = makeState({ _verifyEntered: false, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(true);
  });

  it('non-empty planText (실제 fix plan) → isDone:false, planText 보존 (execute로 라우팅)', () => {
    const task = makeTask({ type: 'error', selfVerifyOnDone: true });
    const state = makeState({ _verifyEntered: true, currentTask: task });
    const fixPlan = '{"diagnostics":{"totalErrors":3,"rootCauses":["..."]},"implementation":{"modify":[{"path":"a.ts"}]}}';

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: fixPlan,
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    // batchSplit skip + non-empty planText → noOpComplete:false → isDone:false.
    expect(result.llmResponse?.done).toBe(false);
    expect(result.planText).toBe(fixPlan);
  });
});
