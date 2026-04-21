# Verification Lifecycle Consolidation — Handoff

> **Status**: Phases F / 0 / A / D / G 완료. Phase G5 이후 추가 리팩토링/고도화 시 이 문서로 맥락 인수.
> **작업일**: 2026-04-19
> **선행 계획서**: `/Users/probe/.cursor/plans/verification_lifecycle_unification_a341947e.plan.md`
> **실 관측 장애**: `still-lacing-north` code job (workspace `to.nexus/probe/landing/features/nexus-design`)

---

## 1. 배경 한 줄

> 2026-02-11 `0be5a6b0` refactor 에서 `worker.captureState() → task.resumeState = ...` 연결 블록 6줄이 삭제되어 worker invocation 경계 건너 verification 진단 상태가 전부 휘발되었고, 이후 3개의 "axis 강화" 커밋이 끊어진 파이프라인에 데이터만 더 꽂았다. 이 번 작업은 (a) 끊어진 연결선 복구, (b) 16개 state 필드 → 11개, 19개 Axis → 0개로 통합이다.

## 2. 완료된 것 (Phase F / 0 / A / D / G)

### Phase F — 사용자 프로젝트 핫픽스

- [src/hooks/use-in-view.ts](/Users/probe/dev/ant-workspaces/to.nexus/probe/landing/features/nexus-design/codebase/src/hooks/use-in-view.ts): `useRef<T | null>(null)` → `useRef<T>(null)`, 리턴 타입도 동일. React 18 `div.ref` 타입 체크 통과. `tsc -b` + `vite build` 전부 pass.

### Phase 0 — State Model Consolidation

#### 0.1 Field retirement (16 → 11)

`ArchitectGraphState` 에서 5개 필드 **완전 제거** + 1개 **신규**:

| 제거 | 대체 경로 |
|---|---|
| `_diagnosticAttempts` | `_verificationAttempts` 로 일원화 |
| `_deepDiagnosticBudgetGranted` | `inDeepDiagnosticMode(state)` |
| `_lastPlanHash` | `lastPlanHash(state._appliedPlanHistory)` |
| (`_failedAttempts` 는 task 필드 — verification 에선 쓰지 않음, non-verification 유지) | — |

신규 1개:
- `_verificationAttempts?: number` — monotonic counter, 3 boundary 를 넘어 carry-over.

파일: [state.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/state.ts), [graph.ts CodeGraphChannels](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/graph.ts), [parallelTypes.ts WorkerSnapshot](/Users/probe/dev/ant/packages/ant-cli/src/agents/common/graph/parallelTypes.ts), [task.ts TaskResumeState](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/types/task.ts), [session.ts SessionState](/Users/probe/dev/ant/packages/ant-cli/src/core/types/session.ts).

#### 0.2 파생 헬퍼

**신규**: [utils/verificationAttempts.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationAttempts.ts)

```ts
export const DEEP_DIAGNOSTIC_THRESHOLD;   // 2
export function initAttempts(state);
export function bumpAttempts(state);
export function usedAttempts(state): number;
export function inDeepDiagnosticMode(state): boolean;
```

#### 0.3 모듈 통합 (19 Axis → 6 concepts)

| Module | 흡수된 Axis | 파일 |
|---|---|---|
| Gate tracking + completion | B, C, F-2 | 기존 `verificationCompleteness.ts`, `invalidationScope.ts` (주석 정리) |
| Install cache | A | 기존 `invalidationScope.ts` |
| Attempt accounting | E, G-1, G-7 | **신규** `verificationAttempts.ts` |
| Prior-attempt memory | D, F-3b, F-3c | 확장된 `taskRetryRetention.ts` |
| Loop escape | F-1, F-3, F-4 | **신규** `verificationLoopEscape.ts` |
| Deep-diagnostic mode | G-2, G-3, G-4, G-5, G-6 | **신규** `deepDiagnosticMode.ts` (`deepDiagnosticConfig.ts` + `diagnosticInspect.ts` 흡수) |

**삭제된 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/utils/deepDiagnosticConfig.ts`
- `packages/ant-cli/src/agents/common/tool/handlers/diagnosticInspect.ts`

#### 0.4 Call-site 업데이트

치환 매핑 (grep 검증됨):

| 구 참조 | 신 참조 |
|---|---|
| `state._diagnosticAttempts` | `state._verificationAttempts` |
| `state._deepDiagnosticBudgetGranted` | `inDeepDiagnosticMode(state)` |
| `state._lastPlanHash` | `lastPlanHash(state._appliedPlanHistory)` |
| `consumeVerificationBudget(state)` | `bumpVerificationAttempt(state)` (plan 내부) |
| `maybeGrantDeepDiagnosticBudget(state)` | 제거 (파생 모드에서 자동) |

영향 파일 (25): plan/index.ts, plan/planGeneration.ts, graph.ts, runner.ts, parallelTypes.ts, TaskWorker.ts, TaskOrchestrator.ts, tool/index.ts, codeCommandPolicy.ts, state.ts, task.ts, session.ts 등.

### Phase A — CarryOver Wire-up (끊어진 연결선 복구 + 확장)

#### A1/A2: `snapshotFromState` static 분리

[TaskWorker.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/parallel/TaskWorker.ts) 의 `captureState()` 메서드 본체를 **모듈 레벨 `snapshotFromState(state)` 함수**로 분리. plan 노드에서도 worker 인스턴스 없이 snapshot 생성 가능.

#### A3 — 3개 경계에서 capture

| 경계 | 위치 | 상태 |
|---|---|---|
| **A3-a** 외부 인터럽션 (SIGTERM 등) | [TaskOrchestrator.handleInterruption](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) 에 `captureWorkerSnapshots()` 메서드 추가 | **복구** (0be5a6b0 이전 상태) |
| **A3-b** 재시도 가능 실패 후 재큐 | `TaskOrchestrator.reportFailure` transient 분기에 `worker.captureState()` 추가 | **신규 확장** (과거에도 없었음) |
| **A3-c** plan batch-split 재큐 | [plan.processDiagnosticBatchSplit](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/nodes/plan/index.ts) 의 `requeuedTask` push 직전 `snapshotFromState(state)` 첨부 | **신규 확장** |

#### A4 — restore 블록

[TaskWorker.ts:152~168](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/parallel/TaskWorker.ts) 의 restore 가드는 유지, 신규 필드 (`_verificationAttempts`, `_verificationTracker`) 복원 라인 추가.

### Phase D — Typed Terminal Error

**신규**: [utils/verificationErrors.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationErrors.ts)

```ts
export type VerificationTerminalKind =
  | 'max_retries_exceeded'
  | 'no_progress'
  | 'unresolved_violations'
  | 'batch_cycle_limit';

export class VerificationTerminalError extends Error {
  readonly kind: VerificationTerminalKind;
  readonly carryOver?: WorkerSnapshot | null;
}

export function classifyTerminalError(error): TerminalClassification;
```

Throw sites:
- `plan.handleRetryEntry` 의 maxRetries throw → `VerificationTerminalError('max_retries_exceeded', ...)`
- `TaskWorker.executeTask` 의 unresolved violations throw → `VerificationTerminalError('unresolved_violations', ...)`

`TaskOrchestrator.reportFailure` 는 `classifyTerminalError(error)` 를 legacy regex 보다 먼저 호출해서 typed 에러를 우선 분류 → terminal 이면 permanent fail + drain.

### Phase G — Test + Logger + Axis Cleanup

#### G1: [tests/verification/unit/stateConsolidation.test.ts](/Users/probe/dev/ant/packages/ant-cli/tests/verification/unit/stateConsolidation.test.ts)

`inDeepDiagnosticMode`, `lastPlanHash`, `detectRepeatedPlan` 등 helper 회귀 방지. retire 된 필드가 `undefined` 로 비어 있음을 runtime 확인.

#### G2: [tests/verification/unit/snapshotCarryOver.test.ts](/Users/probe/dev/ant/packages/ant-cli/tests/verification/unit/snapshotCarryOver.test.ts)

`snapshotFromState` 가 모든 verification 필드를 전파하는지, restore spread 에서 동일 값이 읽히는지 round-trip 검증.

#### G3: [tests/verification/unit/terminalError.test.ts](/Users/probe/dev/ant/packages/ant-cli/tests/verification/unit/terminalError.test.ts)

`classifyTerminalError` 가 typed error 를 우선 인식, plain Error 는 terminal:false, throw/catch 통해 `instanceof` 보존.

#### G4: Logger 스키마 확장

[executionLogger.logVerificationRetry](/Users/probe/dev/ant/packages/ant-cli/src/core/utils/executionLogger.ts) 에 3개 필드 추가:
- `verificationAttempts`: 통합 카운터
- `prevPlanHash`: `lastPlanHash(_appliedPlanHistory)`
- `carryOverSize`: snapshot JSON 바이트 수

plan.ts 의 retry 로깅에서 이 필드들을 채움. 이후 비슷한 장애 발생 시 1분 이내 진단 가능.

#### G5: Axis 라벨 제거

```
$ rg "Axis [A-G]" packages/ant-cli/src
# → 0 matches
```

13개 파일에서 `Axis A~G / F-1~F-4 / G-1~G-7` 주석을 모듈 이름 기반 주석으로 rewrite.

---

## 3. 남은 결함 (후속 작업자에게 인수)

### H1. `decideLoopEscape` 통합 API 미사용 [cosmetic]

**파일**: [utils/verificationLoopEscape.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationLoopEscape.ts)

**상태**: 정의 O, 호출 사이트 0. 현재는 `hasEmptyImplementation`, `shouldSkipReverify`, `detectRepeatedPlan` 각 함수를 개별 호출. 기능적 결함 없음.

**후속 작업**: planRouter + plan.ts + executeRouter 의 loop escape 로직 3개를 `decideLoopEscape(state, planText)` 한 번으로 통일. LoopEscape union 의 `action` 필드로 분기. 장점: policy 변경이 한 곳에서.

### H2. `_installNeeded` 는 retire 하지 않고 유지 [documentation mismatch]

**상태**: 계획서에는 "retire" 로 명시, 실제 구현은 유지. `_installNeeded` 는 tool hook (`verificationInvalidated`, `depFileHashChanged`) 이 관리하는 캐시라 매번 재계산이 불필요 → 캐시가 타당함.

**후속 작업**: 플랜 문서 업데이트 (`16→10` → `16→11`). 이미 이 핸드오프 문서 기준으로는 11.

### H3. L2 시나리오 `S10-orchestrator-requeue-carry-over` 미작성 [gap]

**상태**: 기존 `S10-dep-manifest-surgical-invalidation` 과 이름 충돌. 핵심 regression prevention 테스트 (orchestrator 재큐 경로에서 carryOver 가 실제로 전파되는지) 미존재.

**후속 작업**: `S11-orchestrator-requeue-carry-over/` 디렉토리 생성.

**설계 제안**:
```json
// scenario.json
{
  "name": "S11-orchestrator-requeue-carry-over",
  "description": "verification 태스크가 in-plan 재시도 exhaust 후 VerificationTerminalError throw → orchestrator reportFailure → transient 재큐 시 _verificationAttempts / _appliedPlanHistory 가 다음 worker 에 복원되는지 검증.",
  "seed": "session.seed.json",
  "expected": {
    "taskStartsForVerification": 2,
    "secondRunInitialVerificationAttempts": "> 0",
    "secondRunInitialAppliedPlanHistoryLength": "> 0"
  }
}
```

**필요 mock**:
- LLM mock 이 1 번째 run 에서 plan 생성 → execute 시도 3회 전부 violation → `VerificationTerminalError('max_retries_exceeded')` throw 경로.
- 2 번째 run 의 plan-entry 직후 state inspector 가 `_verificationAttempts > 0` 확인.

### H4. 사용자에게 터미널 에러 visible 하게 surface [feature gap]

**상태**: `VerificationTerminalError(kind='no_progress' | 'max_retries_exceeded')` 로 종료 시 orchestrator 가 permanent fail + drain 하지만, **사용자 UI (Kanban) 에 "LLM이 수렴 못해 중단됨, 수동 개입 필요" 가 명시적으로 표시되지 않음**.

**후속 작업**:
- `learn` 노드에서 `state.interruption` 에 `reason: 'verification_no_progress'` 추가
- Kanban UI 에 해당 reason 용 카드 디자인
- `interruption.message` 에 `terminal.kind` 포함

---

## 4. 핵심 파일 지도

### 새 파일 (Phase 0 + D 에서 생성, 4개)

| 경로 | 역할 |
|---|---|
| [agents/architect/graph/code/utils/verificationAttempts.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationAttempts.ts) | 단일 시도 카운터 + 파생 헬퍼 |
| [agents/architect/graph/code/utils/verificationLoopEscape.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationLoopEscape.ts) | F-1/F-3/F-4 통합. `hasEmptyImplementation`, `shouldSkipReverify`, `detectRepeatedPlan`, `normalizePlanForHash`, `lastPlanHash`, `decideLoopEscape` |
| [agents/architect/graph/code/utils/deepDiagnosticMode.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/deepDiagnosticMode.ts) | G-2~G-7 통합. `inDeepDiagnosticMode`, `collectConfigSnapshot`, `renderConfigBlock`, `shouldRelaxCommandGuards`, `isDiagnosticInspectCommand` |
| [agents/architect/graph/code/utils/verificationErrors.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/utils/verificationErrors.ts) | `VerificationTerminalError` 클래스 + `classifyTerminalError` |

### 확장된 파일

| 경로 | 변경 |
|---|---|
| [core/context/taskRetryRetention.ts](/Users/probe/dev/ant/packages/ant-cli/src/core/context/taskRetryRetention.ts) | `dedupeViolationsAgainstSummary`, `describeRetryRetention`, `RetryRetentionMeta` 추가 |
| [agents/common/graph/parallelTypes.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/common/graph/parallelTypes.ts) | WorkerSnapshot 필드 재구성 |
| [agents/architect/types/task.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/types/task.ts) | `TaskResumeState` 에 verification 필드 추가 |
| [agents/architect/graph/code/parallel/TaskWorker.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/parallel/TaskWorker.ts) | `snapshotFromState` static export, `captureState` thin wrapper |
| [agents/architect/graph/code/parallel/TaskOrchestrator.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) | `captureWorkerSnapshots` helper, `reportFailure` verification 분기, `classifyTerminalError` 우선 분류 |
| [agents/architect/graph/code/nodes/plan/index.ts](/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/code/nodes/plan/index.ts) | `bumpVerificationAttempt`, `_appliedPlanHistory` 기반 repeat 감지, `VerificationTerminalError` throw, batch split 재큐 snapshot attach |

### 삭제된 파일

- `agents/architect/graph/code/utils/deepDiagnosticConfig.ts` → deepDiagnosticMode.ts 에 흡수
- `agents/common/tool/handlers/diagnosticInspect.ts` → deepDiagnosticMode.ts 에 흡수

---

## 5. 설계 원칙 (후속 작업자 참고)

### 원칙 1: "Axis N+1" 을 만들지 말 것

verification 작업에서 새 state 필드 추가 충동이 생기면 먼저 **"기존 필드로 파생 가능한가?"** 질문. 과거 13~19개 Axis 가 쌓인 이유는 매 fix 마다 플래그를 추가했기 때문. 이번 리팩토링 원칙: **새 필드 1개 추가 = 기존 필드 1개 이상 제거.**

### 원칙 2: state SSOT 는 `_verificationAttempts`

verification 시도 횟수를 표현하는 다른 숫자를 state 에 추가하지 말 것. budget, deep-mode 활성화, termination 판단 모두 이 한 필드에서 파생.

### 원칙 3: 상태 carry-over 는 3 경계 모두 커버

`handleInterruption` / `reportFailure` (transient) / `plan.processDiagnosticBatchSplit` 셋 중 하나라도 `snapshotFromState + resumeState` 연결이 빠지면 regression. **상태 전달을 추가하는 모든 신규 경계는 이 3개 사례를 reference 로 삼을 것.**

### 원칙 4: Terminal 에러는 typed

`VerificationTerminalError` 의 `kind` union 에 새 종류를 추가할 때:
1. `verificationErrors.ts` 의 `VerificationTerminalKind` 에 추가
2. `tests/verification/unit/terminalError.test.ts` "works for all defined kinds" 케이스에 추가
3. orchestrator 가 자동으로 처리 (추가 코드 불요)

### 원칙 5: module-based 주석

"Axis X" 대신 "`utils/verificationAttempts.ts` 참조" 처럼 **실제 코드 위치** 를 명시. grep 으로 추적 가능해야.

---

## 6. 현재 빌드/테스트 상태

```
$ cd packages/ant-cli && pnpm test
 Test Files  51 passed (51)
      Tests  1148 passed (1148)

$ pnpm build:cli
 → esbuild bundling complete (no regressions)

$ cd /Users/probe/dev/ant-workspaces/to.nexus/probe/landing/features/nexus-design/codebase
$ pnpm exec tsc -b && pnpm exec vite build
 → ✓ built in 876ms
```

---

## 7. 후속 작업 우선순위 제안

| 우선 | 항목 | 범위 | 비고 |
|---|---|---|---|
| P0 | **H4** (사용자 surface) | UI 변경 포함 | 사용자 UX 에 직접 영향 |
| P0 | **H3** (S11 시나리오) | L2 테스트 1개 | regression prevention 핵심 |
| P1 | **H1** (decideLoopEscape 통합) | plan.ts / routers | cosmetic but reduces duplication |
| P2 | **H2** (plan md 업데이트) | docs only | discrepancy 해소 |
| P2 | **H5** (docs/14-code-job.md) | docs only | 사용자 가이드 품질 |

## 8. 재현 장애 시나리오 (Regression 가드)

`still-lacing-north` 장애가 재발하는지 확인하려면:

1. `_verificationAttempts` 가 다음 조건에서 **유지**되는지:
   - enforce → plan retry → plan 재실행 (in-plan boundary)
   - execute.done → reverify plan (reverify boundary)
   - TaskWorker catch → reportFailure transient → new worker spawn (**orchestrator boundary — 핵심 regression 지점**)

2. `rg "Axis [A-G]" packages/ant-cli/src` → 0 결과 유지

3. `classifyTerminalError(new VerificationTerminalError('any kind', 'msg'))` → `{ terminal: true }` 유지

4. `plan.handleRetryEntry` 의 maxRetries throw 가 `VerificationTerminalError` 인스턴스인지

5. (runtime) verification 태스크가 Run 1 → Run 2 재큐 시, Run 2 plan-entry 시점에 `state._verificationAttempts > 0` 이고 `state._appliedPlanHistory.length > 0`

---

## 9. 참고 자료

- **원 플랜**: `/Users/probe/.cursor/plans/verification_lifecycle_unification_a341947e.plan.md`
- **실 관측 장애 로그**: `/Users/probe/dev/ant-workspaces/to.nexus/probe/landing/features/nexus-design/sessions/architect/debug/logs/log-still-lacing-north.json`
- **실 장애 프롬프트**: `/Users/probe/dev/ant-workspaces/to.nexus/probe/landing/features/nexus-design/sessions/architect/debug/prompts/prompt-still-lacing-north.md`
- **Regression 시작 커밋**: `0be5a6b0 refactor: extract drain/signalWorkersToStop helpers in TaskOrchestrator.handleInterruption` (2026-02-11)
- **통합 전 상태의 추가 "axis" 커밋들**: `75a5e021` (B 도입), `6c7c34f0` (batch split), `34760473` (D 도입), `e289df2d` (Passed guard), `be3e26e1` (scenario harness), `8277b313` (G 도입, HEAD)
