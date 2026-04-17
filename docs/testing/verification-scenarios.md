# Verification Scenario Harness

> **한 줄 요약**: code job의 verification 루프가 9가지 실패 상황에서 올바른 분기를 타는지, LLM을 돌리지 않고도 반복 검증할 수 있게 하는 3-레이어 테스트 하네스.

## 1. 왜 필요한가

code job의 verification 태스크는 `plan → execute ↔ tool → checkTaskStatus → learn → plan`의 닫힌 루프를 돌며, 내부에서 **3종류**의 분기를 선택한다:

1. **같은 task 내부 reverify** (`executeRouter` — 코드 수정 후 다시 plan으로)
2. **error 서브태스크 batch split** (`plan/processDiagnosticBatchSplit` — 에러가 많으면 파일 단위로 분해 후 재큐)
3. **violation 후 enforce → retry** (`routeAfterCheckTaskStatus` — 태스크 내 재시도)

실제 code job은 느리고 비결정론적이어서 "3번째 plan hash 반복에서 force split된다"거나 "done 태그만 나오고 tracker가 비어 있어 verification_incomplete가 떠야 한다" 같은 분기를 사람이 손으로 재현할 수 없다. 박제된 시나리오로 1초 안에 반복 검증해야 회귀가 안 남는다.

## 2. 3-레이어 피라미드

```
┌─ L4 전체 E2E              수동           smoke only ───┐
│  L3 실제 LLM resume       반결정론       nightly/선택  │
│  L2 LLM-mock resume       결정론         메인 (runner) │
└─ L1 노드 유닛 (vitest)    완전 결정론    빌드 게이트   ┘
```

| 레이어 | 입력 통제 | LLM | 실행 시간 | CI | 커버 대상 |
|---|---|---|---|---|---|
| **L1 유닛** | 가짜 state 직조립 | 없음 | ms | ✅ prebuild | 순수 분기 함수 |
| **L2 시나리오** | seed 세션 + commandInject + LLM mock | mock | 초 | opt-in | verification 루프 전체 |
| **L3 실제 LLM** | 동일하되 실제 LLM | 실제 | 분 | 수동/nightly | L2 결과의 회귀 확인 |
| **L4 전체 E2E** | `e2e-runbook.md` | 실제 | 분+ | 수동 | 사용자 경험 스모크 |

**이 문서의 초점은 L1과 L2**. L1은 빌드 게이트에 포함되어 있고(`pnpm test:cli`), L2는 `pnpm scenario [--list | Sxx | --all]`로 10개 시나리오(S00~S09) 전체가 재현 가능하다 (§8 참조).

## 3. 용어표

| 용어 | 뜻 | 본 하네스에서의 구현 |
|---|---|---|
| Fault Injection | 고의 실패 주입 | `ANT_COMMAND_INJECT` + `ANT_COMMAND_OVERLAY_MODE` |
| State Seeding | 중간 상태에서 재개 | `sessions/architect/code.json`에 verification 직전 상태 박제 |
| Scenario Matrix | 실패 유형 × 분기 전략 행렬 | `scenarios/S01`..`S09` 디렉터리 |
| Test Doubles | 외부 의존성 대역 | `MockLLMClient` (기존) + `commandInject` (신규) |
| Hermetic | 재현 가능한 격리 환경 | `.ant-test/scenario-runs/<runId>` 매 실행 fresh |

## 4. 커버리지 매트릭스 (C1~C16)

행 = verification 로직의 분기/상태, 열 = 레이어.

| # | 코드 분기 (파일·라인) | L1 유닛 | L2 시나리오 | ID |
|---|---|:---:|:---:|---|
| C1 | `isVerificationComplete` 모든 조합 | ✅ | · | — |
| C2 | `routeAfterCheckTaskStatus` — violations=0 → learn | ✅ | ○ | S01, S06 |
| C3 | 동 — violations>0 + retries<max → enforce | ✅ | ○ | S08 |
| C4 | 동 — retries>=max → learn | ✅ | ○ | S09 |
| C5 | 동 — recursionRemaining<20 → learn | ✅ | · | — |
| C6 | `processDiagnosticBatchSplit` — batches>=2 분기 | ✅ | ○ | S02 |
| C7 | 동 — forceByRepeat (`_lastPlanHash` 반복) | ✅ | ○ | S04 |
| C8 | 동 — budgetExhausted (`_verificationBudget=0`) | ✅ | ○ | S05 |
| C9 | 동 — overErrorBudget / overFileBudget | ✅ | · | — |
| C10 | `executeRouter` done + completeness.ok → checkTaskStatus | · | ○ | S01 |
| C11 | 동 — done but incomplete → plan(reverify) | · | ○ | S03 |
| C12 | `checkTaskStatus` — `<done>` + tracker 불완전 → `verification_incomplete` | · | ○ | S08 |
| C13 | 동 — error task 완료 시 final verification 자동 추가 | · | ○ | S07 |
| C14 | `plan` 노드 — verification 진입 시 tracker·budget 초기화 | · | ○ | S01..S09 |
| C15 | `plan` 노드 — verification retry 시 tracker attempted 리셋 | · | ○ | S08 |
| C16 | `tool` 노드 — typecheck/build/test 명령 분류 → tracker 갱신 | · | ○ | S01, S03, S06 |

**현재 상태**: L1 컬럼(C1~C9)은 모두 `pnpm test:cli`에서 자동 검증됨.
L2 컬럼은 스키마 + 인젝션 레이어는 도입 완료, 러너 + fixture는 후속.

## 5. 시나리오 매트릭스 (L2 목표)

| ID | 이름 | Mode | 시드 상황 | 주입 | 기대 경로 | 검증 |
|---|---|---|---|---|---|---|
| S01 | single-type-error-reverify | real | tracker 미완료, 큐에 verification 1개 | 없음 | plan → tool(tsc fail) → execute → router(reverify) → plan → tool(pass) → check → learn | C10, C14, C16 |
| S02 | multi-file-build-errors-split | overlay | tracker 미완료 | 2파일 에러 stderr 고정 | plan(batches=2) → split → error 서브태스크 2 + 원본 재큐 | C6 |
| S03 | typecheck-plus-test-failure | real | tracker 미완료 | 없음 | 연속 reverify 2회 후 완료 | C11, C16 |
| S04 | repeated-plan-hash-force-split | overlay | `_lastPlanHash` 기세팅 | tsc stderr 고정 | forceByRepeat → split | C7 |
| S05 | budget-exhausted-force-split | stub | `_verificationBudget=0` | tsc stub | budgetExhausted → split | C8 |
| S06 | no-tests-no-typecheck | real | tsconfig/tests 없음 | 없음 | build만 돌고 즉시 완료 | C2, C14 |
| S07 | error-only-job-final-verification-autoadd | stub | error 태스크 1개만 | 명령 skip | final verification 자동 추가 | C13 |
| S08 | done-but-incomplete | stub | — | LLM mock이 즉시 `<done>` | verification_incomplete → enforce → retry | C3, C12, C15 |
| S09 | retries-exhausted-learn-exit | stub | `retries=3, maxRetries=3` | `<done>` + tracker 미완료 | enforce 안 타고 learn으로 | C4 |

## 6. S02 완전 워크스루

### 디렉터리
```
scenarios/S02-multi-file-build-errors-split/
├── scenario.json
├── feature/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── a.ts   # const x: number = "str"
│       └── b.ts   # import { y } from './c'
├── session.seed.json
└── inject.json
```

### `session.seed.json`
```json
{
  "taskQueue": [
    { "id": "final-verification", "name": "Final Verification",
      "type": "verification", "priority": 1000, "status": "todo" }
  ],
  "currentTask": null,
  "completedTasks": [],
  "retries": 0,
  "maxRetries": 3,
  "_verificationBudget": 8,
  "_verificationTracker": null
}
```
→ resume 시 plan 노드가 pop한 뒤 tracker를 초기화한다.

### `inject.json`
```json
{
  "rules": [
    { "pattern": "pnpm (run )?build|tsc",
      "exitCode": 1,
      "stderr": "src/a.ts(1,7): error TS2322...\nsrc/b.ts(1,10): error TS2307..." }
  ]
}
```

### `scenario.json`
```json
{
  "name": "multi-file-build-errors-split",
  "description": "두 파일 빌드 에러 → plan이 batches=2 반환 → split",
  "mode": "overlay",
  "expected": {
    "routeSequence": ["plan", "execute", "tool", "plan"],
    "taskQueueAfterSplit": [
      { "type": "error", "prePlanTextIncludes": "a.ts" },
      { "type": "error", "prePlanTextIncludes": "b.ts" },
      { "type": "verification", "_batchSplitCount": 1 }
    ],
    "flagSet": ["_batchSplitRequeued"]
  }
}
```

### 러너 실행 단계 (향후)
1. `feature/`를 `.ant-test/scenario-runs/S02-<ts>/.../features/S02/codebase/`로 복사.
2. `session.seed.json`을 `features/S02/sessions/architect/code.json`로 기록.
3. `latest` 심링크 갱신.
4. `env: { ANT_WORKSPACE_BASE_PATH, ANT_COMMAND_INJECT, ANT_COMMAND_OVERLAY_MODE=overlay, ANT_LLM_MOCK_RESPONSE_DIR }` 주입.
5. `ant-cli resume-job --project verification --feature S02 --job code` 실행.
6. 종료 후 `features/S02/sessions/architect/code.json` 재로드.
7. `expected`와 비교 → diff 리포트.
8. `--keep=fail|all|none` 정책에 따라 디렉터리 유지/삭제.

## 7. 실행 모드 가드 (F10 해결)

`scenario.json`의 `mode` 필드는 필수다. 러너가 다음 조합을 검사한다:

| 검사 | 규칙 | 기대 동작 |
|---|---|---|
| `mode=real` + `inject.json` 존재 | 실제 실행에 인젝션 섞임 | 러너 중단 (에러) |
| `mode=stub` + 실제 에러 포함 fixture | 실제 버그를 stub이 가릴 수 있음 | 러너 경고 |
| `mode=overlay` + `inject.json` 없음 | 덮어쓸 내용이 없음 | 러너 경고 |

## 8. 현재 구현 상태

### 8.1 도입 완료 (토대 PR `verification_scenario_harness_a1514eb3`)
- ✅ `.gitignore`에 `/.ant-test/` 추가
- ✅ L1 유닛 테스트 (`tests/verification/unit/`) — 10 파일, ~1069 total cases
- ✅ `processDiagnosticBatchSplit`, `normalizePlanForHash` 테스트 전용 export
  (`__testing__` 네임스페이스)
- ✅ Command Mock Layer (`src/utils/commandInject.ts`) + `runCommand.ts` 통합 (프로덕션 경로 영향 없음)
- ✅ `@ant/shared`에 `ScenarioConfig` / `ScenarioSessionSeed` / `ScenarioCommandInjectFile` / `ScenarioRunResult` 타입 스키마
- ✅ 본 설계 문서

### 8.2 도입 완료 (러너 PR `verification_scenario_followup_fb7bb611`)
- ✅ **CLI**: `pnpm --filter @ant/cli resume-job` (`src/cli/resume-job-cli.ts`) — HTTP `/resume` 우회, `orchestrator({ agent:'architect', jobType:'code', ... })` 직접 호출
- ✅ **실행 추적**: `src/utils/verificationTrace.ts` + 6개 노드(plan/execute/tool/enforce/learn/checkTaskStatus) 진입 시 JSON-line append. `ANT_VERIFICATION_TRACE_FILE` 미설정 시 no-op
- ✅ **LLM mock response dir**: `MockLLMClient`가 `ANT_LLM_MOCK_RESPONSE_DIR/<nodeType>-<callIdx>.md` / `<nodeType>.md`를 우선 반환 (fallback: 기존 하드코딩 응답)
- ✅ **러너 라이브러리**: `tests/verification/scenarios/runner.ts` + `diff.ts`
  - fixture 복사, session envelope 래핑, env 주입, tsx child 실행, trace 파싱, `ScenarioExpectedOutcome` 비교
  - `ANT_REDIS_URL` 차단, `ANT_TASK_CONCURRENCY=1` 강제 (병렬 worker graph는 본 하네스 스코프 밖)
- ✅ **CLI 엔트리**: `pnpm scenario --list | Sxx | --all [--keep=fail|all|none] [--max-runs=N] [--real-llm] [-v]`
- ✅ **스모크 fixture `S00-runner-smoke`**: stub 모드, 인프라가 끝까지 동작함을 증명. trace에 plan/execute/checkTaskStatus/enforce 진입이 기록되는 것을 확인하는 최소 시나리오
- ✅ **러너 유닛 테스트** (`tests/verification/scenarios/runner.test.ts`) — discovery + scenario.json 검증 + ID 해석 8건

### 8.3 도입 완료 (본 PR `verification_scenario_fixtures_ac22c499`)

**디렉터리 재조직**:
- L1/L2를 한 부모 아래로 통합: `tests/verification/{unit,scenarios}/`

**B1~B4 인프라 블로커 해소**:
1. **B1 — resume 시 `retries` 리셋 escape hatch**: `runCodeGraph` line 53 + `plan/index.ts` line ~517이
   `ANT_SCENARIO_PRESERVE_RETRIES='1'`일 때만 세션 `retries` 값을 그대로 사용. 러너가 해당 env를 주입하므로
   S09/S08 등의 축적된 retries 시나리오가 재현됨. 프로덕션 경로(env 미설정)는 무영향.
2. **B1 확장 — 축 E/F 상태 복원**: `runCodeGraph` resume 경로가 `ANT_SCENARIO_PRESERVE_RETRIES='1'`일 때
   `_verificationTracker` / `_verificationBudget` / `_lastPlanHash` / `_appliedPlanHistory`를 세션에서 복원.
   fixture가 Axis E/F 상태를 직접 박제할 수 있게 됨.
3. **B2 — child exit 정책**: `ScenarioConfig.expectedChildExitCode: 0 | 'nonzero' | 'any'`.
   runner가 실제 exit code와 대조해 "의도한 throw" vs "우연한 크래시" 구분.
4. **B3 — execute mock 골든 응답**: `tests/verification/scenarios/fixtures/golden/execute-verification-done.md`
   (`<done>` 뿐, `<file>` 태그 없음 → `_executeModifiedFiles=false` 고정 → 라우팅 결정성 확보). 각 시나리오는 이 파일을
   `llm-mock/execute.md`로 복사.
5. **B4 — `appendTrace extra` 로깅**: `plan` 노드의 `_batchSplitRequeued` 분기와 `checkTaskStatus`의 violations push,
   `checkTaskStatus`의 Final Verification auto-add 시점에 `extra.flagSet` / `extra.violations`를 추가 기록.
   diff 엔진이 휘발성 플래그도 평가 가능.

**시나리오 fixture 9종**:

| ID | Mode | 트리거 | 주 assertion |
|---|---|---|---|
| S01 | stub | tracker 불완전 | route plan→execute→check→enforce→plan, violation: verification_incomplete |
| S02 | overlay | 2파일 tsc stderr + env `ANT_VERIFICATION_SPLIT_FILES=2` | flagSet `_batchSplitRequeued` |
| S03 | stub | typecheck+test 둘 다 미통과 | route 동일, violation `verification_incomplete` |
| S04 | overlay | plan hash 반복 (plan1 설정 → plan2 매치) | flagSet `_batchSplitRequeued` (forceByRepeat) |
| S05 | stub | `_verificationBudget=0` + plan.md modify×2 | flagSet `_batchSplitRequeued` (budgetExhausted) |
| S06 | stub | tracker 초기부터 complete | route plan→execute→check→learn |
| S07 | stub | error 태스크 prePlanText 1개 | flagSet `finalVerificationAutoAdded` |
| S08 | stub | tracker=null + 골든 done | violation `verification_incomplete` + enforce→plan |
| S09 | stub | `retries=3, maxRetries=3` | route check→learn (C4 — routeAfterCheckTaskStatus가 learn 반환) |

**시나리오별 env 오버라이드**: `ScenarioConfig.env`로 `RECURSION_LIMIT` / `ANT_VERIFICATION_BUDGET` /
`ANT_VERIFICATION_SPLIT_ERRORS` / `ANT_VERIFICATION_SPLIT_FILES`를 선별 주입 (allow-list 방식).

**공용 골든 응답 디렉터리**: `tests/verification/scenarios/fixtures/golden/execute-verification-done.md`.

### 8.4 알려진 compromise

- **S01/S03은 real 모드 대신 stub**: `feature/` + 실제 tsc/vitest로 재현하려면 scenario당 node_modules 설치가 필요해
  fixture 크기/속도가 비현실적. 대신 세션 seed에 `_verificationTracker`를 원하는 상태로 박제해 동일한 분기(C10/C11)를 적중.
- **`S05.taskQueueAfterSplit` assertion 보류**: 배치 분할 후 그래프가 계속 돌면서 queue를 소진해 최종 세션에는 빈 queue만 남음.
  trace의 `extra.batchCount`/`splitCount`로 간접 검증하지만 세션 기반 assertion은 미구현. 필요 시 러너에 "split 발생 즉시 중단" 훅 추가 가능.
- **병렬 워커 그래프(`workerGraph.ts`)에는 여전히 trace 훅이 없음** — `ANT_TASK_CONCURRENCY=1`을 러너가 강제해 우회.

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| seed 세션 파일이 resume 직후 사라짐 | `saveCheckpoint`가 덮어씀 | 러너가 세션을 seed → spawn 사이에서 watch하거나 `deps.session`을 mock |
| inject rule이 안 먹음 | `ANT_COMMAND_OVERLAY_MODE` 미설정 | 두 env var 모두 설정해야 활성 (gating 정책) |
| `processDiagnosticBatchSplit` 테스트에서 force split이 안 됨 | `modify.length === 1` | split 대상이 2개 이상이어야 `batches.length > 1` 조건을 통과 |
| LLM mock 응답 포맷 안 맞음 | execute 프롬프트 태그(`<file>`, `<done>`) 누락 | 실제 mock 서버 응답을 1회 캡처해 fixture에 저장 |
| Redis 연결 없이 러너 실행 안 됨 | `.cursorrules`: Redis 항상 필요 | `pnpm dev:infra`로 Redis 올리거나, L1 유닛만 돌릴 것 |

## 10. 스코프 경계

| 영역 | 다루는가 | 어디서? |
|---|---|---|
| verification 태스크 내부 루프 분기 회귀 | ✅ | 본 문서 (L1 + L2) |
| 실제 LLM 판단 품질 | ❌ | L3 또는 별도 eval dataset |
| 프롬프트 템플릿 스냅샷 | ❌ | `prompt-test-spec.md` |
| 전체 HTTP→큐→워커 스모크 | ❌ | `e2e-runbook.md` |
| decompose가 verification을 생성하는 경로 (F11) | ❌ | L4 E2E에 위임 |
| 병렬 task 실행 시 상태 경합 | ❌ | 별도 플랜 |
| 클라우드 mode 권한/경로 | ❌ | 스테이징 환경 검증 |
