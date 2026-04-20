# Ant Session Redesign — 실행 인계 문서 (SSOT)

> **이 문서의 역할**: Ant 세션 재설계 플랜의 **실행 SSOT**. 새 탭/세션에서 이 문서만 읽고 작업을 이어갈 수 있도록 **자기완결적**으로 작성됨.
>
> 원 플랜(상세 스펙, 1765 LoC): [`/Users/probe/.cursor/plans/ant_5-tier_execution_model_cc518235.plan.md`](/Users/probe/.cursor/plans/ant_5-tier_execution_model_cc518235.plan.md)
>
> **이 문서는 진행 상태 기록 + 핵심 설계만 압축**. 상세 스펙은 원 플랜 참조.

---

## 0. 한눈에 보는 현황

| 항목 | 값 |
|---|---|
| 전체 todos | 19개 (§16.2 follow-up 신규) |
| 완료 | **15개** |
| 진행 중 | 0 |
| 남음 | **4개** (§16.2 · §17 · §18 · §19) |
| Phase B | ✅ **종료** (Mode × Complexity MVP 동작) |
| Phase C | ✅ **종료** (3/3 완료 — resolve_integrate ✅ · breadcrumb_tiered_policy ✅ · compaction_policy ✅) |
| Phase D | 🔄 진행 중 (2/5 완료 — legacy_cleanup ✅ · ui_render_migration ✅) |
| 베이스 커밋 | `8277b313 feat: code verification hardening, tech-tier hints, preview/deploy` |
| 내 수정 파일 타입 에러 | 0 |
| 기존 브랜치 선행 에러 (내 작업과 무관) | 27개 |

## 1. 새 탭에서 이어 진행하는 법

### 1.1 복붙용 프롬프트 (새 탭에 첫 메시지로 그대로 붙여 넣기)

```
1. docs/tmp/session-redesign-handoff.md 읽기 (이 문서)
2. §4에서 다음 실행할 todo의 id 확인 (§4는 실행 순서대로 정렬됨)
3. §5에서 해당 id의 "실행 카드"를 그대로 읽고 순서대로 수행
   - 선행 의존 체크 → Landmark 파일 읽기 → 단계 순서대로 구현 → AC 체크
4. 검증 (§5 카드의 "검증" 명령 실행)
5. §3에 완료 기록 이동 + 변경 파일 목록 추가
6. §0 현황 숫자 업데이트 (완료 +1, 남음 −1)
7. §4에서 완료한 todo를 [x] 처리 + 다음 todo가 Phase 이동이면 § 경계 갱신
8. 필요 시 코드+문서 함께 커밋 (§9 관례)
```

### 1.2 카드 하나 = 한 세션 원칙

- 각 §5 카드는 **선행 의존이 모두 완료된 상태**를 전제로 단독 실행 가능
- 카드 내 "Landmark 파일"만 읽으면 해당 todo의 컨텍스트가 닫힘
- AC 체크박스가 전부 ✅이면 완료로 판정. 하나라도 ❌이면 같은 세션 내에서 마무리
- Phase 경계(B→C 등)에서 새 탭을 시작하는 것을 권장 (컨텍스트 윈도우 여유)

### 1.3 SSOT 규칙

- 이 문서와 원 플랜(`.cursor/plans/ant_5-tier_execution_model_cc518235.plan.md`)이 충돌하면 **이 문서가 SSOT**
- 원 플랜은 설계 근거·스펙, 이 문서는 실행 상태·절차
- 카드 작성 원칙이 흔들린다면 §2(아키텍처)·§7(설계 결정)으로 돌아가 재확인

---

## 2. 아키텍처 압축 요약 (세 직교 축)

| 축 | 요소 | 판정자 |
|---|---|---|
| **맥락 (Context)** | T1 Artifact / T2 user_turn / T3 Breadcrumb | 구조적 |
| **Mode** | generate / refactor / explain | **Detect 노드** (기존, `resolvedAction.mode`) |
| **Complexity** | oneshot / exploratory / todo | **Decompose 노드** (신규 확장) |

### 5-Tier 매핑 (Mode × Complexity 셀)

| Tier | Mode | Complexity | 경로 |
|---|---|---|---|
| 0 Reflex | explain | oneshot + tool 0~1 | direct (read-only) |
| 1 One-shot | 모두 | oneshot | direct |
| 2 Exploratory | 모두 | exploratory | direct (ReAct) |
| 3 Todo | generate/refactor | todo | decompose → plan → execute |
| 4 Plan | — (별도 jobtype) | — | design/plan job |

### 파일 구조

```
{featurePath}/sessions/
  feature.jsonl      ← NEW: 맥락 SSOT (T2 user_turn + T3 breadcrumb + boundary)
  trace.jsonl        ← NEW: UI 채팅 표시 SSOT
  architect/
    code.json        (기존 — 재개 체크포인트 전용, jobConversation 필드 제거 완료 §14)
    design.json
    learn.json
  planner/plan.json
  # chat.json         (agent 쪽은 §14에서 제거 완료, ChatService HTTP 레이어 잔존 → §16에서 UI 마이그레이션과 함께 제거)
```

### 메타데이터 정책 (§4.4 매트릭스 SSOT)

| Mode | Complexity | T2 | T3 (BC) | Boundary |
|---|---|---|---|---|
| explain | 모두 | 기록 | ❌ (T1 무수정) | todo만 ✅ |
| generate/refactor | oneshot | 기록 | ❌ | ❌ |
| generate/refactor | exploratory | 기록 | touched≥3면 mini-BC | ❌ |
| generate/refactor | todo | collapse | ✅ bubble-up | ✅ |
| ask/inline-ask | — | **미기록** (feature.jsonl 안 감) | ❌ | ❌ |

---

## 3. 완료된 Todos (15개)

### ✅ 1) `feature_jsonl_schema` + `trace_jsonl_schema`

**신규 파일**:
- `packages/ant-shared/src/session-log.ts` — 라인 타입 전체 + 상수 (`Complexity`, `SpecClarify`, `BREADCRUMB_THRESHOLDS` 등)

**수정 파일**:
- `packages/ant-shared/src/index.ts` — `export * from './session-log'` 추가
- `packages/ant-cli/src/core/utils/sessionPaths.ts` — `getFeatureJsonlPath()`, `getTraceJsonlPath()` 추가. `getChatSessionPath()`는 `@deprecated` 마킹

**주요 타입** (shared/session-log.ts):
- `FeatureUserTurnLine`, `FeatureUserTurnMetaLine`, `FeatureBreadcrumbLine`, `FeatureBoundaryLine` (`FeatureLine` union)
- `TraceUserTurnLine`, `TraceThinkingLine`, `TraceToolCallLine`, `TraceFileWriteLine`, `TraceRunCommandLine`, `TraceJobStatusLine`, `TraceAssistantMessageLine` (`TraceLine` union)
- `SpecClarify` (Decompose가 output할 design redirect choice)
- 상수: `FEATURE_CONTEXT_THRESHOLD`, `FEATURE_CONTEXT_WINDOW`, `BREADCRUMB_THRESHOLDS`, `BREADCRUMB_LIMITS`, `DIRECT_LOOP_LIMITS`, `PROMOTION_TOUCHED_THRESHOLD`

**AC 달성**:
- [x] 3종 feature + 7종 trace 타입 정의
- [x] 각 라인 `type`, `ts`, `jobId`, `turnId`, `jobType` 필수 필드 포함
- [x] trace user_turn 사본 `sourceRef` 포함 ('feature.jsonl#<turnId>' 또는 'ask-only')
- [x] 타입 에러 0

---

### ✅ 2) `atomic_user_turn_write` + 관련 어댑터 확장

**수정 파일**:
- `packages/ant-cli/src/core/ports/session.ts` — `SessionPort` 인터페이스에 9개 메서드 추가
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` — 400 LoC 구현 추가

**신규 파일**:
- `packages/ant-cli/src/composition/recordUserTurn.ts` — orchestrator 헬퍼

**추가된 FileSessionAdapter 메서드** (모두 per-file mutex로 동시성 안전):
- `appendLine(file, line)` — JSONL generic append
- `appendUserTurn(line, options: { skipFeature? })` — 2파일 원자 쓰기
- `appendUserTurnMeta(line)` — complexity 패치 라인 추가
- `appendBreadcrumb(line)` / `appendBoundary(line)` — boundary 시 prior user_turn 자동 collapse
- `loadSinceBoundary()` — T2(boundary 이후) + T3(전체) 반환
- `loadTraceByTurnIds(turnIds)` / `loadTraceByJobType(jobTypes)` — UI 필터
- `collapseTurn(turnId)` — 특정 turn 무효화
- `collapseAll(reason, jobId, turnId)` — Hard Reset용

**recordUserTurn 헬퍼** (§4.5 SSOT):
- 시그니처: `{ featurePath, jobType, jobId, directive, mode?, isResume?, turnId?, session?, ... }` → Promise<string>
- `skipFeature` 자동 결정: `jobType ∈ {'ask', 'inline-ask'}`이면 true
- `isResume === true`면 no-op (중복 방지)
- `turnId` 자동 생성: `t-<8 hex>`

**AC 달성**:
- [x] 2파일 동기 append
- [x] ask 경로 skipFeature 자동 처리
- [x] collapseTurn 양쪽 파일 동기화
- [x] per-file FileMutex로 동시성 안전
- [x] 타입 에러 0

**⚠️ 검증 미완**: 단위 테스트 없음. Phase B 마무리 전에 `packages/ant-cli/tests/session-log.test.ts` 작성 권장 (append·load 왕복, boundary 필터, collapseAll).

---

### ✅ 3) `ask_jobtype_isolation` (orchestrator 통합)

**수정 파일**:
- `packages/ant-cli/src/composition/orchestrator.ts` — 4곳에 `recordUserTurn` 호출 삽입:
  1. inline-ask 경로 (jobType='inline-ask', skipFeature 자동=true)
  2. design 경로 (jobType='design', session 재사용)
  3. code 경로 (jobType='code', mode 전달, session 재사용)
  4. planner 경로 (jobType='plan', isResume 판단)

**미완료 (후속 처리)**:
- `runAskGraph`(triage 내부에서 호출되는 것)의 기록은 이미 code/design 흐름에서 orchestrator가 기록하므로 별도 작업 없음. 단, triage가 `intent=ask`로 판정 시 trace에 'ask-only' 사본 append를 원한다면 추가 작업 필요 — **본 플랜 MVP 범위 외**로 간주.

**AC 달성**:
- [x] inline-ask는 feature.jsonl 미기록 (skipFeature=true)
- [x] code/design/plan은 2파일 기록
- [x] trace user_turn 사본에 `jobType` 필드 포함
- [x] isResume=true 지원 (중복 방지)

---

### ✅ 4) `triage_scope_cleanup` (Triage 프롬프트 정리)

**수정 파일**:
- `packages/ant-cli/src/core/prompt/templates/jobs/shared/nodes/triage/variants/default/rules.md` — Step 6 "Scope Routing" 전체 삭제 (6.1 Modification Intent + 6.2 Scope Breadth), Step 번호 재정렬 (7→6, 8→7)
- `packages/ant-cli/tests/__snapshots__/triage-prompt.test.ts.snap` — 자동 업데이트

**삭제된 내용**:
- Step 6.1 "Modification Intent Check" — Detect 노드의 mode 판정과 중복된 dead logic
- Step 6.2 "Scope Breadth + Spec Check" — Decompose로 이관 (specClarify 메커니즘)
- 관련 Note "Scope breadth ... NOT decided here" — FPOP 안티패턴 (부정형 지시)

**결과**: Triage는 이제 intent(ask/work) + agent/job routing만 담당. 범위 책임 축소.

**AC 달성**:
- [x] rules.md에 "Scope breadth", "Multi-boundary" 표현 0
- [x] Step 번호 연속 (3→4→5→6→7)
- [x] triage-prompt.test.ts 스냅샷 갱신 통과
- [x] triage-parser.test.ts 30 tests 전부 통과 (파서는 design redirect를 여전히 방어적으로 처리)

---

### ✅ 5) `decompose_complexity` (Decompose 3-way 분류)

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `complexity`, `directHints`, `directMode`, `featureContext`, `specClarify`, `_promotedThisJob`, `_specClarifyBypassed`, `needsEscalation` 필드 추가 + `Complexity` / `SpecClarify` / `Feature*Line` import 확장
- `packages/ant-cli/src/agents/architect/graph/code/graph.ts` — `CodeGraphChannels`에 대응 채널 추가 (`_promotedThisJob`, `_specClarifyBypassed`는 boolean default 리듀서)
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/responseParser.ts` — `ParsedDecomposeResponse`에 `complexity` / `complexityReason` / `directHints` / `specClarify` 추가, `normalizeComplexity()` safe default='todo', `<complexity>` `<complexityReason>` `<directHints>` `<specClarify>` 태그 파싱
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts` — ① 라인 79 explain early-return 블록 삭제 (모든 mode/complexity를 LLM이 판정) ② 파싱 결과에서 `complexity`/`directHints`/`specClarify` 분해 ③ `specClarify` 발동 시 `awaitingDecomposeClarify=true`로 `__end__` 반환 (triggering logic은 다음 todo에서) ④ 정상 경로에서 `updatedState`에 `complexity`/`directHints`/`directMode` 주입
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md` — `## Complexity Classification` 섹션 신설 (FPOP 원칙 3-way + 모드별 의미 + 6행 output shape 매트릭스), Output Sequence 맨 앞에 `<complexity>` `<complexityReason>` `<directHints>` 추가, 후속 태그 번호 재정렬, Task Schema `type` 필드에 `"explain"` 추가, "analyze step by step" 블록을 classification-first 흐름으로 재작성

**출력 매트릭스** (프롬프트 SSOT):

| Mode | Complexity | `<tasks>` | `<directHints>` |
|---|---|---|---|
| explain | oneshot | `[]` | `{ "explorationScope": "..." }` |
| explain | exploratory | `[]` | `{ "explorationScope": "..." }` |
| explain | todo | 1 explain task (priority 200) | `{}` |
| generate/refactor | oneshot | `[]` | `{ "targetFiles": [...] }` |
| generate/refactor | exploratory | `[]` | `{ "explorationScope": "..." }` |
| generate/refactor | todo | 전체 breakdown | `{}` |

**설계 결정**:
- `specClarify` 파싱 인프라는 지금 추가하되, **발동 조건 로직(4 AND)은 다음 todo(`decompose_spec_clarify`)에서**. 현 단계 프롬프트는 specClarify 관련 지시 없음 → LLM은 해당 태그를 emit하지 않음
- `directMode`는 `complexity`로부터 decompose가 즉시 파생 (`complexity === 'oneshot'|'exploratory'` → 동일 값, `'todo'` → undefined)
- `totalSubtasks: tasks.length + 1` 유지 — oneshot/exploratory (tasks.length=0)에서도 기존 카운팅 호환
- `updateArtifacts` 세션 저장 블록의 `state: {...} as any` 캐스트 — session-redesign 필드(`awaitingDecomposeClarify` 등)가 `SessionState`에 미반영 상태. `legacy_cleanup` 통합 시 제거 예정

**AC 달성**:
- [x] 5개 matrix 케이스가 decompose 출력으로 구분 가능 (6행 매트릭스 — generate/refactor oneshot vs exploratory 분리 포함)
- [x] 파서 실패 시 safe default = `complexity: 'todo'` (`normalizeComplexity()` + 태그 부재 경고)
- [x] 프롬프트에 FPOP 위반 없음 (관찰 타겟 + 원칙 + 제약 + blind spot, 구체 예시·edge case 열거·플랫폼 한정어 없음)
- [x] 내 수정 파일 타입 에러 0 (총 27개로 baseline 유지)
- [x] triage-prompt.test.ts 3/3 + triage-parser.test.ts 30/30 재실행 통과 (regression 없음)

**⚠️ 검증 미완**: 새 스키마 파서의 단위 테스트 없음. Phase B 마무리 전 `packages/ant-cli/tests/decompose-responseParser.test.ts` 작성 권장 (complexity parse matrix + directHints JSON + specClarify JSON validation + safe-default).

**후속 의존성**:
- `route_after_decompose_3way`: `state.complexity`, `state.specClarify`를 읽어 4-way 분기
- `direct_node`: `state.directMode`, `state.directHints`를 ReAct 루프 튜닝에 사용
- `decompose_spec_clarify`: 발동 조건 4 AND + 프롬프트 섹션 추가 → LLM이 `<specClarify>` 태그 emit

---

### ✅ 7) `decompose_spec_clarify` (Decompose가 `<specClarify>` emit + 재진입 처리)

**수정 파일**:
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md` — ① "## Spec Clarify (source adequacy for `todo` decomposition)" 섹션 신설 (Complexity Classification 직후). 발동 4 AND 조건을 관찰 타겟 표로 기술 + `<specClarify>` 출력 shape 필드 리스트 + `{{#if specClarifyBypassed}}` 섹션으로 재진입 억제 ② 기존 Complexity matrix 제약에 "Spec Clarify 규칙이 `generate/refactor + todo` row를 덮어쓴다" 주석 추가 ③ step-by-step reasoning hint에 Spec Clarify 체크 경로 추가 ④ Output Sequence 0.3에 `<specClarify>` CONDITIONAL 태그 추가
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts` — `enrichedVars`에 `specClarifyBypassed: state._specClarifyBypassed === true` 주입. `updatedState` 반환 시 `awaitingDecomposeClarify: false`로 명시 초기화 (bypass 재진입 후 정상 경로에서 flag 잔류 방지)
- `packages/ant-cli/src/agents/architect/graph/code/routing.ts` — `routeAfterResolve`의 clarify resume 분기를 `(overrideDirective || _specClarifyBypassed)` 둘 중 하나로 확장하여 `proceed_without_spec` 재진입 경로를 허용
- `packages/ant-cli/src/agents/architect/graph/code/runner.ts` — 조기 interrupted 재개 경로(`ANT_IS_RESUME`)에서 `awaitingDecomposeClarify` / `_specClarifyBypassed` / `specClarify` 를 session.state로부터 복원 (SessionState 확장 전이므로 `as any` 캐스트)
- `packages/ant-cli/src/periphery/adapters/http/routes/job.routes.ts` — `POST /projects/:id/features/:feature/chat/decompose-choice` 신규 라우트. body `{ jobId, choice: 'redirect_to_design' | 'proceed_without_spec' | 'cancel' }` 처리:
  - `redirect_to_design`: paused code job → failed, 같은 directive로 design job enqueue
  - `proceed_without_spec`: session.state에 `_specClarifyBypassed=true` 기록 + `specClarify` 제거 → `executeJob({ isResume: true })` 재개 (idempotency lock 해제 포함)
  - `cancel`: `markUserStopped` + job status → failed + `cleanupJobState`

**설계 결정**:
- 파싱/채널/short-circuit은 §3.6에서 이미 구현됨 — §3.7은 순수하게 (a) 프롬프트 발동 조건, (b) 재진입 해금, (c) 사용자 선택 응답만 추가
- bypass는 session 파일에 영속. Redis PendingChoice 인프라를 재사용하지 않음 (cross-pod 일관성은 session 파일이 공유 storage에 있으므로 자연스럽게 해결)
- `ChoiceService.handleChoice`는 TriageResult 스키마에 강결합이라 재사용하지 않고 독립 라우트로 구현

**AC 달성**:
- [x] `rules.md`에 FPOP 준수 "Spec Clarify" 섹션 (관찰 타겟 표 + 원칙 + 4-AND 제약 + blind spot; 구체 예시/값 매핑 없음)
- [x] 4-AND 중 하나라도 거짓이면 LLM이 `<specClarify>`를 emit하지 않도록 프롬프트 제약 (`OMIT entirely`)
- [x] `_specClarifyBypassed === true` 재진입에서는 `{{#if specClarifyBypassed}}` 블록이 "Do NOT emit" 지시
- [x] orchestrator가 3개 choice 모두 처리 (redirect / proceed / cancel)
- [x] 내 수정 파일 타입 에러 0 (총 27개 baseline 유지)
- [x] triage-parser 30/30 + triage-prompt 3/3 + plan-entry-dispatcher 3/3 regression 통과

**⚠️ 검증 미완**: decompose-choice 라우트 단위 테스트 없음. `ui_render_migration`(todo 16) 진행 시 UI가 `<specClarify>`의 `displayMessage` + 3개 choice 버튼을 렌더해 이 라우트를 호출하도록 연결해야 함.

**후속 의존성**:
- `route_after_decompose_3way`(todo 9): `state.specClarify`를 읽어 `__end__` 분기 — 본 todo에서 state 채널에 specClarify가 기록되므로 9의 routing 조건은 이미 충족됨

---

### ✅ 8) `direct_node` (ReAct 루프 노드 신설)

**신규 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/index.ts` — 단일-진입 ReAct 루프. mode별 tool set(`explain → codeExplain`, `generate/refactor → codeBasic`), directMode별 루프 상한(`oneshot=2`, `exploratory=ANT_DIRECT_MAX_STEPS || 10`). `currentTask` 없이 동작하며, LangGraph 재진입은 발생하지 않고 한 번의 invoke 내에서 `for` 루프가 tool 실행까지 inline 처리. 종료 시 `saveCheckpoint` 호출 + `conversations[NODE_DIRECT]` 갱신. `needsEscalation=true`가 감지되면 partial state에 flag만 세팅해 반환 (routing은 9에서 처리)
- `packages/ant-cli/src/agents/architect/graph/code/nodes/shared/invokeLLMWithTools.ts` — `llm.stream()` 래퍼. thinking/text/tool_calls/tokenUsage를 turn 단위 객체로 집계. `retry` 이벤트 시 상태 리셋. execute는 자체 streaming(파일 태그 처리) 유지 — 본 유틸은 direct 전용
- `packages/ant-cli/src/agents/architect/graph/code/nodes/shared/runToolCallsAndCollect.ts` — `ToolOrchestrator.executeBatch()` facade. registry + resultManager + ctx를 받아 BatchExecutionResult 반환
- `packages/ant-cli/src/agents/architect/graph/code/nodes/shared/parseReActResponse.ts` — `<done>true</done>` / `<needsEscalation>true</needsEscalation>` 태그 정규식 파싱 + cleanedText 반환
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/base.md` — WHAT. `directive` + `directHints.targetFiles|explorationScope` + `featureContext.breadcrumbs|userTurns` (후자는 `resolve_integrate` 구현 전까지 비어 있음)
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/rules.md` — HOW. FPOP 원칙으로 ① 3종 termination signal 매트릭스 ② mode 분기 (`{{#if isExplainMode}}` 1회) ③ loop budget 선언 ④ escalation triggers 표(관찰 가능한 blind spot 3개) ⑤ observation principle ⑥ output discipline

**수정 파일**:
- `packages/ant-cli/src/agents/common/graph/conversations.ts` — `CONV_KEYS.NODE_DIRECT = 'node:direct'` 추가. 별도 레벨 구분이 아닌 `node:` 레벨로 편입. JSDoc에 "retention: discarded at direct exit" 명기 (`applyRetention(jobType='code')`가 항상 discard이므로 추가 정책 불필요)

**설계 결정**:
- direct 노드는 **LangGraph 조건부 엣지 재진입 없이** inline 루프로 tool 실행까지 처리 — tool 노드는 `currentTask` 전제(`state.currentTask.id`)가 강해서 재사용 대비 복잡도가 크고, direct는 task 없음
- `state.recursionCount`는 루프 진입 시 +1, tool 실행 후 +1 (노드 재진입에 준하는 계정 유지)
- `ANT_DIRECT_MAX_STEPS` 환경변수 누락 시 기본 10
- `enableThinking`은 첫 step에만 true (후속 step은 tool_result 이후라 thinking-only 반응 방지 — execute와 동일 패턴)
- `applyRetention`은 호출하지 않음: direct 루프 종료 시 NODE_DIRECT 엔트리는 남겨두고, 다음 direct 진입 시 기존 history를 이어서 사용 (resume 시나리오 대비). 별 job 진입에서는 `saveCheckpoint`가 `conversations`를 전체 보존 → 정상

**⚠️ 미완료 (후속 todo에서 배선)**:
- `graph.ts`에 `direct` 노드 등록 및 `routeAfterDecompose` 4-way 확장은 **todo 9 (`route_after_decompose_3way`)** 에서 처리
- `needsEscalation` → decompose 재진입 + `_promotedThisJob=true` 세팅은 **todo 10 (`runtime_escalate`)** 에서 처리 (본 todo는 LLM이 signal을 emit했을 때 state flag만 반환)

**AC 달성**:
- [x] `nodes/direct/index.ts`가 export되고 import 가능
- [x] `nodes/shared/` 유틸 3개가 direct 내부에서만 사용됨 (execute 미변경)
- [x] mode=explain → read-only tool set (`TOOL_SETS.codeExplain`), refactor/generate → full set (`TOOL_SETS.codeBasic`)
- [x] `directMode='oneshot'` → 2-step, `'exploratory'` → `ANT_DIRECT_MAX_STEPS ?? 10` step 상한
- [x] `CONV_KEYS.NODE_DIRECT` 추가 + 기존 `applyRetention` 정책 호환 (code job = discard)
- [x] 프롬프트 FPOP 위반 없음 (관찰 타겟 표 + 원칙 + 제약, 구체 예시/값 매핑/플랫폼 한정어 없음)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest 51 suites / 1148 tests 전부 통과 (148 partials 정상 등록 — direct 2개 신규 포함)

**후속 의존성**:
- todo 9: `routeAfterDecompose`의 `direct` 분기 + `routeAfterDirect` 신설 + `graph.addNode("direct", direct)`
- todo 10: direct 내부에서 `shouldEscalate()` 유틸 호출 + `_promotedThisJob` 가드 1회 상한

---

### ✅ 9) `route_after_decompose_3way` (decompose 4-way 확장 + direct 배선)

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/routing.ts`:
  - `routeAfterDecompose` 4-way 확장: `(awaitingDecomposeClarify || specClarify)` → `__end__`, `complexity ∈ {oneshot, exploratory}` → `direct`, 그 외(todo 또는 undefined) → 기존 `parallelOrchestrator` / `plan` 경로 유지
  - `routeAfterDirect` 신설: `needsEscalation && !_promotedThisJob` → `decompose`, 그 외(이미 승격했거나 signal 없음) → `learn`. 이미 `_promotedThisJob=true`인데 `needsEscalation`이 다시 올라온 경우에도 `learn`으로 안전하게 빠지고 경고 로그만 남김
- `packages/ant-cli/src/agents/architect/graph/code/graph.ts`:
  - `direct` 노드 import + `graph.addNode("direct", direct as any)` 등록 (decompose 바로 다음 위치)
  - decompose 조건부 엣지 매핑 확장: `{ __end__, parallelOrchestrator, plan }` → `{ __end__, direct, parallelOrchestrator, plan }`
  - 신규 `graph.addConditionalEdges("direct", routing.routeAfterDirect, { decompose, learn })` 배선

**설계 결정**:
- `specClarify` 발동은 §3.7에서 state 채널에 기록 + `awaitingDecomposeClarify=true`까지 같이 세팅되는 기존 경로 + 이번 라우터의 OR 가드까지 **2중 방어**. 둘 중 한쪽만 세팅된 엣지 케이스에서도 안전
- `complexity === undefined` 케이스는 `todo` (decompose 파서의 safe default)와 동일 분기 — §3.5 설계 일관성 유지
- `routeAfterDirect`는 **1회 상한 판정만** 담당. `_promotedThisJob`의 true 세팅은 §10(runtime_escalate)에서 direct 내부가 처리. 본 카드는 consumer만 완성
- `direct`의 `needsEscalation` partial은 이미 §3.8 direct 노드에서 `needsEscalation || undefined` 형태로 반환 — 라우터는 truthy 체크로 호환

**AC 달성**:
- [x] 기존 `awaitingDecomposeClarify` + 신규 `specClarify` 양쪽 다 `__end__` 분기 (OR guard)
- [x] `complexity === 'oneshot' | 'exploratory'` → `direct` 엣지 선택
- [x] `complexity === 'todo' | undefined` → 기존 `plan` / `parallelOrchestrator` 경로 유지 (regression 없음)
- [x] `routeAfterDirect`가 `_promotedThisJob` 가드로 1-shot 상한 (true면 `learn`으로 수렴)
- [x] graph에 `direct` 노드가 addNode + conditional edges 양쪽에 모두 등록
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest 51 suites / 1148 tests 전원 통과 (plan-entry-dispatcher 3/3, triage-* 포함)

**후속 의존성**:
- todo 10 (`runtime_escalate`): `shouldEscalate()` 유틸 + direct 내부에서 touched 임계치/LLM signal 판정 + `_promotedThisJob=true` 설정. 본 카드의 `routeAfterDirect`가 그 값을 읽어 decompose 재진입

---

### ✅ 10) `runtime_escalate` (direct 승격 트리거 + 1-shot 상한)

**신규 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/shouldEscalate.ts` — 입력 `(state, touched: Iterable<string>, opts?)` / 출력 `boolean`. 조건: `touched.size > PROMOTION_TOUCHED_THRESHOLD` (shared 상수, 기본 3). `Iterable<string>` 시그니처로 `Set`·`Array` 모두 수용. 상한 override용 `touchedThreshold` 옵션 제공

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/index.ts`:
  - `WRITE_TOOL_NAMES`(`edit_file`/`create_file`/`delete_file`/`file`/`write_file`) 상수 추가 — 루프 내 `batch.events`의 touched 파일 경로 수집 대상
  - 루프 스코프 `touchedFiles: Set<string>` 신설. tool batch 실행 직후 `batch.events[].args.path` 중 write tool만 Set에 누적
  - tool branch 말미에 `!state._promotedThisJob && shouldEscalate(state, touchedFiles)` 게이트 → truthy 시 `needsEscalation=true`로 루프 탈출 + 로그
  - 최종 return에서 `promoteThisJob = needsEscalation && !state._promotedThisJob` 계산해 `{ _promotedThisJob: true }`를 conditional spread. LLM signal 경로(`parsed.needsEscalation`)도 동일 return을 통과하므로 touched/tag 양쪽 모두 같은 가드로 승격 플래그 세팅

**설계 결정**:
- touched 집계는 write 계열 tool에 한정 (read/list/search는 탐색 행위로 간주 — 파일 수정 없음)
- shadow alias(`file`, `write_file`)도 포함 — toolCatalog의 `SHADOW_ALIASES`와 일치시켜 LLM의 alias 호출도 정확히 카운트
- `shouldEscalate` 내부는 threshold 초과만 판정 (LLM `<needsEscalation>` 태그는 §3.8에서 이미 `parseReActResponse`가 처리 → direct 루프 상단의 별도 분기에서 바로 break). 두 트리거가 분리되어 있으므로 유틸은 단일 책임 유지
- `_promotedThisJob=true` 세팅은 **needsEscalation이 실제로 direct partial state에 실릴 때만** 수반 → 동일 partial 반환으로 atomic. `routeAfterDirect`가 두 값을 같은 state snapshot에서 함께 읽음
- 재진입 시 `_promotedThisJob=true`가 유지되므로 (1) 루프 내 touched 게이트는 gate 통과 실패 (2) LLM `<needsEscalation>` 태그가 또 emit돼도 `routeAfterDirect`가 `learn`으로 수렴 (§3.9 2차 방어). **3중 가드 (`_promotedThisJob` / LangGraph `recursionLimit` / `recursionCount` tracking)** 모두 확보

**AC 달성**:
- [x] direct → decompose 재진입이 job당 최대 1회 (`_promotedThisJob` 플래그가 두 번째 승격 차단)
- [x] 재진입 후 decompose는 파싱/분류 흐름 변경 없이 정상 동작 (complexity 재분류 → 기존 plan/parallelOrchestrator 경로)
- [x] `recursionLimit` 도달 시 `routeAfterDirect`가 `learn`으로 안전 복귀 (무한 루프 없음 — §3.9 라우터 2중 방어 포함)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest 51 suites / 1148 tests 전원 통과 (plan-entry-dispatcher 3/3, triage-* 포함 regression 없음)

**Phase B 종료**: §3.1~3.10 모두 완료 → Mode × Complexity MVP가 실제로 작동. Decompose 3-way 분류 + Direct ReAct 루프 + 4-way 라우팅 + 1-shot 런타임 승격까지 체인 전체가 코드로 연결됨. 이후 Phase C (`resolve_integrate` / `breadcrumb_tiered_policy` / `compaction_policy`)는 맥락 레이어 배선만 남음.

---

### ✅ 11) `resolve_integrate` (resolve가 feature.jsonl → featureContext 주입 + plan/direct 프롬프트 슬롯)

**신규 파일**:
- `packages/ant-cli/src/core/context/featureContextBuilder.ts` — `buildFeatureContext(session)` / `mergeFeatureContext(input)` / `MergedUserTurn` / `DEFAULT_BREADCRUMB_WINDOW=5`. turnId 기준 `user_turn ⨝ user_turn_meta` 병합 + breadcrumb 최신 N개 트리밍. `loadSinceBoundary` 실패 시 빈 컨텍스트로 graceful fallback

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` — `loadArtifacts`에 `buildFeatureContext(state.deps?.session)` 호출 추가, 반환값을 state.featureContext로 전달. 기존 `compressHeavyweightEntries` + `compactJob(jobConversation)` 블록은 **전체 주석 처리 + `TODO(legacy_cleanup)`** (실제 삭제는 §14). 미사용 import는 `void` 참조로 유지해 import 정리를 §14로 지연
- `packages/ant-cli/src/agents/architect/graph/design/nodes/resolve.ts` — 동일 패턴 복제. design 서브그래프 내부는 미수정 (D5 준수). featureContext state 채널에만 주입 — design 프롬프트 주입은 본 todo 범위 외
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `featureContext.userTurns` 타입을 `Array<FeatureUserTurnLine & Partial<FeatureUserTurnMetaLine>>`에서 `{ complexity?, decidedBy?, reason? }` 명시 patch 형태로 교체. 이유: `'user_turn' & 'user_turn_meta'` 교집합이 `never`로 붕괴하던 문제 해소
- `packages/ant-cli/src/agents/architect/graph/design/state.ts` — `featureContext` 필드 신설 (code와 동일 shape). 상단 import에 `FeatureUserTurnLine`/`FeatureUserTurnMetaLine`/`FeatureBreadcrumbLine` 추가
- `packages/ant-cli/src/agents/architect/graph/design/graph.ts` — `DesignGraphChannels`에 `featureContext: Annotation<any>` 추가
- `packages/ant-cli/src/agents/architect/graph/code/nodes/plan/planGeneration.ts` — `buildPlanPrompt` 내 `promptBuilder.render('jobs/code/nodes/plan/base', ...)` 호출에 `featureContext: state.featureContext` 변수 추가
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/base.md` — action-context partial 직전에 `{{#if featureContext}}` 블록 신설. FPOP 원칙 (Observation target + 2개 Constraint + Recent Breadcrumbs/Recent User Turns 서브섹션)
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/base.md` — 기존 featureContext 블록을 FPOP 스타일로 재작성 (관찰 타겟 + 2 Constraint). 또한 user_turn 필드 참조 버그 수정 (`{{this.directive}}` → `{{this.user}}`, shared `FeatureUserTurnLine.user` SSOT 일치)

**설계 결정**:
- 병합 로직을 `core/context/featureContextBuilder.ts`로 추출 — code/design 두 resolve 노드가 동일 helper를 호출. 상태 shape 변경 시 한 곳만 수정
- `userTurns`를 `FeatureUserTurnLine & Partial<FeatureUserTurnMetaLine>`로 선언하면 `type` discriminant가 `'user_turn' & 'user_turn_meta' = never`로 붕괴 → 개별 meta patch 필드(`complexity`/`decidedBy`/`reason`)만 optional 추가하는 형태로 확정
- breadcrumb window = 5 (카드 스펙). 이는 `FEATURE_CONTEXT_WINDOW=6` (Compact 유지 user_turn 개수)와 의도적으로 분리. Compact는 §13에서 처리
- legacy 블록(`compressHeavyweightEntries` + `compactJob`)은 **주석 처리 + `TODO(legacy_cleanup)` 마킹**. 실제 삭제·import 정리는 §14 일괄. 그 사이 유지보수 부담은 `void` 참조로 최소화
- design resolve는 `featureContext`를 state에만 주입하고 프롬프트 주입은 하지 않음 — D5 원칙(design 서브그래프 미수정) 준수. 후속 플랜에서 design UI/system-design 프롬프트가 필요로 하면 채널이 이미 준비된 상태

**AC 달성**:
- [x] `loadSinceBoundary`가 호출되고 반환값이 `featureContext.breadcrumbs` + `featureContext.userTurns`에 병합 (code·design 양쪽)
- [x] `userTurns[i]`에 동일 turnId의 `user_turn_meta`(complexity/decidedBy/reason)가 병합
- [x] plan base.md + direct base.md에 `featureContext` 렌더링 (handlebars 변수 누락 없음, FPOP 준수)
- [x] 기존 heavyweight 압축 블록 무력화 (주석 처리 + TODO, §14에서 실제 제거)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest 51 suites / 1148 tests 전원 통과

**⚠️ 검증 미완**: `featureContextBuilder` 단위 테스트 없음. §12~§13 진행 시 merge 로직(turnId join, breadcrumb window 트리밍, collapsed 필터)에 대한 테스트 추가 권장.

**후속 의존성**:
- §12 `breadcrumb_tiered_policy`: learn이 생성하는 breadcrumb를 resolve가 featureContext로 읽어 plan/direct에 주입 — 본 todo에서 파이프라인이 완성됨
- §13 `compaction_policy`: featureContext 생성 직후 토큰 측정 → `FEATURE_CONTEXT_THRESHOLD` 초과 시 compact 적용. featureContextBuilder의 결과에 추가 변환을 얹는 형태로 구현
- §14 `legacy_cleanup`: 본 todo에서 주석 처리만 한 `jobConversation` 관련 import/변수/블록을 실제 삭제

---

### ✅ 12) `breadcrumb_tiered_policy` (bubble-up BC + Boundary 매트릭스)

**신규 파일**:
- `packages/ant-cli/src/core/context/breadcrumb.ts` — `buildBreadcrumb()` (pure, 4-tier bubble-up: `≤SMALL(10)` files / `≤MEDIUM(50)` top-level paths / `≤LARGE(200)` specs+paths / `>LARGE` initial_creation) + `collectTouchedFilesFromTrace(session, turnId)` (trace.jsonl SSOT reader grouping `create|update|delete`). 상한 `BREADCRUMB_LIMITS` (`specs:3/paths:5/files:10`), scope 판정 (`mode==='refactor'` 우선 / `touched > LARGE` → initial_creation / 그 외 modification)
- `packages/ant-cli/src/agents/architect/graph/code/nodes/shared/emitFileWriteTrace.ts` — tool sideEffects(`fileCreated/fileModified/fileDeleted`) → trace.jsonl `file_write` fire-and-forget append helper. state.deps.session/jobId/turnId 셋 중 하나 누락 시 no-op
- `packages/ant-cli/tests/verification/unit/breadcrumb.test.ts` — 4-tier bubble-up, scope 경계값(just200 vs just201), limits, operation 분류, trace 필터링 (15 tests)

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `turnId?: string` 필드 추가 (JSDoc: orchestrator record → resolve 주입 → tool/direct/learn 소비)
- `packages/ant-cli/src/agents/architect/graph/design/state.ts` — 동일 `turnId?: string` 추가
- `packages/ant-cli/src/agents/architect/graph/code/graph.ts` + `.../design/graph.ts` — `turnId: Annotation<any>` 채널 추가
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` + `.../design/nodes/resolve.ts` — `featureContext.userTurns.find(t => t.jobId === state.jobId)` 로 현재 turn 복원 후 `state.turnId` 주입
- `packages/ant-cli/src/agents/architect/graph/code/nodes/tool/index.ts` — `afterExecution` 훅에서 `emitFileWriteTrace` 호출 (plan/execute phase 모두). sideEffects 내 파일 뮤테이션 이벤트가 trace.jsonl에 `file_write` 라인으로 영속
- `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/index.ts` — tool batch 루프에서 각 event별 `emitFileWriteTrace` 호출. touched Set 집계는 기존 (§10) 유지
- `packages/ant-cli/src/agents/architect/graph/design/nodes/tool/index.ts` — `afterExecution`에 동일 `emitFileWriteTrace` 호출 (jobType='design')
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts` — `applyBreadcrumbBoundaryMatrix(state)` 도입. §2.4 5-행 매트릭스 전부 code 분기로 명시 (`todo-full` / `exploratory-mini` / `explain-boundary` / noop). 노운형 summary 생성기 `buildBreadcrumbSummary` 인라인 구현 (LLM 미사용 — FPOP 제약은 함수 JSDoc에 영속). 기존 `updatedJobConversation` append 블록 주석 처리 + `TODO(legacy_cleanup)` + `void (null as unknown as ConversationEntry)` sentinel로 import 유지
- `packages/ant-cli/src/agents/architect/graph/design/nodes/learn/index.ts` — `applyDesignBreadcrumbBoundary(state)` 신규 (design은 complexity 없음 → 완료시 항상 BC+Boundary 기록, trace 비어있으면 `state.files` fallback)
- `packages/ant-cli/src/agents/architect/graph/design/nodes/learn/sessionWriter.ts` — design 쪽 `updatedJobConversation` append 블록 주석 처리 + `TODO(legacy_cleanup)`

**설계 결정**:
- turnId 전파: orchestrator가 record 시 생성한 turnId를 직접 state로 주입하지 않고, resolve 노드에서 feature.jsonl의 `loadSinceBoundary` 결과 중 `jobId === state.jobId` 인 user_turn을 찾아 복원. 장점: 재개(resume) 시 turnId가 session.state에 없어도 feature.jsonl에서 자연스럽게 회복 + 파이프라인 변경 최소
- trace.jsonl `file_write`가 touched SSOT (§2.4/§3.2 준수). tool/direct 양쪽 writer에서 동일 helper(`emitFileWriteTrace`) 사용 → 중복 로직 없음
- `emitFileWriteTrace`는 fire-and-forget (await 없이 `.catch(warn)`). tool 실행 경로에서 blocking I/O가 발생하지 않도록 보장
- code `applyBreadcrumbBoundaryMatrix`는 매트릭스 5 행을 `if/else if` 체인으로 한 줄씩 구분해 rowLabel 로그 — observable matrix가 프롬프트가 아닌 코드에도 존재 (FPOP 원칙을 코드 레벨에 복제)
- `FeatureBoundaryLine.reason: 'auto_job_complete_todo'` 고정 — Hard Reset(`user_reset`)은 §17에서 별도 경로로 분리 (collapseAll 재사용)
- design은 complexity 축이 없음 → D5(sub-graph 미수정) 준수를 위해 "design 완료 = todo-full" 로 단순화. 필요 시 후속 플랜에서 design도 Mode×Complexity 매트릭스 적용 가능 (해당 채널은 모두 준비됨)
- Breadcrumb summary 생성은 현재 LLM 미호출 (비용/복잡도 trade-off). FPOP 제약은 `buildBreadcrumbSummary` JSDoc에 인라인으로 명시 → 향후 LLM 도입 시 동일 제약을 템플릿화 (reverse-coverage matrix green 유지 위해 현 시점에 orphan 템플릿 생성 안 함)

**AC 달성**:
- [x] `core/context/breadcrumb.ts` 신규 — bubble-up 4단계 + 상한 + scope 판정 + trace collector
- [x] learn 노드가 §2.4 매트릭스 5 행을 코드 분기로 구분 (code: `applyBreadcrumbBoundaryMatrix`, design: `applyDesignBreadcrumbBoundary`)
- [x] touched 집계 SSOT = trace.jsonl `file_write` (tool + direct emit, design tool도 emit)
- [x] `buildBreadcrumb` 단위 테스트 15 tests (bubble-up 4 tier + scope 경계 + limits + stats + trace 필터)
- [x] 기존 `jobConversation` append 블록 주석 처리 + `TODO(legacy_cleanup)` (code learn + design sessionWriter)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest 52 suites / **1163 tests 전원 통과** (breadcrumb 15 신규 포함; template-reverse-matrix orphan 제거 완료)

**⚠️ 검증 미완**:
- end-to-end 시나리오 (direct 루프 → file_write → trace → learn matrix → appendBreadcrumb) 통합 테스트 없음. §13 compaction_policy 또는 §14 legacy_cleanup 마무리 후 수동 smoke 권장
- Breadcrumb summary 품질은 현재 directive 첫 줄 기반 — §19 misclassify_guard에서 실측 후 LLM 도입 여부 판단

**후속 의존성**:
- §13 `compaction_policy`: breadcrumb + user_turn 병합 결과 토큰 측정 → 임계치 초과 시 compact. featureContextBuilder가 T2만 compact 대상으로 삼도록 scope 분리 필요
- §14 `legacy_cleanup`: 본 todo에서 주석 처리한 `jobConversation` append 블록 실제 삭제 + `buildJobRecord` / `buildDesignJobRecord` 제거 + SessionState.jobConversation 필드 제거
- §16 `ui_render_migration`: trace.jsonl `file_write` 이벤트를 UI 채팅 렌더가 소비 (본 todo에서 SSOT가 채워짐)

---

### ✅ 13) `compaction_policy` (T2 user_turn LLM 요약 안전망)

**수정 파일**:
- `packages/ant-cli/src/core/context/featureContextBuilder.ts` — `FeatureContext`에 `summary?`/`wasCompacted?` 필드 추가 + `compactFeatureContext(ctx, deps, options?)` 신규 export. CHARS_PER_TOKEN=2.8 기반 `estimateTurnsTokens` 내장 + `FEATURE_CONTEXT_THRESHOLD`/`FEATURE_CONTEXT_WINDOW` default. `compactJob` 재사용 (MergedUserTurn → CompactableEntry 변환), LLM 실패 시 원형 ctx 반환 (graceful degradation)
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` — `buildFeatureContext` 직후 `state.deps.llm && state.deps.promptBuilder` 있으면 `compactFeatureContext` 호출. 결과는 동일 `featureContext` state 채널에 재할당 (`let` 변수 사용)
- `packages/ant-cli/src/agents/architect/graph/design/nodes/resolve.ts` — code resolve와 동일 패턴. feature.jsonl은 code/design이 공유하므로 threshold/window도 공유
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/base.md` — `{{#if featureContext.summary}}` 블록 신설 ("Earlier Context (summary)" 섹션). FPOP "read-only background" constraint + `{{{summary}}}` raw block
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/base.md` — direct와 동일 summary 블록 추가 (plan 프롬프트)

**신규 파일**:
- `packages/ant-cli/tests/verification/unit/compactFeatureContext.test.ts` — 5 tests (threshold 미만 no-op / window 이하 no-op / 정상 compact (window 보존 + summary 생성) / breadcrumbs 불변 보존 / LLM 실패 시 원형 반환)

**설계 결정**:
- Collapse vs Compact 책임 분리 유지: Collapse는 `FileSessionAdapter.appendBoundary`가 쓰기 시점에 자동 처리, Compact는 **읽기 시점 안전망** (featureContextBuilder)으로 완전히 직교
- `summary`는 별도 스트링 필드로 보관해서 `userTurns`에 가짜 엔트리를 섞지 않음 (compactJob의 설계 철학 그대로 계승). 프롬프트는 `{{featureContext.summary}}`를 별도 섹션으로 렌더
- window(6)보다 user_turn이 많을 때만 Compact 시도. 그 이하에선 summary 없이 원본 그대로 주입 → 적은 맥락에서 LLM call 불필요 (비용/지연)
- `infra/compaction/system.md` 기존 템플릿 재사용 — "Agreements / Artifacts / Open items" 3분류로 조직화된 요약 (이미 FPOP 준수)
- `compactJob` facade 통과: `CompactableEntry.role='user'`로 고정 (user_turn은 사용자 원본) + `content`=turn.user + `timestamp`=turn.ts. compactJob 내부가 `entries.slice(-recentWindowSize)`로 oldEntries/recentEntries를 나누기 때문에 windowSize만 정확히 넘겨주면 T2 slice 로직이 자연히 맞물림
- LLM/promptBuilder 중 하나라도 없으면 Compact 경로 스킵 (테스트 harness·특수 주입 시나리오 지원). 이는 resolve 쪽 옵셔널 체크로 처리
- breadcrumbs는 bubble-up 상한(BREADCRUMB_LIMITS + DEFAULT_BREADCRUMB_WINDOW=5)으로 이미 제한적 → compact 대상 아님 (T3는 수가 적고 요약하면 네비게이션 가치 상실)

**AC 달성**:
- [x] T2 토큰이 threshold 미만이면 compact 미호출 (LLM 호출 0회 — test: "no-op when token estimate is under threshold")
- [x] threshold 초과 시 summary가 featureContext에 담기고 userTurns가 windowSize로 트리밍 (test: "keeps the most recent windowSize entries and populates summary")
- [x] 최신 `FEATURE_CONTEXT_WINDOW(6)` user_turn은 summary 없이 그대로 유지 (test: turnIds 정확히 `t-6…t-11` 순서 보존)
- [x] breadcrumbs는 compact 중 건드리지 않음 (test: "preserves breadcrumbs untouched")
- [x] LLM 실패 시 원본 ctx 반환 (test: "graceful degradation")
- [x] plan/direct base.md에 `{{#if featureContext.summary}}` 섹션 추가 (FPOP: observation target + 2 constraints)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest **54 suites / 1203 tests** 전원 통과 (compactFeatureContext 5 신규)

**⚠️ 검증 미완**:
- end-to-end 시나리오 (user_turn 15+개 축적 → resolve Compact → plan 프롬프트에 summary 주입) 통합 테스트 없음. §16 `ui_render_migration` 또는 수동 smoke 필요
- Compact된 summary의 품질은 `infra/compaction/system.md` 기존 템플릿 의존 — 품질 개선은 본 플랜 범위 외

**후속 의존성**:
- §14 `legacy_cleanup`: 기존 `CODE_JOB_COMPACTION_THRESHOLD` / `DESIGN_JOB_COMPACTION_THRESHOLD` 상수는 `jobConversation` 경로 전용이었으나 본 todo에서 Compact는 `FEATURE_CONTEXT_THRESHOLD`로 완전히 이관됨. §14에서 legacy 상수(`CODE_JOB_*`, `DESIGN_JOB_*`, `PLAN_COMPACTION_*`, `VISUAL_COMPACTION_*` 중 unused)를 일괄 정리

**Phase C 종료**: §11~§13 3/3 완료. resolve가 feature.jsonl을 읽어 T2+T3 `featureContext`를 구축 + Collapse(boundary 시) + Compact(threshold 초과 시) 이중 메커니즘으로 맥락 크기 통제 + plan/direct 프롬프트 주입. 다음은 Phase D (§14 legacy_cleanup부터).

---

### 14. `legacy_cleanup` ✅

**목표**: Phase D 시작. Session redesign에서 superseded된 legacy 심볼(`chat.json` write path / `saveToChatFile` / `SessionState.jobConversation` / `planMini` / unused compaction 상수)을 **agent 실행 경로에서 완전 제거**. UI-facing HTTP layer는 §16과 겹쳐서 그쪽에서 정리.

**Grep 게이트 결과** (`packages/ant-cli/src` 스캔):
- `saveToChatFile` / `flushToChatFile` / `getChatSessionPath` / `jobConversation` / `planMini` — 0건
- `chat.json` — ChatService HTTP 레이어(3건) 잔존 → §16과 함께 UI migration에서 제거 예정 (handoff §14 스코프에서 명시적으로 "UI는 16과 중첩 → 16에서 처리"로 분리됨)
- `CODE_JOB_COMPACTION_*` / `DESIGN_JOB_COMPACTION_*` — 0건 (constants.ts에서 제거)
- `PLAN_COMPACTION_*` / `VISUAL_COMPACTION_*` — 유지 (plan/visual compactJob 현역)

**제거/변경 파일**:
- `packages/ant-cli/src/core/types/session.ts` — `SessionState.jobConversation` 필드 제거
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` / `design/state.ts` — `jobConversation` 필드 + `ConversationEntry` import 제거
- `packages/ant-cli/src/agents/architect/graph/code/graph.ts` / `design/graph.ts` — `jobConversation` channel annotation 제거
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` / `design/nodes/resolve.ts` — legacy `compressHeavyweightEntries` + `compactJob(jobConversation)` 블록과 `TODO(legacy_cleanup)` sentinel 전부 삭제. 미사용 import 정리
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts` / `design/nodes/learn/sessionWriter.ts` — legacy `jobConversation` append + `buildJobRecord` sentinel 삭제
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/jobRecord.ts` / `design/nodes/learn/jobRecord.ts` — **파일 삭제** (buildJobRecord / buildDesignJobRecord 미참조)
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts` / `design/nodes/decompose/{specDecompose,uiDesignDecompose,systemDesignDecompose}.ts` — `state.jobConversation` / `hasJobHistory` 렌더링 변수 제거
- `packages/ant-cli/src/agents/common/graph/nodes/resolve/utils.ts` — `compressHeavyweightEntries` 함수 삭제 + 관련 imports 정리
- `packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/job-history.md` / `design/base/injections/job-history.md` — **파일 삭제**
- `packages/ant-cli/src/core/prompt/templates/infra/compaction/job-summary.md` — **파일 삭제** (heavyweight 압축 경로와 함께)
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/base.md` + `scope-rules.md` / `design/nodes/decompose/variants/{ui-design-by-figma,ui-design-by-ref,system-design}/base.md` — `{{> job-history}}` partial include 및 "Completed Work Boundary" 섹션(jobConversation 의존) 제거
- `packages/ant-cli/src/core/prompt/injection-manifest.json` — `job-history` 엔트리 제거
- `packages/ant-cli/src/core/utils/sessionPaths.ts` — `getChatSessionPath` 함수 삭제 + 디렉터리 구조 docstring을 `feature.jsonl` / `trace.jsonl`로 갱신
- `packages/ant-cli/src/core/llm-response/SessionStore.ts` — `saveToChatFile` / `flushToChatFile` / `getChatFilePath` / `stripHeavyContent` / `featurePath` 필드 + `fs` / `path` / `MessageContent` / `isBaseBranch` / `getBranchBase` imports 제거. `finalizeMessage`의 chat.json persistence 호출 라인 제거
- `packages/ant-cli/src/core/llm-response/LLMResponseService.ts` — `flushToChatFile()` 래퍼 제거
- `packages/ant-cli/src/core/adapters/ChatAPIClient.ts` — `flushToChatFile()` 메서드 제거 (등록 훅은 `registerChatFlusher` 유지)
- `packages/ant-cli/src/agents/common/tool/types.ts` — `ChatStatusReporter.flush()` 인터페이스 제거
- `packages/ant-cli/src/agents/common/tool/chatStatusAdapter.ts` — `flush()` 구현 + noop flush 제거
- `packages/ant-cli/src/agents/common/tool/orchestrator.ts` — tool batch 루프의 `ctx.chatStatus.flush()` 호출 제거
- `packages/ant-cli/src/composition/gracefulShutdown.ts` — `ChatFlusher` 인터페이스 + `activeChatFlusher` 상태 + shutdown 시 flush 호출 제거. `registerChatFlusher` / `unregisterChatFlusher`는 기존 caller 호환을 위해 **no-op으로 유지**
- `packages/ant-cli/src/core/context/constants.ts` — `CODE_JOB_COMPACTION_THRESHOLD` / `CODE_JOB_COMPACTION_WINDOW` / `DESIGN_JOB_COMPACTION_THRESHOLD` / `DESIGN_JOB_COMPACTION_WINDOW` 4개 상수 제거
- `packages/ant-cli/src/core/prompt/templates/jobs/design/nodes/execute/variants/system-design/rules.md` — `chat.json` 문자열 언급 제거
- `packages/ant-cli/src/periphery/adapters/http/routes/chat.routes.ts` — 코멘트의 "chat.json" 설명을 "ChatService" 기반 문구로 변경
- `packages/ant-cli/tests/tool-registry.test.ts` — `reporter.flush` 체크를 `reporter.finalizeMessage`로 교체 (인터페이스 변경 반영)

**설계 결정**:
- `buildSessionDigest`는 `jobConversation` 소비자였으나 이번에 input이 비면 `undefined`를 반환해서 graceful degrade. 기존 triage 프롬프트의 `sessionDigest` 섹션은 지금은 항상 미렌더 → 향후 feature.jsonl 기반으로 대체할지 별개 결정. 인프라 자체는 이번 라운드에서 건드리지 않음 (후속 ticket에서 판단)
- `ChatService/*` + `chat.routes.ts` 백엔드 라우트는 UI(`packages/ant-ui`)가 여전히 `/api/chat/*`를 소비하므로 §14에서 유지. §16 `ui_render_migration`이 UI를 `trace.jsonl`로 전환하면서 함께 제거
- `compactJob`은 `CompactableEntry` 제네릭 함수로 이미 jobConversation 비의존. 시그니처 조정 불필요
- `planMini`는 원래 dead concept (grep 0건). "phase out 상태" 확인만 하고 실제 제거 없음
- `ConversationEntry` 타입 자체는 plan/visual 잡(Conversation persistence 경로)에서 여전히 사용 중이므로 유지. code/design 쪽에서만 import 제거
- `registerChatFlusher` / `unregisterChatFlusher`는 기존 `ChatAPIClient`가 여전히 호출하므로 no-op 함수로 남겨서 호출측 변경 없이 무력화 → 다음 라운드에 caller까지 정리할 수 있음

**AC 달성**:
- [x] agent-side grep 게이트: `chat\.json|saveToChatFile|jobConversation|planMini|flushToChatFile|getChatSessionPath|CODE_JOB_COMPACTION|DESIGN_JOB_COMPACTION|compressHeavyweightEntries` → `packages/ant-cli/src` 전체에서 0건 (ChatService HTTP layer 3건은 §16 스코프로 명시적 이관)
- [x] 내 수정 파일 타입 에러 0 (총 27 baseline 유지)
- [x] vitest **55 suites / 1248 tests** 전원 통과

**⚠️ 검증 미완**:
- ChatService HTTP 레이어가 여전히 chat.json을 작성/읽지만, agent-side 워커는 더 이상 chat.json을 작성하지 않음 → UI에서 `/api/chat/*`가 반환하는 내용이 오래된 상태로 남을 수 있음. §16 `ui_render_migration`이 `trace.jsonl` 기반으로 갈아엎을 때 최종적으로 정리됨
- `buildSessionDigest`가 항상 `undefined`를 반환하므로 triage 프롬프트의 sessionDigest 섹션은 사실상 dead. 별도 ticket에서 제거 또는 feature.jsonl 기반으로 재설계 필요

**후속 의존성**:
- §16 `ui_render_migration`: `ChatService` + `/api/chat/*` 라우트를 `trace.jsonl` 기반으로 재작성하고 그 시점에 chat.json 잔존 3건 제거 + UI 코드도 동시 이관

---

### 16. `ui_render_migration` ✅ (스캐폴딩 단계)

**목표**: trace.jsonl + feature.jsonl breadcrumb를 읽는 read-only HTTP 엔드포인트를 신설하고, ant-ui에 trace SSOT 기반 Activity 뷰 + Breadcrumb Timeline 탭을 추가. ChatPanel 내부 3-way 탭 스위처(Chat / Activity / Timeline)로 통합.

**실제 범위 결정**: 핸드오프 원문은 "ChatPanel을 trace.jsonl SSOT로 완전 치환"을 요구하나, 기존 ChatPanel이 `triage_choice` / `decompose-choice` / streaming file-write 카드 등 풍부한 ChatMessage 타입 + SSE live streaming에 강결합되어 있어 1 세션 완전 치환이 비현실적. Phase B에서 완성한 choice UX 회귀 위험을 피하기 위해 **스캐폴딩 접근**으로 분할:
- 이번 세션: 백엔드 엔드포인트 + UI API 클라이언트 + 슬라이스 + Activity/Timeline 탭 (trace SSOT가 UI에서 관찰 가능) ✅
- 후속(§16.2 `chat_ssot_finalization`): legacy chat rendering을 trace-derived 모델로 완전 치환 + ChatService/chat.routes 은퇴 + SSE initial_state.chat 제거

**신규 파일**:
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` — `GET /projects/:id/features/:feature/trace` (`?sinceTs=...&jobTypes=code,design`) + `GET .../breadcrumbs`. 요청마다 `FileSessionAdapter` 인스턴스 생성 (workspaceResolver.getFeaturePath 경유)
- `packages/ant-ui/src/infrastructure/http/api/featureLog.ts` — `getFeatureTrace(projectId, feature, { sinceTs?, jobTypes? })` + `getFeatureBreadcrumbs(projectId, feature)` API 클라이언트
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` — Zustand 슬라이스. `traceLines` / `breadcrumbs` / 각 `status`/`error` + `featureLogKey`(cache key) + fetch action 3종 + `appendFeatureTraceLine` / `appendFeatureBreadcrumb` / `clearFeatureLog`. stale response는 `featureLogKey` mismatch 체크로 안전 폐기
- `packages/ant-ui/src/presentation/components/chat/feature-log/TraceActivityView.tsx` — trace.jsonl SSOT 뷰. turnId 기준 grouping + 이벤트별 렌더 (user_turn / assistant_thinking / tool_call / file_write / run_command / job_status / assistant_message). turn 내 `firstTs` 기준 오름차순 정렬, turn 간 동일 기준 정렬
- `packages/ant-ui/src/presentation/components/chat/feature-log/BreadcrumbTimeline.tsx` — 수직 타임라인. scope별 dot 색상(`initial_creation` emerald / `modification` blue / `refactor` purple), anchor chip 3-kind (specs/paths/files), stats pills (`+created ~modified -deleted Σtouched`)
- `packages/ant-ui/src/presentation/components/chat/feature-log/useFeatureLogSync.ts` — 피처 mount 시 trace + breadcrumbs 자동 로드 훅. project/feature 변경 시 재-fetch, unmount 시 clear
- `packages/ant-cli/tests/verification/unit/fileSessionAdapter-log.test.ts` — `loadAllTrace` (sinceTs strict-greater + jobTypes 집합 + 미생성 파일 ENOENT) / `loadAllBreadcrumbs` (collapsed 제외 + append-order + ENOENT) 6 tests

**수정 파일**:
- `packages/ant-cli/src/core/ports/session.ts` — `SessionPort`에 `loadAllTrace(opts)` / `loadAllBreadcrumbs()` 2 메서드 추가
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` — 위 2 메서드 구현. `collapsed` 제외, `sinceTs`는 strict-greater 비교(ISO 8601 문자열 비교 안전), `jobTypes`는 `Set` lookup
- `packages/ant-cli/src/periphery/adapters/http/routes/index.ts` — `createFeatureLogRoutes`를 `createApiRoutes`에 마운트. `workspaceResolver` 주입
- `packages/ant-ui/src/infrastructure/http/api/index.ts` — `./featureLog` re-export
- `packages/ant-ui/src/domain/store/index.ts` — `Store` 타입에 `FeatureLogSlice` 교차 + `createFeatureLogSlice` 스프레드
- `packages/ant-ui/src/presentation/components/chat/ChatPanel.tsx` — 상단 탭 바(`ChatPanelTabBar`) + `activeTab` 상태 + Chat/Activity/Timeline 분기 렌더. Chat 뷰는 기존 로직 그대로(역호환 + triage/choice UX 보존). Activity/Timeline 탭 선택 시 ChatInput은 공유 유지
- `packages/ant-ui/src/i18n/locales/{en,ko}/chat.json` — `panelTabs.{chat,activity,timeline}` / `activity.{loading,loadError,empty}` / `breadcrumb.{loading,loadError,empty,scope.*}` 키 신설 (양 로케일 동일 구조)

**설계 결정**:
- URL 패턴: 기존 `/api/projects/:id/features/:feature/...` 규약 준수 (핸드오프 원문의 `/api/feature/:featureId/...`는 WorkspaceResolver 재설계가 필요해서 기각)
- Breadcrumb 배치: ChatPanel 사이드바 내부 탭 스위처로 통합 → FeatureSection/MainContentArea 레이아웃 변경 없음. 채팅 맥락(Chat 탭) 바로 옆에서 turnId 기준 Activity, 시간순 Timeline을 볼 수 있어 네비게이션 밀접도 최상
- 탭 전환 시 `ChatInput` 공유 유지 — Activity/Timeline 탭에서도 사용자가 곧바로 새 요청을 보낼 수 있어 UX 연속성 확보
- Activity 뷰의 grouping key는 `turnId`. 누락 시 `__untagged__` bucket으로 떨어져 UI 붕괴 방지. turn 내부 이벤트는 `ts` 오름차순, turn 간에는 `firstTs` 기준
- `featureLogKey`로 stale fetch 결과 격리 — project/feature 변경 중 in-flight 요청이 돌아와도 이전 feature 데이터로 덮어쓰지 않음
- Legacy ChatPanel 로직은 건드리지 않음 — triage_choice / decompose-choice / streaming file-write 카드가 살아있어 Phase B 완성 상태 보존
- SSE 전혀 미수정 — workflow stream / chat stream 그대로. trace 엔드포인트는 "초기 로드 전용"

**AC 달성**:
- [x] 두 엔드포인트가 SSE 아닌 일반 HTTP로 동작 (초기 로드 전용 — `getFeatureTrace` / `getFeatureBreadcrumbs`)
- [x] SSE는 기존 workflow stream 유지 (`sseSlice` 전혀 미수정)
- [x] 채팅 렌더가 turnId 기준으로 그룹화 (`TraceActivityView`의 `groupByTurn`)
- [x] breadcrumb 타임라인이 별개 탭/패널로 표시 (`BreadcrumbTimeline`을 ChatPanel Timeline 탭에 마운트)
- [x] 내 수정 파일 타입 에러 0 (ant-cli tsc 27 baseline 유지, ant-ui tsc 기존 선행 에러만)
- [x] vitest **56 suites / 1254 tests** 전원 통과 (fileSessionAdapter-log 6 신규)
- [x] `pnpm build` (ant-ui) 성공 — dist 산출, pre-existing warning만

**⚠️ 검증 미완 / 후속 이관**:
- ChatService + `chat.routes.ts` (GET/DELETE messages / user-message / job-error / triage-choice / pending-choice / eval-save / dismiss-choice) + SSE `initial_state.chat.messages` 경로는 **그대로 유지**. UI의 Chat 탭이 여전히 해당 경로를 소비. 완전 제거는 **§16.2 `chat_ssot_finalization`** 로 분리 이관
- Activity/Timeline 탭은 현재 initial-load HTTP fetch에만 의존 — 실시간 업데이트 없음. 새 이벤트 반영은 피처 재진입 또는 수동 refresh 필요. 후속에서 SSE 기반 append 구현 가능 (슬라이스에 이미 `appendFeatureTraceLine`/`appendFeatureBreadcrumb` 준비됨)
- trace line 스키마가 `ChatMessage` 대비 단순 — choice 카드 / streaming file-create 중간 단계 등은 표현 불가. §16.2에서 choice 인터랙션을 trace 이벤트 기반으로 재설계하거나, choice UX를 trace와 직교한 별도 레이어(pending-choice endpoint 재사용)로 분리해야 함

**사후 결함 검토 (자체 리뷰)**:
| 등급 | 항목 | 상태 |
|---|---|---|
| P0 | `BreadcrumbTimeline` `<li>`에 `relative` 누락 → dot이 `<ol>` 기준 절대 위치로 렌더되어 타임라인 dot 정렬이 브라우저 static-position 해석에 의존 | ✅ 수정 (`relative` 추가 + `-left-[22px] top-1`로 정량 좌표 명시) |
| P1 | `loadFeatureTrace`/`loadFeatureBreadcrumbs`가 피처 전환 시 `traceLines`/`breadcrumbs` 배열을 초기화 안 함 → 피처 A→B 전환 직후 B fetch 완료 전까지 A 데이터가 잔존 | ✅ 수정 (두 loader에 `isNewFeature` 체크 후 해당 배열만 `[]`로 리셋) |
| P1 | 공유 `featureLogKey`가 trace/breadcrumb 양쪽에서 덮어써 race 조건 (서로 다른 쌍으로 동시 호출 시 늦은 호출이 이른 호출의 유효 결과를 폐기) | ✅ 수정 (`traceKey` / `breadcrumbsKey` per-loader 키 분리) |
| P2 | `createFeatureLogRoutes` 마운트가 다른 workspaceResolver 의존 라우트(figma/org/transfer)와 달리 무조건 등록 → handler 내 503 fallback은 있었지만 일관성 부족 | ✅ 수정 (`if (deps.workspaceResolver)` 가드로 다른 라우트와 패턴 통일) |
| P2 | `TurnGroup.assistantText` 계산은 하지만 전혀 사용하지 않는 dead field | ✅ 수정 (필드 + 집계 루프 제거) |
| P3 | 탭 버튼에 `aria-controls` / 패널에 `role="tabpanel"` + `aria-labelledby` 미설정 (ARIA tabs 패턴 미완성) | ⏸ 접근성 폴리시 — §18 `tier_ui_badge` 또는 별도 UI-a11y 패스에서 일괄 처리 권장 |
| P3 | `ChatPanel` 인자의 `_projectId`/`_featureName` underscore 접두사는 이제 `useFeatureLogSync`에서 소비되므로 "의도적 미사용" 규약과 불일치 (기능상 영향 없음) | ⏸ 주변 코드 규약 리팩터링 시 함께 정리 |
| 검증 제외 | SessionPort 인터페이스 확장이 다른 구현체 영향 없음 (유일 구현체 `FileSessionAdapter`, 테스트에 Mock 없음) | ✅ grep 확인 |
| 검증 제외 | 라우트 URL prefix는 `RouteConfigurator.setupApiRoutes`의 `app.use('/api', apiRoutes)` 경유로 `/api/projects/...` 정확히 마운트됨 | ✅ 확인 |
| 검증 제외 | Cloud 모드 JWT 미들웨어: 신규 라우트가 `publicPaths` 밖이라 자동 인증 필수 | ✅ 확인 |
| 검증 제외 | Local 모드: `extractUserContext` → `{local, local}` fallback 또는 filesystem 추론. 기존 라우트와 동일 패턴 | ✅ 확인 |
| 검증 제외 | Realtime/Worker 서버는 `createApiRoutes` 미사용 → 신규 라우트는 API 서버 전용으로 노출 | ✅ 확인 |

수정 후 재검증: tsc baseline 27 유지 + vitest **56 suites / 1254 tests** 전원 통과 + 내 파일 타입 에러 0. 후속 커밋(defect-fix)로 별도 푸시.

**후속 의존성**:
- §16.2 `chat_ssot_finalization`(신규 — §4 남은 todos 참조): Chat 탭 자체를 Activity 뷰로 치환 + ChatService/chat.routes/SSE initial_state.chat 제거 + choice UX 재설계
- §17 `hard_reset`: 본 todo로 `/trace` + `/breadcrumbs` 엔드포인트 인프라가 갖춰졌으므로 reset 후 UI가 즉시 빈 상태로 갱신되는 경로가 열림
- §18 `tier_ui_badge`: `TraceActivityView`의 turn 헤더가 `mode · complexity · decidedBy · reason` 배지 렌더 자리 제공 (현재 `jobType` + `turnId` + `firstTs` 표시 중)

---

## 4. 남은 Todos (4개, 실행 순서)

> 번호 = 실행 순서. **§5의 카드도 동일 번호**로 정렬됨.
> 선행 의존이 모두 완료됐을 때만 해당 번호 시작 가능.

### Phase B — 핵심 라우팅 체인 (4개)

> 이 4개 완료 시점 = **Mode × Complexity 경로가 실제로 작동하는 MVP**.

- [x] **7. `decompose_spec_clarify`** — 발동 조건 4 AND + 프롬프트 지시 + orchestrator choice 응답. ✅ 완료
- [x] **8. `direct_node`** — 신규 `direct` 노드 (ReAct 루프). mode별 tool set, complexity별 루프 상한. 공용 유틸 `nodes/shared/` 추출. graph 편입은 9에서. ✅ 완료
- [x] **9. `route_after_decompose_3way`** — `routeAfterDecompose` 4-way 확장 + `routeAfterDirect` 신설 + graph 배선. 8의 direct 노드를 정식 연결. ✅ 완료
- [x] **10. `runtime_escalate`** — direct 내부 승격 트리거 + `_promotedThisJob` 1회 상한. `shouldEscalate()` 유틸 + touched 집계 + LLM 태그 공용 promoteThisJob 경로. ✅ 완료 → **Phase B 종료**

### Phase C — 맥락 레이어 (3개 · ✅ 3/3 완료)

- [x] **11. `resolve_integrate`** — resolve에서 `loadSinceBoundary()` 호출 + `featureContext` 주입 + 기존 `jobConversation` 로드 주석 처리. ✅ 완료
- [x] **12. `breadcrumb_tiered_policy`** — `core/context/breadcrumb.ts` 신규 (bubble-up 4-tier + trace collector). code/design learn 노드가 §2.4 매트릭스에 따라 BC/Boundary append. trace.jsonl `file_write` SSOT 확립 (tool + direct + design tool emit). ✅ 완료
- [x] **13. `compaction_policy`** — `compactFeatureContext` 신규 (Collapse는 adapter SSOT, Compact는 `FEATURE_CONTEXT_THRESHOLD` 초과 시 LLM 요약 + `FEATURE_CONTEXT_WINDOW` 최신 user_turn 보존). plan/direct base.md에 `{{#if featureContext.summary}}` 섹션. ✅ 완료 → **Phase C 종료**

### Phase D — Cleanup · UI (5개 · ✅ 2/5 완료)

- [x] **14. `legacy_cleanup`** — `chat.json` (agent write path) / `saveToChatFile` / `jobConversation` 필드 / `planMini` / unused compaction 상수 일괄 제거. agent-side grep 게이트 0. ChatService HTTP layer는 §16 스코프로 명시 이관. ✅ 완료
- [x] **16. `ui_render_migration`** — 백엔드 `/api/projects/:id/features/:feature/{trace,breadcrumbs}` 엔드포인트 + ant-ui `FeatureLogSlice` + `TraceActivityView` (turnId 그룹) + `BreadcrumbTimeline` + ChatPanel 3-way 탭 스위처. legacy Chat 탭은 §16.2에서 치환. ✅ 완료
- [ ] **16.2. `chat_ssot_finalization`** — Chat 탭을 trace-derived 모델로 완전 치환 + ChatService/`chat.routes.ts`(GET/DELETE messages, user-message, job-error, eval-save, dismiss-choice) 은퇴 + SSE `initial_state.chat.messages` 경로 제거 + choice UX(triage_choice / decompose-choice) 재설계. §16 후속.
- [ ] **17. `hard_reset`** — `POST /api/projects/:id/features/:feature/context/reset` + FeatureSection 헤더 리셋 버튼.
- [ ] **18. `tier_ui_badge`** — user_turn 뱃지에 `mode · complexity · decidedBy · reason` 표시 (읽기 전용).

### Phase E — 관찰성 (1개)

- [ ] **19. `misclassify_guard`** — learn에서 complexity 오분류 통계 → `core/utils/featureBiases.ts` 누적. 본 플랜에선 데이터 수집만.

### 선택 — 병행 가능 (2개)

> 본 MVP 흐름과 독립. 언제든 별도 세션에서 진행 가능.

- [ ] **S1. `philosophy_doc`** — `docs/architecture/18-session-redesign.md` 신규 (세 직교 축 + 매트릭스 + 스키마 예시).
- [ ] **S2. `diagnose_injection`** — 현행 `jobConversation` / `sessionDigest` 주입 강도 실측 부록.

---

## 5. 실행 카드 (12개, 순서대로)

> 각 카드는 **선행 의존이 모두 완료된 상태**에서 단독 실행 가능.
> 공통 원칙: **Landmark 읽기 → 단계 순서대로 → AC 체크 → 검증 명령**.
> 공통 검증 명령 (모든 카드):
> ```bash
> cd /Users/probe/dev/ant/packages/ant-cli
> pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'   # 27 baseline 유지 확인
> ```

---

### 7. `decompose_spec_clarify`  —  Phase B

**Goal**: `complexity='todo'` + `mode≠explain` + (systemDesign 없음) + (관련 spec 없음)일 때 Decompose가 `<specClarify>` 태그를 emit하도록 프롬프트 + 조건 체크 + orchestrator choice 응답 처리.

**선행 의존**: 6 (`decompose_complexity` — 완료)
**해금 대상**: 9 (`route_after_decompose_3way`가 `state.specClarify`를 읽어 routing)
**예상 범위**: M (프롬프트 1~2곳 + orchestrator 1곳 + decompose index 조건 블록)

**Landmark 파일** (반드시 먼저 읽기):
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts` — specClarify short-circuit 블록은 이미 존재 (§3.6). LLM이 emit한 경우의 처리 경로만 검증
- `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md` — "Complexity Classification" 섹션 다음에 "Spec Clarify" 섹션 추가할 위치
- `packages/ant-cli/src/composition/orchestrator.ts` — `awaitingDecomposeClarify` 재진입 패턴 확인 (기존 clarify 경로 있음)
- `packages/ant-shared/src/session-log.ts` `SpecClarify` — 출력 스키마 SSOT
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `_specClarifyBypassed`, `specClarify` 채널 (이미 추가됨)

**단계**:
1. **프롬프트 발동 조건 작성** (`decompose/variants/default/rules.md`):
   - "## Spec Clarify" 섹션을 Complexity Classification 직후에 FPOP로 추가
   - 발동 조건 4개 AND를 관찰 타겟으로 기술 (`complexity === 'todo'`, `mode !== 'explain'`, `<spec-docs-availability>` 빈 목록, `<system-design-availability>` 빈 목록)
   - 발동 시 `<tasks>[]`와 함께 `<specClarify>` JSON을 emit. 비발동 시 `<specClarify>` 생략 또는 `{}` emit
   - `<specClarify>` 스키마는 `SpecClarify` (shared)와 일치해야 함. 예시 JSON 대신 필드 리스트로 안내
2. **bypass 경로** (`decompose/index.ts`):
   - 기존 short-circuit 블록(`if (specClarify && !state._specClarifyBypassed)`)은 그대로 유지
   - `_specClarifyBypassed === true`면 프롬프트에 "이미 사용자가 proceed_without_spec 선택" 힌트 주입 변수 추가 (enrichedVars 내 `specClarifyBypassed` boolean) → 프롬프트에서 `{{#if specClarifyBypassed}}` 섹션으로 "Do NOT emit `<specClarify>`" 제약
3. **orchestrator choice 응답 처리** (`composition/orchestrator.ts`):
   - 기존 `awaitingDecomposeClarify` 재개 경로를 찾고, choice payload를 받아 분기:
     - `redirect_to_design` → 현 code job 종료 + design job enqueue (triage redirect 패턴 참고)
     - `proceed_without_spec` → 같은 jobId resume + state.`_specClarifyBypassed = true` 세팅
     - `cancel` → 현 job 종료, 세션 정리
4. **HTTP API** (`periphery/adapters/http/routes/` 내 clarify 관련 라우트):
   - 기존 `sendTriageChoice` 또는 `sendDetectChoice` 패턴을 grep으로 찾기
   - 필요시 `sendDecomposeChoice` 엔드포인트 신규 (body: `{ choice: 'redirect_to_design'|'proceed_without_spec'|'cancel', jobId }`)

**AC**:
- [ ] `rules.md`에 FPOP 원칙 준수하는 "Spec Clarify" 섹션 추가 (구체 예시/값 매핑 없음, 관찰 타겟·제약·blind spot 형태)
- [ ] 발동 4-AND 조건 중 하나라도 거짓이면 LLM이 `<specClarify>`를 emit하지 않음 (프롬프트로 보장)
- [ ] `_specClarifyBypassed === true`인 재진입에서 `<specClarify>`가 다시 emit되지 않음
- [ ] orchestrator가 3개 choice 모두 처리 (redirect / proceed / cancel)
- [ ] 내 수정 파일 타입 에러 0 (baseline 27 유지)

**검증**:
```bash
pnpm vitest run tests/triage-parser.test.ts tests/triage-prompt.test.ts   # regression
# clarify 관련 테스트가 있으면 실행. 없으면 스킵 (후속 테스트 todo).
```

---

### 8. `direct_node`  —  Phase B

**Goal**: 신규 `direct` 노드 구현. execute와 독립, 내부 ReAct 루프. mode별 tool set, complexity별 루프 상한. 공용 LLM/툴 유틸은 `nodes/shared/`에 추출.

**선행 의존**: 6 (`decompose_complexity` — `directMode` / `directHints` 채널 완료)
**해금 대상**: 9 (graph 배선), 10 (`runtime_escalate` 내부 트리거)
**예상 범위**: L (신규 디렉터리 2개, 신규 프롬프트 2개, 공용 유틸 3개)

**Landmark 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/execute/index.ts` — ReAct 패턴 참고 (재사용 아님, 복사 금지 — 패턴만 학습)
- `packages/ant-cli/src/agents/common/graph/conversations.ts` (`CONV_KEYS`) — `NODE_DIRECT` 추가 위치
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `directMode`, `directHints`, `needsEscalation`, `_promotedThisJob` 확인
- `packages/ant-cli/src/core/ports/workflow.ts` (`extractLLMInfo`) — observability
- `packages/ant-cli/src/agents/common/tool/` — tool set 구성 방식 (`TOOL_SETS.codeExplain` 등 grep)
- `packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/` — 기존 explain-guidance / refactor-guidance 위치 확인

**단계**:
1. **공용 유틸 추출** (`packages/ant-cli/src/agents/architect/graph/code/nodes/shared/`):
   - `invokeLLMWithTools.ts` — LLM 호출 + mode별 tool binding 래퍼
   - `runToolCallsAndCollect.ts` — tool 실행 + 결과 수집
   - `parseReActResponse.ts` — `<done>` / `<function_calls>` XML 파싱
   - ⚠️ execute에서 동일 로직을 **호출하도록 리팩토링하지 말고**, 먼저 direct에서만 사용. execute 이관은 별도 후속
2. **direct 노드 구현** (`nodes/direct/index.ts`):
   - 루프: `observe → reason → decide (tool_call / answer / escalate)`
   - 상한: `directMode === 'oneshot'` → 2, `'exploratory'` → `ANT_DIRECT_MAX_STEPS ?? 10`
   - mode별 tool set 분기: explain → read-only, refactor/generate → full
   - 종료 시 `saveCheckpoint` 호출 (task 없는 state 수용 여부 확인 후 필요 시 해당 헬퍼 보강)
3. **CONV_KEYS 확장** (`agents/common/graph/conversations.ts`):
   - `NODE_DIRECT: 'node:direct'` 키 추가
   - `applyRetention` 정책에서 direct 엔트리도 처리되는지 확인
4. **프롬프트 신설** (`core/prompt/templates/jobs/code/nodes/direct/variants/default/`):
   - `base.md` (WHAT): directive, featureContext(아직 없으면 주석 처리), tool catalog injection
   - `rules.md` (HOW): FPOP로 루프 종료 조건 + mode별 행동 원칙
   - ⚠️ `explain-guidance`, `refactor-guidance` 기존 partial을 조합
5. **Observability 계약**:
   - 시작: `workflowUpdate.enterNode(_httpJobId, 'direct', 0, undefined, extractLLMInfo(llm))`
   - 매 루프: `state.recursionCount = (state.recursionCount ?? 0) + 1`
   - 종료: `exitNode(_httpJobId, 'direct', 0)`

**AC**:
- [ ] `nodes/direct/index.ts`가 직접 export되고 import 가능
- [ ] `nodes/shared/` 유틸 3개가 direct 내부에서만 사용됨 (execute에는 영향 없음)
- [ ] mode=explain이면 read-only tool set, refactor/generate면 full tool set
- [ ] `directMode='oneshot'`이면 2-step, `'exploratory'`이면 설정값(기본 10)-step 상한
- [ ] `CONV_KEYS.NODE_DIRECT` 추가 + `applyRetention`에서 처리
- [ ] 프롬프트 FPOP 위반 없음
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm vitest run   # 기존 테스트 모두 pass (direct 전용 테스트는 별도 후속)
```

---

### 9. `route_after_decompose_3way`  —  Phase B

**Goal**: `routeAfterDecompose`를 4-way (specClarify / oneshot / exploratory / todo)로 확장하고, `routeAfterDirect` 신설. `graph.ts`에 direct 노드를 정식 배선.

**선행 의존**: 7 (`state.specClarify`), 8 (direct 노드 존재)
**해금 대상**: 10 (`runtime_escalate`가 `routeAfterDirect` 분기 사용)
**예상 범위**: S (routing.ts 2개 함수 + graph.ts 1블록)

**Landmark 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/routing.ts` — 현재 `routeAfterDecompose` 52-64 라인. `specClarify`/`complexity` 모두 미반영
- `packages/ant-cli/src/agents/architect/graph/code/graph.ts` — decompose → (plan/parallelOrchestrator) 조건부 엣지 위치 확인
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `specClarify`, `complexity`, `needsEscalation`, `_promotedThisJob`

**단계**:
1. **`routeAfterDecompose` 확장** (`routing.ts`):
   ```typescript
   export function routeAfterDecompose(state: ArchitectGraphState): string {
     if (state.awaitingDecomposeClarify || state.specClarify) return '__end__';
     if (state.complexity === 'oneshot' || state.complexity === 'exploratory') return 'direct';
     const concurrency = getTaskConcurrency();
     return concurrency > 1 ? 'parallelOrchestrator' : 'plan';
   }
   ```
2. **`routeAfterDirect` 신설** (`routing.ts`):
   ```typescript
   export function routeAfterDirect(state: ArchitectGraphState): string {
     if (state.needsEscalation && !state._promotedThisJob) return 'decompose';
     return 'learn';
   }
   ```
3. **`graph.ts` 배선**:
   ```typescript
   graph.addNode("direct", direct as any);
   graph.addConditionalEdges("decompose", routing.routeAfterDecompose,
     { __end__: "__end__", direct: "direct", plan: "plan", parallelOrchestrator: "parallelOrchestrator" } as any);
   graph.addConditionalEdges("direct", routing.routeAfterDirect,
     { decompose: "decompose", learn: "learn" } as any);
   ```

**AC**:
- [ ] 기존 `awaitingDecomposeClarify` + 신규 `specClarify` 양쪽 다 `__end__` 분기
- [ ] `complexity === 'oneshot'|'exploratory'` → direct
- [ ] `complexity === 'todo'` (또는 undefined) → plan/parallelOrchestrator (기존 동작)
- [ ] `routeAfterDirect`가 `_promotedThisJob` 가드로 1회 상한 (true면 learn)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
# decompose → todo 경로는 기존 테스트로 regression 확인
pnpm vitest run tests/plan-entry-dispatcher.test.ts
# 가능하다면 routing 단위 테스트 추가 (decompose_complexity 후속 권장 테스트와 함께)
```

---

### 10. `runtime_escalate`  —  Phase B

**Goal**: direct 노드 내부에서 승격 트리거(touched > 임계치 / LLM의 `needsEscalation` 시그널)를 감지하고 `_promotedThisJob=true`와 함께 `needsEscalation: true` 반환. 9의 `routeAfterDirect`가 이 상태를 읽어 decompose로 재진입.

**선행 의존**: 8 (direct 노드), 9 (routeAfterDirect)
**해금 대상**: Phase B 완료
**예상 범위**: S (direct 노드 내 조건 블록 + 보조 유틸 1개)

**Landmark 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/index.ts` (8에서 신설)
- `packages/ant-shared/src/session-log.ts` — `PROMOTION_TOUCHED_THRESHOLD` 상수 (기본 3)
- `packages/ant-cli/src/agents/architect/graph/code/state.ts` — `_promotedThisJob`, `needsEscalation`, `recursionCount`, `recursionLimit`

**단계**:
1. **승격 판정 유틸** (`nodes/direct/shouldEscalate.ts`):
   - 입력: `state`, 현재 touched 파일 집합
   - 출력: `boolean`
   - 조건 OR: `touched.length > PROMOTION_TOUCHED_THRESHOLD` / LLM 응답에 `needsEscalation: true` 시그널
2. **direct 노드에서 사용**:
   ```typescript
   if (!state._promotedThisJob && shouldEscalate(state, touched)) {
     return { needsEscalation: true, _promotedThisJob: true, /* state 승계 */ };
   }
   ```
3. **3중 가드 확인**:
   - `_promotedThisJob` (명시적 1회)
   - LangGraph `recursionLimit`
   - `recursionCount` tracking (direct 내부 루프와 노드 재진입 모두 카운트되도록)

**AC**:
- [ ] direct → decompose 재진입이 job당 정확히 1회까지만 가능
- [ ] 재진입 후 decompose는 정상 동작 (기존 파싱/분류 흐름 그대로)
- [ ] `recursionLimit` 도달 시 안전하게 learn으로 빠짐 (무한 루프 없음)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'   # 27 baseline
# 승격 시뮬레이션 단위 테스트 권장 (shouldEscalate).
```

---

### 11. `resolve_integrate`  —  Phase C

**Goal**: resolve 노드에서 `session.loadSinceBoundary()`로 feature.jsonl을 읽어 `state.featureContext`를 채우고, 기존 `jobConversation` 기반 heavyweight 압축 블록을 제거. plan/direct base 프롬프트 상단에 `{{{featureContext}}}` 슬롯 주입.

**선행 의존**: 6 (featureContext 채널), Phase B 완료 권장 (direct 프롬프트에 주입하기 위해)
**해금 대상**: 12 (breadcrumb 생성 시 turn 병합 전제), 13 (compact이 featureContext 크기 측정)
**예상 범위**: M (resolve 2곳 + 프롬프트 2곳)

**Landmark 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` (라인 276~290 근방 `compressHeavyweightEntries` + `compactJob` 블록)
- `packages/ant-cli/src/agents/architect/graph/design/nodes/resolve.ts` (동일 패턴)
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` — `loadSinceBoundary` 구현 확인
- `packages/ant-cli/src/core/ports/session.ts` — `SessionPort.loadSinceBoundary` 시그니처
- plan/direct base 프롬프트 — 주입 위치

**단계**:
1. **code resolve 노드**:
   - `state.deps.session.loadSinceBoundary(project, featureFolder)` 호출
   - 반환값 `{ userTurns, userTurnMetas, breadcrumbs }`를 turnId 기준 병합
   - `state.featureContext = { breadcrumbs: breadcrumbs.slice(-5), userTurns: mergedTurns }`
   - 기존 `compressHeavyweightEntries` + `compactJob(jobConversation)` 블록 주석 처리 (삭제는 `legacy_cleanup`에서)
2. **design resolve 노드**: 동일 패턴 복제 (design 서브그래프 내부는 건드리지 않음 — D5)
3. **프롬프트 주입**:
   - plan base: 상단 directive 블록 직전에 `{{#if featureContext}}`...`{{/if}}` 섹션 (간결한 BC + 최근 user_turn 요약)
   - direct base: 동일 슬롯
   - FPOP: "이전 맥락"이라는 명시적 섹션명, 구체 포맷은 partial로 분리

**AC**:
- [ ] `loadSinceBoundary`가 호출되고 결과가 `featureContext`에 담김
- [ ] `userTurns[i]`에 `user_turn_meta` (turnId 일치)의 complexity/mode가 병합되어 있음
- [ ] plan/direct 프롬프트에서 featureContext가 렌더링됨 (handlebars 변수 누락 없음)
- [ ] 기존 heavyweight 압축 블록이 무력화됨 (주석 처리 또는 early-return)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'
# resolve 관련 스냅샷 테스트가 있으면 갱신 후 재실행
```

---

### 12. `breadcrumb_tiered_policy`  —  Phase C

**Goal**: `core/context/breadcrumb.ts` 신규 — bubble-up 알고리즘으로 touched 파일들을 summary로 승격. learn 노드에서 §2.4 매트릭스에 따라 BC / Boundary 생성.

**선행 의존**: 11 (featureContext 소비 쪽 준비), 6 (complexity 채널)
**해금 대상**: 13 (compact 미발동 시에도 breadcrumb가 있어야 T3 유지), 16 (UI breadcrumb 타임라인)
**예상 범위**: M (신규 파일 1개 + learn 노드 분기 블록 + FileSessionAdapter 호출)

**Landmark 파일**:
- `packages/ant-shared/src/session-log.ts` — `FeatureBreadcrumbLine`, `BREADCRUMB_THRESHOLDS`, `BREADCRUMB_LIMITS`
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts` — 기존 jobConversation append 블록 위치
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` — `appendBreadcrumb`, `appendBoundary` (완료됨)
- §2.4 매트릭스 (본 문서)

**단계**:
1. **`core/context/breadcrumb.ts` 신규** — `buildBreadcrumb(input): FeatureBreadcrumbLine`:
   - Bubble-up 로직: `touched ≤ 10` → files / `11~50` → paths / `51~200` → specs+paths / `>200` → initial_creation
   - 상한: specs ≤ 3, paths ≤ 5, files ≤ 10 (shared 상수 사용)
   - scope 판정: initial_creation / modification / refactor
2. **learn 노드** (`nodes/learn/index.ts`):
   - trace.jsonl의 file_write 이벤트에서 touched 집계 헬퍼 (`collectTouchedFilesFromTrace`)
   - §2.4 매트릭스 분기:
     - `mode !== 'explain' && complexity === 'todo'` → BC + Boundary 둘 다
     - `mode !== 'explain' && complexity === 'exploratory' && touched.length >= 3` → mini-BC만
     - `mode === 'explain' && complexity === 'todo'` → Boundary만 (BC 생성 안 함)
     - 그 외 → 아무것도 안 함
   - ⚠️ 기존 `jobConversation` append 블록은 주석 처리 (legacy_cleanup에서 삭제)
3. **learn 프롬프트 rules.md**: "명사형 1줄 summary" 제약 추가 (FPOP)

**AC**:
- [ ] §2.4 매트릭스 5개 행이 코드로 구분됨 (explain+todo는 Boundary만 ✅)
- [ ] touched 수에 따른 bubble-up 4단계 테스트 가능
- [ ] `buildBreadcrumb`가 `FeatureBreadcrumbLine` 타입에 맞는 값 반환
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm vitest run
# buildBreadcrumb 단위 테스트 권장 (테스트 파일 신설)
```

---

### 13. `compaction_policy`  —  Phase C

**Goal**: 맥락 관리 이중 메커니즘 — (a) Collapse는 `appendBoundary`가 자동 처리(이미 완료), (b) Compact는 T2 토큰이 임계치 초과 시 LLM 요약.

**선행 의존**: 11 (featureContext 생성)
**해금 대상**: (없음 — Phase C 마무리)
**예상 범위**: S (compactJob 호출 경로 1곳)

**Landmark 파일**:
- `packages/ant-shared/src/session-log.ts` — `FEATURE_CONTEXT_THRESHOLD=12000`, `FEATURE_CONTEXT_WINDOW=6`
- `packages/ant-cli/src/core/context/compactJob.ts` — 재사용 대상
- `packages/ant-cli/src/agents/architect/graph/code/nodes/resolve/index.ts` — featureContext 생성 직후 토큰 측정 지점

**단계**:
1. resolve에서 featureContext 생성 직후:
   - userTurns+breadcrumbs의 content를 합친 문자열 토큰 측정 (기존 토큰 카운터 재사용)
   - `FEATURE_CONTEXT_THRESHOLD` 초과면 `compactJob`을 T2 user_turn 배열에 적용, 반환값으로 `state.featureContext.userTurns`의 오래된 부분 교체
   - 최신 `FEATURE_CONTEXT_WINDOW(6)` 개는 원형 유지
2. 필요 시 `core/context/constants.ts`에 shared 상수 re-export (import 경로 일관성)
3. compactJob이 `jobConversation`을 참조하던 부분이 있다면 T2 user_turn 전용 시그니처로 좁힘 (legacy_cleanup에서 최종 정리)

**AC**:
- [ ] T2 토큰이 임계치 미만이면 compact 미호출 (성능)
- [ ] 임계치 초과 시 요약된 userTurns가 featureContext에 담김
- [ ] 최신 6개 user_turn은 요약되지 않고 그대로 유지
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'
```

---

### 14. `legacy_cleanup`  —  Phase D

**Goal**: 레거시 심볼 일괄 제거. grep 게이트 0 달성 (`chat.json`, `saveToChatFile`, `jobConversation`, `planMini`).

**선행 의존**: 11~13 (Phase C) — resolve/learn이 jobConversation을 더 이상 소비·생성하지 않아야 함
**해금 대상**: 16 (UI migration이 chat.json 소비 코드를 제거할 때 백엔드도 클린)
**예상 범위**: L (연쇄 컴파일 에러를 가이드로 다수 파일)

**Landmark 파일** (grep 결과로 시작):
```bash
rg 'chat\.json|saveToChatFile|jobConversation|planMini' packages/ant-cli packages/ant-ui packages/ant-shared
```
- `packages/ant-cli/src/core/utils/sessionPaths.ts::getChatSessionPath` — 제거
- `packages/ant-cli/src/core/llm-response/SessionStore.ts::saveToChatFile` — 제거
- `packages/ant-cli/src/core/types/session.ts::SessionState.jobConversation` — 필드 제거
- code/design resolve · learn 노드 — `jobConversation` 로드/append 제거
- `packages/ant-cli/src/core/context/compactJob.ts` — jobConversation 시그니처 정리
- UI `packages/ant-ui/src/` — chat.json 소비 (16과 중첩되면 16에서 처리)

**단계**:
1. grep 결과 파일 리스트를 SessionPort 쪽부터 순차 제거
2. 컴파일 에러가 나면 그 파일을 열고 의존 심볼 제거 반복
3. 마지막에 `rg 'chat\.json|saveToChatFile|jobConversation|planMini' packages`로 0 확인 (테스트/문서 파일은 별도 판단)
4. 관련 세션 마이그레이션 경고: 기존 `chat.json` 파일이 있는 feature 폴더는 무시 또는 조용히 skip

**AC**:
- [ ] grep 게이트: 실행 코드(src/) 기준 결과 0
- [ ] 전체 빌드 통과: `pnpm build:cli`
- [ ] 전체 테스트 통과: `pnpm test:cli`
- [ ] 기존 타입 에러 27 → 감소 (jobConversation/planMini 관련 에러도 해소)

**검증**:
```bash
rg 'chat\.json|saveToChatFile|jobConversation|planMini' packages/ant-cli/src packages/ant-ui/src packages/ant-shared/src
# → 0개
pnpm build:cli
```

---

### 16. `ui_render_migration`  —  Phase D ✅

완료 상세: §3 "16. `ui_render_migration` ✅" 참조. 이 카드는 **후속(§16.2)** 과 함께 목표를 완수한다 — 본 카드가 trace SSOT 인프라(endpoints + slice + Activity/Timeline 뷰)를 깔고, §16.2가 legacy chat 경로를 완전히 치환한다.

**URL 규약 (정정)**: 원 플랜의 `/api/feature/:featureId/...` 표기는 기존 라우트 체계(`/api/projects/:id/features/:feature/...`)와 맞지 않아 전원 후자 패턴으로 구현·명시. §17 이후 모든 feature-scoped 엔드포인트는 이 패턴을 따른다.

구체 구현 경로:
- `GET /api/projects/:id/features/:feature/trace?sinceTs=...&jobTypes=code,design`
- `GET /api/projects/:id/features/:feature/breadcrumbs`

---

### 16.2. `chat_ssot_finalization`  —  Phase D

**Goal**: 기존 Chat 탭(ChatMessage + SSE `initial_state.chat.messages` + ChatService)을 trace.jsonl SSOT 기반으로 완전 치환. `chat.routes.ts`의 messages 경로(GET/DELETE/POST user-message/job-error/eval-save/dismiss-choice) 은퇴. triage_choice / decompose-choice UX를 trace 이벤트 + pending-choice endpoint 조합으로 재설계.

**선행 의존**: 16 (infrastructure 준비 완료)
**해금 대상**: Phase D 종료
**예상 범위**: L~XL (UI 채팅 전면 재배선 + 백엔드 라우트 다량 제거 + choice UX 재설계)

**Landmark 파일**:
- `packages/ant-cli/src/periphery/adapters/http/routes/chat.routes.ts` — 7 엔드포인트 (messages GET/DELETE, user-message, job-error, triage-choice, pending-choice, eval-save, dismiss-choice). 이 중 `pending-choice`와 `triage-choice` dispatch는 인터랙션이라 유지 권장, 나머지는 trace 이벤트로 치환 가능
- `packages/ant-cli/src/periphery/adapters/http/services/ChatService/` — index + SessionManager + 관련 구현체 전체. trace SSOT 전환 시 `chat.json` 영속성 경로는 제거, choice 메타데이터 경로만 필요시 별도 어댑터로 분리
- `packages/ant-cli/src/periphery/adapters/http/routes/sse.routes.ts` — `initial_state.chat.messages` emit 블록(현 `chatService.getMessagesAsync` 호출). trace HTTP로 대체 후 제거. 라이브 append 이벤트(`content_add` 등)는 남길지 trace 이벤트(file_write / assistant_message)로 통합할지 결정 필요
- `packages/ant-ui/src/domain/models/chat.ts` (`ChatMessage`) + `sseSlice.chatMessages` — ChatMessage 모델을 trace 기반으로 재정의하거나 `TraceLine` → `ChatMessage` 어댑터 계층 도입
- `packages/ant-ui/src/presentation/components/chat/ChatHistory.tsx` + `MessageItem.tsx` + `choiceCard/*` — `ChatMessage` 소비. trace 기반 데이터로 feed하도록 전환
- `packages/ant-ui/src/presentation/components/chat/ChatPanel.tsx` — 현재 Chat/Activity/Timeline 3-way 탭. Chat 탭이 trace 기반으로 전환되면 Activity 탭은 제거 가능(혹은 debug view로 유지)

**단계 (제안 순서)**:
1. **choice UX 조사**: triage_choice / decompose_choice / eval_save / cancelled 카드가 현재 ChatMessage.contents[].type으로 어떻게 실리는지 + pending-choice HTTP가 어떻게 소비되는지 정리. trace 스키마로 1:1 매핑 불가한 필드 목록화
2. **trace → ChatMessage 어댑터** (신규 `ChatMessageFromTrace.ts`): turnId 그룹 → ChatMessage (role/contents[] 재조립). 이 어댑터 결과가 기존 `ChatHistory`/`MessageItem`를 그대로 먹이도록
3. **pending-choice UI 분리**: choice 카드를 `chatMessages`에 섞지 않고 별도 상태로 분리(`pendingChoices: PendingChoice[]`). `GET /chat/pending-choice` 재사용
4. **SSE 스트림 정리**: `initial_state.chat` 제거, content_add 계열도 trace append 이벤트로 통합(`appendFeatureTraceLine` 활용). legacy SSE chat handler 단계적 삭제
5. **백엔드 라우트 제거**: `chat.routes.ts`에서 messages GET/DELETE, user-message, job-error, eval-save, dismiss-choice 삭제. triage-choice POST는 choice dispatch용으로 유지(혹은 `choice.routes.ts`로 이관)
6. **ChatService 은퇴**: chat.json 참조 / `getMessages*` / `addUserMessage` / `addJobError` / `updateLastContentMetadata` 제거. SessionManager의 chat.json 읽기도 제거
7. **Activity 탭 처리**: Chat 탭이 trace 기반이면 Activity는 중복 → 제거하거나 "Raw" debug view로 리네임

**AC**:
- [ ] ChatPanel의 Chat 탭이 `featureLogSlice.traceLines`로부터 렌더 (SSE initial_state.chat 미의존)
- [ ] `grep -r 'chat\.json' packages/ant-cli/src packages/ant-ui/src` → 0건
- [ ] `chat.routes.ts`에서 messages GET/DELETE/user-message/job-error/eval-save/dismiss-choice 엔드포인트 제거 (triage-choice / pending-choice는 유지 가능)
- [ ] ChatService export path 자체 제거 또는 pending-choice만 남은 slim 버전
- [ ] triage_choice / decompose_choice 카드 UX 회귀 없음 (수동 smoke)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
cd /Users/probe/dev/ant
pnpm build                   # ant-cli + ant-ui 전체
pnpm test:cli                # 전 vitest suites
rg 'chat\.json' packages/ant-cli/src packages/ant-ui/src     # 0건
rg 'chatService\.' packages/ant-cli/src                       # 필수 잔여(pending-choice/triage dispatch)만
```

---

### 17. `hard_reset`  —  Phase D

**Goal**: `POST /api/projects/:id/features/:feature/context/reset` 백엔드 + FeatureSection 헤더 리셋 버튼. `FileSessionAdapter.collapseAll('user_reset', jobId, turnId)` 호출로 feature.jsonl / trace.jsonl T2/T3 초기화 + `user_reset` boundary 라인 append.

**선행 의존**: 16 (`/trace` + `/breadcrumbs` 엔드포인트 + featureLog slice로 리셋 직후 UI 재로딩 경로 준비 완료)
**해금 대상**: (없음)
**예상 범위**: S (백엔드 라우트 1개 + 프런트 버튼 1개 + i18n 2개 로케일)

**URL 규약 주의**:
- 기존 라우트는 모두 `/api/projects/:id/features/:feature/...` 패턴. 원 플랜의 `/api/feature/:featureId/...` 표기는 폐기 — §16에서 `feature-log.routes.ts`도 동일한 `/api/projects/:id/features/:feature/{trace,breadcrumbs}` 패턴으로 구현됨
- `workspaceResolver.getFeaturePath(userContext, projectId, featureName)` 경유로 feature 경로 resolve → `FileSessionAdapter` 인스턴스 생성

**Landmark 파일**:
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts::collapseAll` (완료됨 — `feature.jsonl` / `trace.jsonl` 두 파일을 모두 collapse + feature.jsonl에 `user_reset` boundary append)
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` (§16 신규 — 동일 파일에 reset 라우트 추가하는 것이 자연. 또는 독립 `feature-context.routes.ts` 신설 고려)
- `packages/ant-cli/src/periphery/adapters/http/routes/chat.routes.ts::eval-save` — `extractUserContext(req)` + `workspaceResolver.getFeaturePath(...)` 패턴 참조
- `packages/ant-ui/src/presentation/components/FeatureSection/` (헤더 컴포넌트 위치)
- `packages/ant-ui/src/infrastructure/http/api/featureLog.ts` (§16 신규 — 동일 파일에 `resetFeatureContext` 클라이언트 추가 자연)
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` (§16 신규 — reset 직후 `clearFeatureLog()` + 재-fetch 흐름)

**단계**:
1. **백엔드 라우트** (`feature-log.routes.ts` 또는 신규 `feature-context.routes.ts`):
   ```ts
   router.post('/projects/:id/features/:feature/context/reset', async (req, res) => {
     const userContext = extractUserContext(req);
     const featurePath = deps.workspaceResolver.getFeaturePath(userContext, req.params.id, req.params.feature);
     const reason = (req.body?.reason as string) ?? 'user_reset';
     const jobId = `reset-${Date.now()}`;
     const turnId = `t-reset-${Date.now().toString(16)}`;
     const adapter = new FileSessionAdapter(featurePath, 'architect', req.params.id, req.params.feature);
     await adapter.collapseAll(reason, jobId, turnId);
     res.json({ success: true, reason, jobId, turnId });
   });
   ```
2. **프런트 API 클라이언트** (`featureLog.ts`): `resetFeatureContext(projectId, featureName, reason?)` → `apiPost`
3. **프런트 버튼** (`FeatureSection` 헤더): 리셋 아이콘 버튼 + 확인 다이얼로그 (i18n ko/en). 성공 응답 후 `clearFeatureLog()` + `loadFeatureTrace()` + `loadFeatureBreadcrumbs()` 재호출 — §16에서 준비된 경로 재사용
4. **(선택) SSE broadcast**: reset 이벤트를 Redis publish해 다른 pod/탭에서도 즉시 반영. 본 MVP 범위에서는 단일 pod + 탭 내 재-fetch로 충분

**AC**:
- [ ] 리셋 후 `loadSinceBoundary`가 빈 배열 반환 (user_reset boundary 이후 T2 비어있음)
- [ ] trace.jsonl의 기존 라인은 `collapsed=true`로 마킹되나 디스크 보존 (UI는 숨김, 감사/복구 여지 유지)
- [ ] 확인 다이얼로그 없이는 리셋되지 않음 (실수 방지)
- [ ] URL이 `/api/projects/:id/features/:feature/context/reset` 패턴 준수 (기존 라우트 규약 일관성)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
cd /Users/probe/dev/ant/packages/ant-cli
pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'   # 27 baseline
pnpm vitest run                                     # regression 없음
# 수동 smoke: 리셋 → Activity/Timeline 탭이 즉시 비고, 다음 user_turn부터 새 boundary 이후로 누적
```

---

### 18. `tier_ui_badge`  —  Phase D

**Goal**: user_turn 메시지 옆 뱃지로 `mode · complexity · decidedBy · reason` 표시. 읽기 전용.

**선행 의존**: 16 (§16의 `TraceActivityView`가 turnId 그룹 렌더링 + turn 헤더 자리 이미 준비됨)
**해금 대상**: (없음 — §16.2에서 Chat 탭이 trace-derived로 치환되면 거기에도 자연 적용됨)
**예상 범위**: S (백엔드 user_turn_meta 전송 + 프런트 Badge 컴포넌트 1개 + 병합 로직)

**URL 규약 주의**:
- 현재 `/api/projects/:id/features/:feature/breadcrumbs` 엔드포인트는 breadcrumb만 반환. `user_turn_meta`도 UI에 필요하므로 옵션 2개:
  - (A) 기존 `/trace` 엔드포인트에 user_turn_meta를 feature.jsonl로부터 합쳐 반환 (Trace Line 유니온 확장)
  - (B) 신규 `/features/:feature/user-turn-meta` 또는 `/features/:feature/feature-log` (user_turn + user_turn_meta + breadcrumb 통합) 엔드포인트 추가
- 어느 쪽이든 **URL은 반드시 `/api/projects/:id/features/:feature/...` 패턴 유지**

**Landmark 파일**:
- `packages/ant-ui/src/presentation/components/chat/feature-log/TraceActivityView.tsx` (§16 신규) — turn 헤더에 `{jobType, turnId, firstTs}` 렌더 중. 여기에 `mode / complexity / decidedBy / reason` 배지 행 추가하는 것이 최소 변경
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` (§16 신규) — user_turn_meta 저장 필드 추가 필요 (현재 traceLines + breadcrumbs만 보유)
- `packages/ant-shared/src/session-log.ts` — `FeatureUserTurnLine.mode` (이미 있음) / `FeatureUserTurnMetaLine.{complexity, decidedBy, reason}` (이미 있음) SSOT
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts::loadSinceBoundary` — `userTurnMetas` 포함 반환 중 (이미 존재). HTTP 라우트에서 이 결과를 노출하면 됨
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` (§16 신규) — 여기에 `/user-turn-meta` 라우트 추가하거나 기존 `/breadcrumbs` 응답 shape 확장

**단계**:
1. **백엔드**: 선택한 엔드포인트 옵션에 따라 `FileSessionAdapter` 결과를 HTTP로 노출 (기존 `loadSinceBoundary`의 userTurns/userTurnMetas 재사용)
2. **프런트 슬라이스 확장**: `featureLogSlice`에 `userTurnMetas: FeatureUserTurnMetaLine[]` 추가 + fetch 액션
3. **병합 로직**: `TraceActivityView`의 turn 헤더에서 `turnId` 기준으로 user_turn(mode) + user_turn_meta(complexity/decidedBy/reason) join
4. **Badge 컴포넌트**: 4개 필드 중 존재하는 것만 표시 (mode / complexity / decidedBy / reason). 값별 색상 토큰 (예: mode=explain→회색, generate→emerald, refactor→purple)
5. 클릭 토글/overrule은 구현 금지 (후속 플랜)

**AC**:
- [ ] 뱃지가 `TraceActivityView` turn 헤더마다 표시 (해당 turnId에 mode 또는 meta가 있을 때만)
- [ ] meta 누락 시 해당 필드만 생략 (UI 무너지지 않음)
- [ ] 읽기 전용 (onClick 핸들러 없음)
- [ ] URL이 `/api/projects/:id/features/:feature/...` 패턴 준수
- [ ] 내 수정 파일 타입 에러 0

**검증**: `pnpm build:ui` + 수동 smoke (§16 Activity 탭 열어 turn 헤더 확인)

---

### 19. `misclassify_guard`  —  Phase E

**Goal**: `core/utils/featureBiases.ts` 신규 — learn 노드에서 초기 complexity 판정 vs 실제 결과(touched 수, escalate 발생)를 비교해 `{featurePath}/featureBiases.json`에 누적. 본 플랜은 **데이터 수집만**.

**선행 의존**: 10 (`_promotedThisJob` 존재), 12 (touched 집계 헬퍼)
**해금 대상**: (후속 heuristic/overrule 플랜의 입력)
**예상 범위**: S (신규 파일 1개 + learn 노드 호출 1곳)

**Landmark 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts`
- `packages/ant-cli/src/periphery/adapters/filesystem/` — JSON read/write 패턴

**단계**:
1. `featureBiases.ts`: `recordClassification({ featurePath, predictedComplexity, actualTouched, escalated })` append
2. learn 노드에서 해당 호출 추가 (`_promotedThisJob === true`이거나 touched > threshold인 경우만 기록)
3. 파일 구조: `[{ ts, jobId, predicted, actualTouched, escalated, directive?: string }]` append-only JSON array

**AC**:
- [ ] 파일이 없으면 빈 배열로 초기화
- [ ] append는 read-modify-write로 atomic 처리 (또는 JSONL로 변경)
- [ ] 읽기 측 코드는 이 todo에서 작성하지 않음 (MVP 범위 외)
- [ ] 내 수정 파일 타입 에러 0

**검증**:
```bash
pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'
```

---

### S1. `philosophy_doc`  —  선택

**Goal**: `docs/architecture/18-session-redesign.md` 신규 — 세 직교 축 + Mode×Complexity 매트릭스 + 5-Tier 매핑 + schema 예시 + 마이그레이션 노트.

**선행 의존**: (없음 — 언제든)
**해금 대상**: (없음)
**예상 범위**: M (문서 1개, 15~30 분량)

**Landmark 파일**:
- 본 문서 §2 (아키텍처 요약)
- 원 플랜 (상세 스펙)
- `.claude/skills/update-docs/SKILL.md`

**AC**:
- [ ] §2 내용을 docs/architecture 톤으로 확장
- [ ] 스키마 JSON 예시 포함 (feature.jsonl / trace.jsonl 각 라인 타입)
- [ ] 기존 00~17 문서와 링크 일관성

---

### S2. `diagnose_injection`  —  선택

**Goal**: 현재 jobConversation/sessionDigest가 실제로 프롬프트에 얼마나 주입되는지 실측. `docs/architecture/18-session-redesign.md` 부록 또는 별도 MD.

**선행 의존**: (없음)
**해금 대상**: philosophy_doc 보강

**Landmark 파일**:
- 기존 프롬프트 빌더 로그(`logPrompt`) 출력
- resolve/plan/execute 프롬프트 렌더 지점

**AC**:
- [ ] 표본 job 3개 이상에서 jobConversation / sessionDigest 문자 수 측정
- [ ] 결과를 문서화 (차트 생략 가능, 텍스트 표)

---

## 6. 검증 현황 (2026-04-20 기준)

| 검증 항목 | 결과 |
|---|---|
| 내가 수정/생성한 파일들의 TypeScript 에러 | **0** ✅ |
| 전체 타입 에러 (ant-cli 기준) | **27** (baseline 동결, §3 완료 todos와 무관한 선행 에러) |
| `tests/triage-prompt.test.ts` (snapshot) | 3/3 통과 ✅ |
| `tests/triage-parser.test.ts` | 30/30 통과 ✅ |
| `tests/verification/unit/breadcrumb.test.ts` (§12) | 15/15 통과 ✅ |
| `tests/verification/unit/compactFeatureContext.test.ts` (§13) | 5/5 통과 ✅ |
| `tests/verification/unit/fileSessionAdapter-log.test.ts` (§16) | 6/6 통과 ✅ |
| 전체 vitest (ant-cli) | **56 suites / 1254 tests** 통과 ✅ |
| `pnpm build` (ant-ui) | 성공 — dist 산출, pre-existing warning만 ✅ |

> **각 카드 공통 검증**:
> ```bash
> cd /Users/probe/dev/ant/packages/ant-cli
> pnpm exec tsc --noEmit 2>&1 | grep -c 'error TS'   # 27 이하 유지
> pnpm vitest run                                     # regression 없음
> ```

## 7. 중요 설계 결정 (SSOT)

### D1. direct 노드는 execute 재사용 안 함
- 이유: execute는 `currentTask` 필수, 강결합
- 대신: **독립 구현 + 공용 유틸 추출** (`nodes/shared/` 신설)
- 공유 대상: `invokeLLMWithTools`, `runToolCallsAndCollect`, `parseLLMResponse`

### D2. user_turn은 append-only 유지
- complexity 메타는 **패치 라인** (`user_turn_meta`)으로 추가
- resolve가 로드 시 turnId 기준 병합

### D3. orchestrator가 user_turn 기록 책임자
- 헬퍼: `composition/recordUserTurn.ts`
- LangGraph invoke 직전 한 번만 호출
- jobType 기반 `skipFeature` 자동 결정

### D4. Runtime escalate는 LangGraph 조건부 엣지
- pending 기반 아닌 즉시 재진입
- `_promotedThisJob` + recursionLimit + recursionCount 3중 가드

### D5. design job은 저장 레이어만 개선
- design 내부 sub-graph(ui-design/system-design/spec)는 건드리지 않음
- Mode × Complexity 매트릭스 미적용 (후속 플랜)

### D6. CONV_KEYS.NODE_DIRECT 신설
- execute와 생명주기 다름 → `applyRetention` 정책 분리 필요

### D7. trace.jsonl 역할 정확화
- **UI 표시 전용**. 맥락 전달 대상 아님
- "다음 turn에 tool result 미주입"은 resolve가 feature.jsonl만 읽기 때문
- 모든 jobtype에서 동일하게 전체 이벤트 기록

### D8. Ask jobtype은 feature.jsonl 미기록
- 맥락 전달 대상 아님
- trace.jsonl에만 기록 (UI 연속성)

### D9. Spec clarify는 Decompose 소유
- 구 triage의 design redirect 로직은 삭제됨 (`triage_scope_cleanup` 완료)
- `complexity='todo'` + `mode≠explain` + spec/systemDesign 부재일 때만 발동

### D10. Heuristic/Overrule 제외
- regex 신뢰 불가 + overrule은 후속 플랜
- MVP는 **LLM 판정만**

### D11. Tier 내부 균일성 (같은 Tier = 같은 프롬프트)
- 5-Tier는 Mode × Complexity 판정의 최종 셀. 동일 Tier로 라우팅된 실행은 **같은 파이프라인 + 같은 프롬프트**를 사용
- Phase 노드 렌더 시 **런타임 관측치(`taskQueue.size`, touched 수 등)를 근거로 프롬프트를 if/else 분기하지 않는다**. 이는 템플릿 레벨에서 sub-tier를 암묵 생성하는 반패턴 (SSOT 분열, FPOP의 edge-case enumeration 위반)
- task=1 같은 corner case는 LLM의 instruction-following에 위임. 실측 문제 발생 시 **프롬프트 서술을 task-count 중립적 원칙으로 리팩토링**하는 것이 대응 (별도 파일·별도 분기 X)

---

## 8. FPOP 원칙 준수 (프롬프트 작성 시)

모든 신규/수정 프롬프트는 다음 원칙 준수:

| 원칙 | 의미 |
|---|---|
| Principles over Examples | 구체 예시 금지, 범용 규칙만 |
| What over How | 관찰 대상만 명시, 방법 열거 금지 |
| Observable over Assumed | 관찰 요구, 추론 금지 |
| Universal over Specific | 플랫폼/언어 중립 |
| Constraints over Instructions | 긍정형 "해라"를 선호하되, **맹점 경고만** 부정형 허용 |
| Reminders for Blind Spots | 쉽게 놓치는 것만 ⚠️ |

**안티패턴 금지 예**:
- ❌ "이건 여기서 하지 마세요. 다른 노드에서 해요." — LLM이 모르는 내용을 굳이 꺼냄
- ❌ 구체 코드 예시 ("Footer는 row입니다")
- ❌ Value mapping ("Top=flex-start")

---

## 9. 커밋 관례

각 Phase 완료마다 커밋:
```
git commit -m "$(cat <<'EOF'
feat(session): <todo-id> - <한 줄 요약>

<변경 상세 2-3줄>

Refs: docs/tmp/session-redesign-handoff.md
EOF
)"
```

---

## 10. 참조

- **원 플랜 (상세 스펙)**: `/Users/probe/.cursor/plans/ant_5-tier_execution_model_cc518235.plan.md`
- **프로젝트 규칙**: `/Users/probe/dev/ant/.cursorrules`, `/Users/probe/dev/ant/CLAUDE.md`
- **주요 코드 랜드마크**:
  - 세션 경로: `packages/ant-cli/src/core/utils/sessionPaths.ts`
  - 어댑터: `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts`
  - 포트: `packages/ant-cli/src/core/ports/session.ts`
  - 공유 타입: `packages/ant-shared/src/session-log.ts`
  - orchestrator: `packages/ant-cli/src/composition/orchestrator.ts`
  - recordUserTurn 헬퍼: `packages/ant-cli/src/composition/recordUserTurn.ts`
  - state 채널: `packages/ant-cli/src/agents/architect/graph/code/state.ts`
  - graph 배선: `packages/ant-cli/src/agents/architect/graph/code/graph.ts`
  - routing: `packages/ant-cli/src/agents/architect/graph/code/routing.ts`
  - Decompose: `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts`
  - Detect: `packages/ant-cli/src/agents/common/graph/nodes/detect/index.ts` (변경 안 함)
  - Triage: `packages/ant-cli/src/agents/common/graph/nodes/triage/index.ts` (변경 안 함)
  - Triage 프롬프트: `packages/ant-cli/src/core/prompt/templates/jobs/shared/nodes/triage/variants/default/rules.md`
