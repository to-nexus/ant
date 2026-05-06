/**
 * Plan-finalize 의 큐 변이 sub-step.
 *
 * `finalizePlanOutcome` 가 두 책임 (plan-text 처리 + 큐 변이) 을 동시에
 * 가지던 구조를 분리한다. 큐 변이는 본 모듈 — `processDiagnosticBatchSplit`
 * 호출 + 결과 planText 반환만 담당.
 *
 * 큐 변이의 종류 (모두 `processDiagnosticBatchSplit` 안에서 발생):
 *   - Path A (verification parent): 원본 verification 재큐 + N 개 error 서브태스크 push,
 *     `_failedAttempts` 보존 (`re-queue retry-budget reset` 회귀 가드).
 *   - Path B (error parent / Tier 2 escalate): 원본 drop + N 개 서브태스크 push +
 *     (없으면) 새 Final Verification (priority 1000) 추가, `remediation prePlanText loss` 회귀 가드.
 *   - 공통: `state._batchSplitRequeued = true` set, `Session.onBatchSplit` (배치-스플릿
 *     카운터 + attempt 카운터) 호출.
 *   - 임계: `Session._batchSplitCount > MAX_BATCH_SPLIT_CYCLES (10)` →
 *     `VerificationTerminalError('batch_cycle_limit')` throw → orchestrator 가
 *     `classifyTerminalError` 로 terminal 분류.
 *
 * 의미 변경 0 — `processDiagnosticBatchSplit` 의 호출 시점 / 큐 mutation /
 * Session 변이 / throw 동작 모두 동일. 단지 호출 site 가 plan-layer 의
 * 다른 책임 (assertVerificationPlanIsFanoutOnly / tracePlanFinalize) 와
 * 분리되어 grep 시 큐 변이가 본 파일로 국한된다.
 */

import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { processDiagnosticBatchSplit } from '../../../tasks/_shared/batchSplit';

/**
 * 큐 변이 (batch-split fan-out) 호출. 결과 planText 는:
 *   - fan-out 발생 시 `''` (원본 plan 이 sub-task 들로 변환됨)
 *   - fan-out 미발생 시 입력 `preSplitPlanText` 그대로
 *
 * @throws `VerificationTerminalError('batch_cycle_limit')` — `Session._batchSplitCount`
 *         이 `MAX_BATCH_SPLIT_CYCLES = 10` 초과 시. 호출자는 그대로 propagate
 *         (orchestrator 가 terminal 분류).
 */
export function dispatchBatchSplit(
  state: ArchitectGraphState,
  preSplitPlanText: string,
  nextTask: CodeTask,
): string {
  return processDiagnosticBatchSplit(state, preSplitPlanText, nextTask);
}
