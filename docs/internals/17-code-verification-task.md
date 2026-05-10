# Code Verification Task — Contract

> **상태**: Code job verification 책임의 SSOT. 코드 현황과 다르면 코드를 따른다(코드가 진실); 단, 본 문서가 선언한 **의도된 책임/불변식/안티패턴**은 리팩토링/버그 fix 시 지침으로 강제된다.
> **1순위 독자**: AI 에이전트 (verification 관련 작업 시 컨텍스트 주입용).

---

## 0. 한 줄 정의

**Verification Task = "검증 (typecheck / build / test) 을 실제로 실행하고, 실패 시 root cause 분석 → solution 마다 error sub-task 로 fan-out → 다음 cycle 에 재진입하여 재검증" 책임자**.

가장 짧은 invariant:

> **Verification cycle 진행/종료는 LLM 의 conversation history 판단 + 4 fail-safe terminal 만으로 결정된다.** 결정론적 gate cache / passed Set / repeated-plan hash / deep mode / install observation cache 같은 보조 axis 는 모두 retired (vast-curling-perch RCA + Aggressive 단순화).

---

## 1. 적용 범위 + 책임자 식별

### 1.1 두 종류의 책임자

| 종류 | 식별 | 활성 시점 | 비고 |
|---|---|---|---|
| **Tier 3/4 dedicated verification task** | `isVerificationTask(task)` (priority 1000, type `'verification'`) | task fresh entry 시 즉시 verify-mode | 큐의 마지막 (Final Verification) |
| **Tier 2 self-verify task** | `task.selfVerifyOnDone === true` (decompose 시 set; type 은 error/feature/ui/setup) | apply phase `<done>` emit 시점 (executeRouter.routeAfterDone === 'plan' 분기) | 단일 task 안에서 apply→verify two-cycle |

### 1.2 통합 predicate (SSOT)

```ts
// tasks/_shared/verify/predicate.ts
export function requiresVerification(task): boolean {
  if (!task) return false;
  if (isVerificationTask(task)) return true;
  return task.selfVerifyOnDone === true;
}
```

**phase 노드/router/composeBundle 은 task type 을 직접 참조하지 않고 이 predicate 만 사용.** R1 (Task Type Blind Phases) 의 자연스러운 확장.

### 1.3 phase mode 채널

| 채널 | writer (single) | 의미 |
|---|---|---|
| `state._verifyEntered: boolean` | [`tasks/_shared/verify/markVerifyEntered.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/markVerifyEntered.ts) | task 가 verify-mode 로 진입했는가 |
| `task.batchSplitCount: number` | [`tasks/_shared/batchSplit/process.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) Path A/B 재큐 | verify cycle 의 batch-split 횟수 (carry-over via 직접 field 할당) |

두 채널의 set 시점:
- **Tier 3/4 verification task**: handleFreshTaskEntry 진입 시 `markVerifyEntered(state)` 가 자동 호출 (verification task 는 fresh path 통합 — verify-entry-unify).
- **Tier 2 self-verify**: `executeRouter` `<done>` 분기에서 `routeAfterDone === 'plan'` 결정 직후 `markVerifyEntered(state)` 호출 → 다음 plan entry 부터 verify-mode plan/execute 활성.

> `state.verification: VerificationSession` 채널은 **retire** 되었다 (plan §5.6.3). gate / passed / required / install cache / attempt counter / plan history 모두 LLM 의 conversation history + priorErrorTasks prompt inject 로 대체된다.

---

## 2. 책임 매트릭스 (4개)

각 책임의 **단일 SSOT 위치** + **위반 시 결과**.

| # | 책임 | SSOT | 위반 시 |
|---|---|---|---|
| 1 | **검증 행위 수행** — dependency 설치 (필요 시), typecheck (지원 언어), build, test 를 LLM 이 `run_command` tool 로 실제 실행. 장시간 실행 명령 (dev server / 워치) 의 도구 결과는 verdict 없는 사실 보고서로 돌아오므로 ([19-tool-system.md §RUN_COMMAND](19-tool-system.md)) LLM 이 `exit:` / `http_probe:` / 프레임워크 에러 글리프를 직접 읽고 판단한다 | LLM (verify-mode plan tool-loop) — runtime gate guard 없음 | 실행 안 한 채 done emit 시 false-pass 가능 (LLM 자율 신뢰) |
| 2 | **root cause 진단 + solution 생성** — 실패 시 plan tool-loop 가 build/test 출력 + 에러 파일 내용을 읽어 root cause 분리, planText (구조화 JSON) 로 emit | LLM via verify-mode plan prompt ([`buildPlanPrompt`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/prompt/buildPlanPrompt.ts)) | LLM 결정 |
| 3 | **batch-split (always-fan-out)** — solution 의 각 target 을 per-target error sub-task 로 fan-out, 부모 verification 은 재큐 (Path A) 또는 final-verification 신규 (Path B) | [`tasks/_shared/batchSplit/process.ts::processDiagnosticBatchSplit`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) | n=0 implementation 시 plan 은 빈 plan + done → finalize 가 결정 |
| 4 | **재진입 + 재검증** — error sub-task 들이 완료된 뒤 priority queue 가 verification 을 다시 pop, fresh entry 로 재실행 | [`TaskOrchestrator`](../../packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) priority queue + handleFreshTaskEntry | 큐 priority 위반 시 verification 이 먼저 실행되어 false-fail |

> verification task 자신은 fix 를 시도하지 않음 (책임 양극화 — fan-out 후 즉시 `done:true`).

---

## 3. 회귀 가드 SSOT (단일 축)

```
회귀 가드 = LLM judgment from conversation history + 명시 inject
├─ Banner (단순화)              — Prior batch-split cycles: N
├─ priorErrorTasks (prompt-injected) — 이전 모든 error sub-task {name, description}
└─ Fail-safe terminals (4개)
   ├─ batch_cycle_limit          (MAX_BATCH_SPLIT_CYCLES=10) ★ verification 한정
   ├─ max_retries_exceeded        (state.retries — 일반 task)
   ├─ unresolved_violations       (일반 task)
   └─ orchestrator_fail_limit     (task._failedAttempts ≥ MAX_TASK_RETRIES=2 — verification 도 동일 적용)
```

**폐기된 회귀 가드** (의도적):
- `no_progress` terminal (planHistoryHashes 기반) — vast-curling-perch RCA §2.1, plan §4.1
- `missed_done_loop` terminal (`Session._attempts ≥ MISSED_DONE_TERMINAL`) — plan §5.1
- `Safety Net C` (`_finalTaskLoopCount` 기반 verify-only loop guard) — plan §5.3
- `Session.passed/required` gate cache + `commandGuard.guard` (already-passed / ordering) — plan §5.4 (LLM judgment + prompt rule 로 대체)
- `Session._installNeeded` install observation cache — plan §5.2 (`state._installNeededTransient` 일회성 prompt var 로 대체)
- `Session._attempts` deep-diagnostic mode + isDeepDiagnostic prompt 분기 — plan §5.1
- `hasOwnAttemptCounter` orchestrator hook (verification 자체 attempt counter) — plan §5.6.1 (`_failedAttempts` 통합)

---

## 4. Lifecycle (post-Aggressive)

```
verification task fresh entry (cycle 1)
  ↓ handleFreshTaskEntry — markVerifyEntered
  ↓ recomputeInstallNeeded → state._installNeededTransient
  ↓ buildPlanPrompt (verify-mode)
    ↓ banner: "Prior batch-split cycles: N" (N=task.batchSplitCount)
    ↓ priorErrorTasks: state.completedTasksDetails.filter(error)
  ↓ LLM tool-loop (run_command typecheck/build/test, read_file, etc.)
  ↓ LLM emit planText with batches[]
  ↓ processDiagnosticBatchSplit
    ↓ Path A (verification parent): re-queue with task.batchSplitCount += 1
    ↓ spawn N error sub-tasks
  ↓ orchestrator dispatches error sub-tasks (priority < 1000)
  ↓ error sub-tasks complete → orchestrator pops verification again
verification task fresh entry (cycle 2+) — same path, banner shows N+1
  ↓ ... loop until LLM emits empty plan + done (success) OR
        batch_cycle_limit fires (failure)
```

**self-verify Tier 2 task** lifecycle:
```
apply phase plan/execute (task-type-specific hooks)
  ↓ <done> emit
  ↓ executeRouter.routeAfterDone (verify-mode)
    ↓ markVerifyEntered + _nextPlanEntry='reverify'
  ↓ next plan node entry: handleReverifyEntry (얇은 함수)
    ↓ NODE_EXECUTE clear + recomputeInstallNeeded (NODE_PLAN 보존)
  ↓ verify-mode plan/execute hooks active
  ↓ ... same verification loop as Tier 3/4
```

**핵심 단순화 (vast-curling-perch + Aggressive)**:
- verification task 의 fresh / reverify 분기 제거 (모두 `handleFreshTaskEntry`)
- self-verify Tier 2 의 첫 verify entry 판단 제거 — apply phase plan 대화는 conversation history 의 일부로 보존
- VerificationSession 클래스 폐기 — gate set / passed cache / attempts counter / install cache 모두 LLM judgment 로 대체
- 11 파일 폐기 (Session.ts/snapshot.ts/initSession.ts/freshEntry.ts/sessionLifecycle.ts/sessionTrace.ts/orchestrator.ts/commandGuard.ts/toolHook.ts/checkEvaluate.ts/gates.ts)

---

## 5. 핵심 prompt 구성

verify-mode plan prompt ([`verification/base.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/variants/verification/base.md)):

```handlebars
{{#if hasSessionSummary}}
## Verification Cycle Status
{{{sessionSummary}}}                       # "Prior batch-split cycles: N"
{{/if}}

{{#if priorErrorTasks}}
## Prior Error Sub-Tasks Completed
{{#each priorErrorTasks}}
- "{{name}}" — {{description}}
{{/each}}

**Principle**: A new plan that repeats the same root cause / file / fix
angle as one of the above tasks is a regression. Diagnose what made them
insufficient and approach from a different angle.
{{/if}}

{{#if dependencyStatus}}
## Dependency Observation
{{{dependencyStatus}}}                     # state._installNeededTransient
{{/if}}

## Protocol
... typecheck → build → test order
```

---

## 6. 코드 위치 (post-restructure)

```
tasks/_shared/verify/
  index.ts                   # barrel
  predicate.ts               # requiresVerification
  composeBundle.ts           # router-only verify-mode dispatch
  activeHooks.ts             # phase-mode plan-prompt + execute-hook resolver
  markVerifyEntered.ts       # _verifyEntered channel SSOT + clearForTaskBoundary
  emptyImpl.ts               # plan-empty shortcut helpers
  env/
    env.ts                   # detectTestFilesFromDisk + isTypeScriptProject + probeInstallStatus
  terminal/
    budget.ts                # 3-axis VerificationBudget (planRetries, orchestratorFails, batchSplits)
    errors.ts                # 4 VerificationTerminalKind values
  prompt/
    buildPlanPrompt.ts       # verify-mode plan prompt builder
    priorErrorTasks.ts       # prior-error-tasks helper (state.completedTasksDetails filter)
  hooks/
    executeHook.ts           # verify-mode execute config
    router.ts                # verify-mode routeAfterDone (empty-plan → checkTaskStatus, plan otherwise)

tasks/verification/
  index.ts                   # bundle wiring
  hooks/decompose.ts         # isExclusive
  hooks/conversations.ts     # convKey
  model/is.ts                # isVerificationTask predicate
```

---

## 7. References

- [`docs/tmp/vast-curling-perch-remaining.md`](../tmp/vast-curling-perch-remaining.md) — RCA + 잔여 작업 (이 plan 의 origin)
- [`/Users/probe/.cursor/plans/vast-curling-perch_verify_cleanup_e97cdde1.plan.md`](../../.cursor/plans/vast-curling-perch_verify_cleanup_e97cdde1.plan.md) — 본 문서의 변경을 추진한 plan
