/**
 * Regression — verify-mode sentinel을 받으면 plan 사이클이 종료돼야 한다.
 *
 * Bug (job `solar-coming-bough`): Tier-2 self-verify error 태스크가 verify-
 * mode 사이클에서 `typecheck/build/test` 게이트를 모두 통과하고 no-errors
 * sentinel(`{diagnostics:{totalErrors:0,...},implementation:{modify:[],create:[],
 * delete:[]}}`) 을 emit했는데도 plan 사이클이 종료되지 않고 다음 plan-tool-loop
 * 라운드를 또 시작했다. 그 이유는 `nodes/plan/llm/tools.ts`와
 * `nodes/plan/outcome/finalize.ts`의 두 게이트가 정적 task type 검사
 * (`hooksForTaskType(task.type)?.plan?.allowsEmptyImplShortcut` /
 * `isVerificationTask(task)`)로만 fire되어 `task.type === 'error'`인 Tier-2
 * self-verify의 sentinel을 인식하지 못했기 때문.
 *
 * Fix는 두 게이트를 verify-mode 상태 (`isVerifyModeActive(state)`) 기반으로
 * 교체. requiresVerification(task)인 모든 task — verification task type +
 * 모든 `selfVerifyOnDone:true` 타입 — 가 동일한 verify-mode 프롬프트·동일한
 * sentinel 계약을 공유하므로 task type을 분기할 필요가 없다.
 *
 * 이 테스트는 `finalizePlanOutcome` (post-shortcut 게이트)를 직접 호출해서
 * verify-mode + 빈 planText 조합이 `isDone:true`를 만들고, apply-mode는
 * 그대로 통과시키는지 확인한다.
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

describe('finalizePlanOutcome — verify-mode sentinel 게이트 (solar-coming-bough 회귀)', () => {
  it('Tier-2 self-verify error + verify-mode + 빈 planText → isDone:true', () => {
    // Plan-tool-loop의 sentinel shortcut이 verify-mode에서 sentinel을 ''로
    // 비웠다고 가정 (`nodes/plan/llm/tools.ts` fix). finalize는 이 빈 문자열을
    // verify-mode + planText==='' 게이트로 done 처리해야 한다.
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

  it('Tier-2 self-verify error + apply-mode + 빈 planText → isDone:false (apply 단계에서 빈 plan은 done이 아님)', () => {
    // 회귀 가드: apply 단계의 빈 plan은 다른 경로(execute의 emptyPlanFallback 등)가
    // 처리한다. finalize의 verify-mode 게이트가 잘못 fire하면 안 됨.
    const task = makeTask({ type: 'error', selfVerifyOnDone: true });
    const state = makeState({ _verifyEntered: false, currentTask: task });

    const result = finalizePlanOutcome(state, task, {
      preSplitPlanText: '',
      callSite: 'plan-llm-toolloop',
      skipBatchSplit: true,
    });

    expect(result.llmResponse?.done).toBe(false);
  });

  it('Tier-3/4 verification task + verify-mode + 빈 planText → isDone:true (기존 동작 보존)', () => {
    // 옛 `allowsEmptyImplShortcut`/`isVerificationPassWithoutCodeGen` 게이트로
    // fire되던 정상 경로가 새 verify-mode axis로도 동일하게 fire되는지 확인.
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

  it('feature 태스크 + selfVerifyOnDone + verify-mode + 빈 planText → isDone:true (task type 비분기 확인)', () => {
    // 사용자 확인 원칙: "error 타입말고 feature, ui 등도 자체검증이 가능하니까
    // 그것 외에도 더 있을 수 있다". verify-mode 진입한 모든 selfVerifyOnDone
    // task가 동일하게 sentinel을 인정받아야 한다.
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

  it('일반 feature 태스크 (selfVerifyOnDone 없음, apply-mode) + 빈 planText → isDone:false', () => {
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

    expect(result.llmResponse?.done).toBe(false);
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

    // batchSplit skip + non-empty planText → diagnosticPass:false → isDone:false.
    expect(result.llmResponse?.done).toBe(false);
    expect(result.planText).toBe(fixPlan);
  });
});
