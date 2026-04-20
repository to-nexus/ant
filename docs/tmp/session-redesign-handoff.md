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
| 전체 todos | 19개 + 선택 2개 (§16.2 follow-up 신규) |
| 완료 | **19개 필수 + 2개 선택 (S1/S2)** |
| 진행 중 | 0 |
| 남음 | **0개** (본 플랜 완전 종료) |
| Phase B | ✅ **종료** (Mode × Complexity MVP 동작) |
| Phase C | ✅ **종료** (3/3 완료 — resolve_integrate ✅ · breadcrumb_tiered_policy ✅ · compaction_policy ✅) |
| Phase D | ✅ **종료** (5/5 완료 — legacy_cleanup ✅ · ui_render_migration ✅ · chat_ssot_finalization ✅ · hard_reset ✅ · tier_ui_badge ✅) |
| Phase E | ✅ **종료** (1/1 완료 — misclassify_guard ✅) |
| 선택(S1/S2) | ✅ **종료** (2/2 완료 — philosophy_doc ✅ · diagnose_injection ✅ → `docs/architecture/18-session-redesign.md`) |
| 베이스 커밋 | `8277b313 feat: code verification hardening, tech-tier hints, preview/deploy` |
| 내 수정 파일 타입 에러 | 0 |
| 기존 브랜치 선행 에러 (내 작업과 무관) | 26개 (§18 이후, baseline 27에서 1 감소 — §19 변화 없음, §19 후속 F1·F2·F3 완료 후에도 26 유지) |

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

## 3. 완료된 Todos (19개)

### ✅ 1) `feature_jsonl_schema` + `trace_jsonl_schema`

**신규 파일**:
- `packages/ant-shared/src/session-log.ts` — 라인 타입 전체 + 상수 (`Complexity`, `SpecClarify`, `BREADCRUMB_THRESHOLDS` 등)

**수정 파일**:
- `packages/ant-shared/src/index.ts` — `export * from './session-log'` 추가
- `packages/ant-cli/src/core/utils/sessionPaths.ts` — `getFeatureJsonlPath()`, `getTraceJsonlPath()` 추가. `getChatSessionPath()`는 `@deprecated` 마킹 (이후 §14 `legacy_cleanup`에서 함수 자체 삭제됨 → 현재 파일에는 존재하지 않음)

**주요 타입** (shared/session-log.ts):
- `FeatureUserTurnLine` (필드명 `text` — `TraceUserTurnLine.text`와 통일, post-review fix), `FeatureUserTurnMetaLine`, `FeatureBreadcrumbLine`, `FeatureBoundaryLine` (`reason: 'auto_job_complete_todo' | 'user_reset' | (string & {})` — literal 가이드 보존, post-review fix) (`FeatureLine` union)
- `TraceUserTurnLine`, `TraceThinkingLine`, `TraceToolCallLine`, `TraceFileWriteLine`, `TraceRunCommandLine`, `TraceJobStatusLine`, `TraceAssistantMessageLine` (`TraceLine` union)
- `SpecClarify` (Decompose가 output할 design redirect choice. `needsChoice: true`는 파서 검증 토큰 — 의도적 유지, JSDoc 명시)
- 상수: `FEATURE_CONTEXT_THRESHOLD`, `FEATURE_CONTEXT_WINDOW`, `BREADCRUMB_THRESHOLDS`, `BREADCRUMB_LIMITS`, `DIRECT_LOOP_LIMITS` (post-review: `nodes/direct/index.ts`가 `import` 후 사용 — SSOT 일원화), `PROMOTION_TOUCHED_THRESHOLD`

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

**사후 결함 검토 (2026-04-20)**:

| 등급 | 항목 | 상태 |
|---|---|---|
| P1 | `orchestrator.ts`에서 `recordUserTurn` 직후 호출되는 `runPlanGraph`(라인 458) / `runVisualGraph`(라인 531)가 여전히 `isResume ?? !!(overrideDirective && jobId)` 레거시 휴리스틱 사용. 같은 함수 내 주석(423–429)이 "false-positive trap — producing duplicate user_turn lines"로 지정해 `recordUserTurn`에서는 제거했던 로직이 바로 아래 호출에 잔존 → direct caller가 `overrideDirective && jobId`만 세팅한 시나리오에서 `recordUserTurn`은 신규 append, 플랜/비주얼 러너는 resume으로 처리하는 정확히 그 "duplicate" 재현 | ✅ 수정 (두 라인 모두 `isResume` 직접 전달, runPlanGraph는 내부 session.interruption + `isEnvResume()` 폴백 보유하므로 회귀 없음) |
| P2 | `cli/resume-job-cli.ts`(verification scenario child)는 `input: ''`·`jobId` 미세팅·`isResume` 미세팅으로 orchestrator 호출. 챕터 3의 `recordUserTurn` 삽입 이후 이 하네스가 시나리오 실행마다 `feature.jsonl`에 `text=''`·`jobId='unknown'`의 공(空) user_turn append → 시드 오염 + 무의미 mutex 경합. 파일 docstring이 "resume harness"라 설계상 `isResume: true`가 맞음 | ✅ 수정 (`isResume: true` 전달 — recordUserTurn은 append 스킵하고 turnId 복원만 수행) |
| P3 | `creator/visual` 경로에 `recordUserTurn` 미호출 | ⏸ **설계 범위 외** — 챕터 3 AC는 inline-ask/design/code/plan 4개 경로로 한정. §2.4 매트릭스도 visual 미포함. 후속 플랜에서 Mode×Complexity 확장 시 동시 처리 |
| P3 | triage 내부 `runAskGraph`가 trace.jsonl `ask-only` 사본을 emit하지 않음 | ⏸ **AC 명시적 MVP 범위 외** (원 handoff "미완료 (후속 처리)" 블록에 기록됨) |
| 검증 제외 | inline-ask recordUserTurn 호출이 `session` 인자 없이 FileSessionAdapter를 새로 구성 (design/code/plan과 비대칭) | ✅ FileSessionAdapter 생성자의 path-parsing fallback이 `featuresIdx` 기준으로 정상 작동 — skipFeature=true이므로 trace.jsonl만 기록, 동시성 mutex도 per-instance라 문제 없음 |
| 검증 제외 | `jobId: jobId \|\| 'unknown'` 폴백이 4개 경로 모두에 존재 → 여러 'unknown' user_turn 공존 시 `resolveResumeTurnId`의 exact-match 실패 | ✅ 모든 production caller(job-runner)가 jobId를 필수로 설정, CLI 경로는 resume 시나리오 없음 — 실질 영향 없음 |
| 검증 제외 | 코드 경로에서 `mode`가 orchestrator params로 전달되지만 `recordUserTurn`의 resume 분기는 mode를 소비하지 않음 → 재개 시 user_turn의 mode 미갱신 | ✅ D2(append-only) 설계 준수, user_turn은 immutable — 의도된 동작 |

재검증: `tsc` baseline **27 유지** / vitest **60 suites · 1283 tests 전부 통과** / 수정 파일 린트 에러 0.

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

**사후 결함 검토 (2026-04-20)**:

| 등급 | 항목 | 상태 |
|---|---|---|
| P1 | Triage 프롬프트 `base.md`의 `### Spec Documents` 섹션(`hasSpecDocs` / `specDocCount` / `specDocNames` 주입)이 잔존. Step 6.2 "Scope Breadth + Spec Check"가 삭제되면서 rules.md 어디에서도 이 데이터를 관찰 타겟으로 삼지 않음 → FPOP의 "data without rule = noise" 위반 + LLM 컨텍스트 낭비. `WorkspaceState` 필드 자체는 Decompose(`specClarify`)/Detect(`strategy`)가 legitimate하게 소비하므로 유지, **triage 프롬프트 injection에만 국한 제거** | ✅ 수정 (`base.md` Spec Documents 블록 제거 + `index.ts::buildTriagePrompt`의 `hasSpecDocs`/`specDocCount`/`specDocNames` 3개 변수 제거 + 스냅샷 갱신) |
| P3 | Step 5 관찰 텍스트 "(system design, UI specification)"이 `hasDesignDoc` aggregate(spec docs 포함)과 의미 불일치. spec-only 워크스페이스에서 "❌ No UI spec + ❌ No system design + ✅ Design documents exist" 모순 렌더 가능 | ⏸ 챕터 4 스코프 외 — 후속 triage FPOP 다듬기 라운드에서 정비. 현재 동작 영향은 드물고 명확하지 않음 |
| 검증 제외 | `TriageResult` 타입에 `scopeBreadth` / `modificationIntent` / `scopeAnalysis` 필드 잔존 가능성 | ✅ 파서/타입 모두 0건 확인 |
| 검증 제외 | `Step 6` / `Step 7` / `Step 8` 경계 referential integrity ("STOP — skip Steps 3–7", "Steps 4–5", etc.) | ✅ rules.md + CRITICAL REMINDERS 전체 일관 |
| 검증 제외 | 삭제된 Note "Scope breadth ... NOT decided here" (FPOP 부정형 안티패턴) 잔존 | ✅ rules.md + 스냅샷 둘 다 0건 |
| 검증 제외 | `design.yaml` 및 그 snapshot의 "Multi-boundary" 표현 (spec mode 설명) | ✅ spec mode의 legitimate scope 기술 — Step 6 잔재 아님 |

재검증: `tsc` baseline **27 유지** / vitest **61 suites · 1287 tests 전부 통과** / 수정 파일 린트 에러 0.

**설계 방향 확인**:
- 범위/스펙 판정 책임을 Triage → Decompose로 이관한 것은 handoff D9 결정과 일치
- `code` job 외(`design`/`plan`)에서 modification + multi-boundary 요청은 Triage Step 5에서 `target=code` → redirect 후 code의 Decompose가 `specClarify` emit하여 design으로 재제안하는 2-step flow로 수렴 (이전 1-step 대비 UX 라운드 추가되나 의미적 regression 아님, Decompose가 더 풍부한 signal로 판정)

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
- ~~`updateArtifacts` 세션 저장 블록의 `state: {...} as any` 캐스트~~ → **해결됨** (2026-04-20 복검). `SessionState`에 `awaitingDecomposeClarify` / `complexity` / `directHints` / `directMode` / `specClarify` / `_specClarifyBypassed` / `_promotedThisJob` / `needsEscalation` 필드 추가, decompose/index.ts 및 runner.ts의 `as any` 캐스트 제거. §14 legacy_cleanup이 누락한 정리를 §5 복검에서 반영
- **방어 로직 추가** (2026-04-20 복검): `directMode`가 truthy인데 LLM이 `<tasks>`를 실수로 비우지 않은 경우 `validateTasks` / `createTaskQueue`에서 "final verification missing" 예외로 중단되던 문제 → 경고 로그와 함께 tasks 배열을 초기화해 direct 노드 경로 유지

**AC 달성**:
- [x] 5개 matrix 케이스가 decompose 출력으로 구분 가능 (6행 매트릭스 — generate/refactor oneshot vs exploratory 분리 포함)
- [x] 파서 실패 시 safe default = `complexity: 'todo'` (`normalizeComplexity()` + 태그 부재 경고)
- [x] 프롬프트에 FPOP 위반 없음 (관찰 타겟 + 원칙 + 제약 + blind spot, 구체 예시·edge case 열거·플랫폼 한정어 없음)
- [x] 내 수정 파일 타입 에러 0 (총 27개로 baseline 유지)
- [x] triage-prompt.test.ts 3/3 + triage-parser.test.ts 30/30 재실행 통과 (regression 없음)

**⚠️ 검증 미완**: ~~새 스키마 파서의 단위 테스트 없음~~ → **해결됨** (2026-04-20 §5 복검). `packages/ant-cli/tests/decompose-responseParser.test.ts` 23 tests 추가 (complexity matrix incl. safe-default/case-insensitive/unknown → todo, complexityReason, directHints targetFiles/explorationScope/malformed JSON, specClarify 필수 필드·타입 검증, output-shape 매트릭스 sanity). 전체 vitest 1310/1310 그린.

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

**사후 결함 검토 (2026-04-20)**:

| 등급 | 항목 | 상태 |
|---|---|---|
| P0 | Decompose 두 short-circuit 블록(`clarifyCtx.clarifySent` L412-438, `specClarify && !_specClarifyBypassed` L471-508)이 `updateArtifacts({ state: {...}})`로 세션을 갱신하는데, `FileSessionAdapter.updateArtifacts`는 내부에서 `session.state = state` (L263) 전면 교체. 결과 `jobId / jobTiming / tokenUsage / estimatingTokenUsage / profile / designDocUnknownPackages / userLanguage / _promotedThisJob` 등 prior 필드 전부 **유실**. `/decompose-choice proceed_without_spec`로 resume 시 (1) `sessionJobId` undefined → jobId 일치성 guard(L643) 우회 (2) runner.ts ANT_IS_RESUME 경로는 이들 필드를 복원하지 않아 timing 연속성 상실 + decompose-phase 토큰 회계 유실. §3.7 설계 의도("bypass는 session 파일에 영속") 위반 | ✅ 수정 (두 short-circuit 모두 `await session.load(...)` 선행 → `...(existing?.state \|\| {})` 스프레드로 병합해 `updateArtifacts` 호출. 어댑터 API 변경 없이 wipe 방지) |
| P1 | `rules.md` Spec Clarify checkpoint 표(L78-83) 극성 불일치. Mode/Complexity 행은 "관찰=true → 발동 방향"인데 Design/Spec 행은 "populated? / directive-relevant entry exists?"로 "관찰=true → 발동 **차단** 방향" — LLM이 두 행만 mental inversion 필요. FPOP "Observable over Assumed" + 일관된 신호 원칙 위반 | ✅ 수정 (4개 질문 모두 "yes = emit 방향"으로 통일: `Design absent` / `Spec absent`로 rename, `Principle`에 "all yes together" 명시) |
| P1 | `/decompose-choice` cancel 분기(L720-736)가 idempotency lock 해제를 생략. `proceed_without_spec`는 `ant:job-completed` / `ant:job-event:*:completed` / `ant:job-event:*:failed` 3개 해제하는데 cancel은 `markUserStopped + updateJobStatus + cleanupJobState`만 실행 — 비대칭. 동일 jobId 재사용 시 stale lock blocking 가능성 | ✅ 수정 (cancel 분기에도 동일 3개 lock release 추가) |
| P2 | `/decompose-choice` 라우트가 `fs.readFileSync` + `fs.writeFileSync` 직접 호출(L630, L691)로 `FileSessionAdapter`의 per-file mutex(Chapter 2 atomic_user_turn_write) 우회. Chapter 16 `feature-log.routes.ts`의 `new FileSessionAdapter(...)` 패턴과 불일치. pause 중 writer 없다는 실측상 안전하지만 설계 일관성 깨짐 | ✅ 수정 (read/write 모두 `FileSessionAdapter` 경유. 한 번 로드한 `sessionData/sessionState`를 proceed_without_spec 분기에서 재사용해 race 최소화) |
| 검증 제외 | `_specClarifyBypassed` 재진입 후 정상 decompose 완료 시 stale 잔존 여부 | ✅ `updateArtifacts`의 현행 wholesale replace 의미가 `saveCheckpoint` 경로에서 해당 필드를 자동 비움(다음 saveCheckpoint가 쓰지 않음) — P0 수정은 short-circuit 경로에 국한되므로 이 클리어 동작은 보존 |
| 검증 제외 | `<complexity>` 태그가 `specClarify` emit 시에도 `todo` 유지되는지 | ✅ 파서/rules.md blind spot 블록(L116)에서 명시적으로 `todo` 보존 — short-circuit return 경로(L500-507)가 `complexity` 그대로 통과 |
| 검증 제외 | 4-AND checkpoint 중 하나라도 거짓이면 `<specClarify>` omit | ✅ rules.md L95 constraint "OMIT entirely" + 파서(L268-285)가 `needsChoice === true` + 3 action 필수 검증으로 2중 방어 |
| 검증 제외 | `specClarifyBypassed` enrichedVars 주입(L293) + rules.md `{{#if specClarifyBypassed}}` 블록(L97-99) | ✅ handoff 기대 동작 일치 |

재검증: `tsc` **26 유지** (baseline 27 이하 — 내 수정 범위 0 증분) / vitest **63 suites · 1319 tests 전부 통과** (decompose-responseParser 23 + 기존 regression) / 수정 파일 린트 에러 0.

**설계 방향 확인**:
- 수정은 "session 파일이 영속 저장소" 설계(§3.7 decompose_spec_clarify)를 보강. wipe 버그 제거로 pause→choice→resume 경로 전체가 jobTiming/tokenUsage 연속성을 유지한 상태로 복원됨
- `updateArtifacts` API 자체는 건드리지 않음 (다른 caller들은 대부분 `saveCheckpoint` 경유로 comprehensive state를 쓰므로 현행 replace semantics가 문제되지 않음). 범위를 short-circuit 2곳 + 라우트 1곳으로 한정해 리그레션 위험 최소화

**2차 복검 (2026-04-20 재진입)**:

| 등급 | 항목 | 상태 |
|---|---|---|
| P1 | `/decompose-choice proceed_without_spec` 분기가 idempotency lock 3개를 `executeJob` **호출 전**에 해제. 같은 파일 L426-430의 표준 `/resume` 주석("Clear idempotency locks AFTER executeJob so old BullMQ job is removed first (inside enqueue). This closes the stale-event window and ensures locks stay intact if executeJob throws.")과 정면 불일치. executeJob 실패 시 락만 선공 해제되어 stale completion event가 guard 우회 가능 + BullMQ 재큐 전 구간에 락이 없음 | ✅ 수정 (lock 3개 해제를 `executeJob` 완료 이후로 이동. 해제 시 `sessionJobId || jobId`로 일관된 키 사용) |
| P1/FPOP | `rules.md` Spec Clarify checkpoint 표의 "Design absent" / "Spec absent" 질문이 `section empty (no entries)` 표현을 사용. 실제 `base.md` 렌더 로직은 `{{#if designDocsMeta}}` / `{{#if hasSpecDocs}}`로 **섹션 자체를 조건부 생성** — 문서가 없을 때는 "빈 섹션"이 아니라 "섹션 부재". LLM이 "섹션 없음"을 "empty"로 매핑해야 하는 암묵 추론 강제 → **Observable over Assumed** 원칙 위반 | ✅ 수정 (두 질문 모두 "section missing entirely OR lists no documents" / "section missing entirely OR listed entries do not relate" 형태로 관찰 가능한 두 경우를 명시. "Absence is the signal" blind spot 추가로 "unknown/probably elsewhere" 추론 차단) |
| 검증 제외 | cancel 분기의 lock 해제 (L742-745, handoff §7 P1에서 추가) | ✅ proceed_without_spec과 대칭 유지용으로 남김. 표준 `/stop`은 lock을 해제하지 않지만 cancel은 terminal 경로라 eager-release가 안전(이미 status=failed) |
| 검증 제외 | `/decompose-choice proceed_without_spec`에서 `awaitingDecomposeClarify=true`가 session에 잔존 | ✅ 의도된 동작. `routeAfterResolve`가 `awaitingDecomposeClarify && (overrideDirective \|\| _specClarifyBypassed)` 조건으로 direct-to-decompose 분기하는 게이트. 재진입 후 decompose의 `updatedState.awaitingDecomposeClarify = false`(L843) + `saveCheckpoint`가 이 필드를 sessionState에 안 쓰므로 자연 소거 |
| 검증 제외 | LangGraph state 채널의 `specClarify` / `complexity` / `directHints` / `_specClarifyBypassed` 기본 reducer 및 ANT_IS_RESUME 복원(runner.ts L158-167) | ✅ runner.ts가 세션에서 `_specClarifyBypassed=true` + `awaitingDecomposeClarify=true`를 graph.ts Annotation 기반 초기 상태로 주입 → `routeAfterResolve` 게이트 통과 확인 |
| 검증 제외 | `proceed_without_spec` 재진입 후 LLM이 `<specClarify>` 재발화하는 경우 | ✅ ① prompt `{{#if specClarifyBypassed}}` 블록이 "Do NOT emit" 지시 ② short-circuit 조건 `specClarify && !_specClarifyBypassed` → 진입 차단 ③ 정상 경로 `updatedState.specClarify = undefined`(L842)로 graph state 소거 — 3중 방어 |

재검증: `tsc` **26 유지** / vitest **63 suites · 1319 tests 전부 통과** / 수정 파일(job.routes.ts, rules.md) 린트 0.

**설계 방향 재확인**:
- lock 해제 순서 수정은 "resume = executeJob 후 lock 해제" 불변식(Chapter `/resume` 경로 SSOT)을 §3.7에 적용. proceed_without_spec도 의미상 resume이므로 동일 불변식이 적용돼야 함
- rules.md 재서술은 FPOP의 "Observable over Assumed"를 엄격 준수. Handlebars 조건부 렌더 구조상 "section absent" = "no documents"임을 LLM이 추론으로 연결하게 두지 말고, 두 상태를 명시적으로 OR 결합해 관찰 레이어에서 균일하게 만듦. 어떤 base.md 렌더 경로에서도 checkpoint가 동일한 방식으로 관찰됨

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

**사후 결함 검토 (2026-04-20)**:

| 등급 | 항목 | 상태 |
|---|---|---|
| P0 | **1-shot escalation cap이 실제로는 0-shot이었음**. §10 `runtime_escalate` 카드가 direct 노드 return에서 `needsEscalation=true`와 `_promotedThisJob=true`를 **atomic**으로 세팅 (`promoteThisJob = needsEscalation && !state._promotedThisJob`)하고 있었다. LangGraph 조건부 엣지는 **머지 이후 state**를 받으므로, 첫 escalation 직후 라우터가 본 값은 `needsEscalation=true, _promotedThisJob=true` — `needsEscalation && !_promotedThisJob` 가드는 **항상 false**. 따라서 decompose 재진입 경로가 한 번도 발동하지 않고 모든 1차 escalation이 즉시 `learn`으로 수렴. 원 플랜 §4.12의 의사코드 자체가 동일 결함을 포함 → 구현 직후 감지 못함. | ✅ 수정 |
| 수정 내역 | `nodes/direct/index.ts`: entry에서 `wasEscalationReentry = state.needsEscalation === true && state._promotedThisJob !== true` + `effectivePromoted = state._promotedThisJob === true \|\| wasEscalationReentry` 계산. 루프 가드를 `!effectivePromoted && shouldEscalate(...)`로, return을 `{ needsEscalation: needsEscalation ? true : false, _promotedThisJob: effectivePromoted, ... }`로 교체. **의미 변경**: `_promotedThisJob`은 "direct가 escalation 이후 재진입됐음"을 뜻하며, 1차 escalation 시점엔 **flag=false 유지** → 라우터가 decompose로 정상 분기. `shouldEscalate.ts` 주석도 새 의미에 맞춰 동기화. | ✅ |
| 연쇄 P1 | `nodes/learn/index.ts`의 `recordClassificationBias`가 `escalated = state._promotedThisJob === true` 로만 판정. 신규 의미에서 decompose→plan/parallelOrchestrator 경로(2차 direct 미실행)면 flag=false로 남아 `escalated=false` 편향. | ✅ 수정 (`escalated = state._promotedThisJob === true \|\| state.needsEscalation === true` — 첫 escalation이 발사됐으면 `needsEscalation` 채널이 true로 남아 있어 정확히 탐지). |
| 재검증 | `tests/route-after-direct.test.ts` 신설 (7 case — 라우터 3종 + direct↔router lifecycle 4종, 재진입 플래그 전이 포함). `pnpm test` 64 suites / 1326 tests 전원 통과. `tsc --noEmit` baseline 26 유지 (수정 파일 신규 에러 0). | ✅ |
| 검증 제외 | direct 재진입 후에도 `state.needsEscalation=true`가 leftover로 남음 (decompose는 이 채널을 clear하지 않음). | ✅ 영향 없음 — 2차 direct entry는 이 leftover로 `wasEscalationReentry`를 감지하는 용도로 쓰고, 2차 return에서 `needsEscalation: needsEscalation === true ? true : false` 명시 기록으로 덮어쓴다. learn의 `escalated` 판정에는 오히려 유리. |
| 검증 제외 | decompose가 재진입에서 또 `<specClarify>`를 emit할 경우 `specClarify` 단락 회로로 __end__로 빠짐. | ✅ 설계 범위 외 — 사용자에게 다시 선택을 묻는 정상 플로우. Chapter 7 `decompose_spec_clarify`의 _specClarifyBypassed 기제가 재개 시 적용됨. |

재검증: vitest 64 suites / 1326 tests 전원 통과 · tsc baseline 26 유지 · 수정 파일 린트 에러 0.

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

**§13 검토 결과 및 수정 내용** (2026-04-20 복검):

발견된 결함:

🔴 **결함 1 (치명적): Compact 트리밍으로 인한 resume 시 turnId 손실 — §12 봉쇄의 조건부 재현**

`hydrateFeatureContext`가 `compactFeatureContext`를 **먼저** 실행한 뒤 트리밍된 `featureContext.userTurns`에서 `find(t => t.jobId === jobId)`로 turnId를 조회. Compact는 `slice(-FEATURE_CONTEXT_WINDOW)`로 오래된 턴을 잘라내므로, 다음 시나리오에서 `find`가 `undefined` 반환:

- feature.jsonl이 boundary 이후 6+개 user_turn 누적 + 12k 토큰 초과
- 현재 잡(resumed)의 owning user_turn이 tail window 바깥에 위치

결과: `state.turnId = undefined` → §12에서 나열한 부수 효과 전부 재발 (emitFileWriteTrace no-op / applyBreadcrumbBoundaryMatrix · applyDesignBreadcrumbBoundary early-return / recordClassificationBias 샘플 누락). `compactFeatureContext.test.ts`는 compact 단독만 검증하고 `featureContextBuilder.test.ts`의 hydrate 케이스는 compact 미발동 경로만 커버 → 단위 테스트로 포착되지 않는 구멍.

🟡 **결함 2 (상당): Design resolve가 소비하지 않는 summary를 위해 LLM 호출**

- `packages/ant-cli/src/core/prompt/templates/jobs/design/**/*.md`에서 `featureContext`/`summary` 참조 **0건** (grep 확인)
- `design/state.ts` JSDoc에도 "sub-graph does not inject this today"로 명시
- 그럼에도 design `resolve.ts`의 `loadArtifacts` / `onResume` 두 경로 모두 `hydrateFeatureContext`에 `llm + promptPort`를 전달 → user_turn 누적 시 compact LLM 호출이 실제로 발동
- 반환된 summary는 `state.featureContext`에 담긴 뒤 잡 종료와 함께 폐기 (feature.jsonl은 append-only이므로 영속되지 않음)

매 design 잡 시작/resume에 "아무도 읽지 않는 digest"를 위해 LLM 비용 + latency를 소모. code resolve 패턴을 복붙하면서 design 쪽 consumer 유무를 확인하지 않은 근시안적 결함.

수정:
1. **`featureContextBuilder.ts::hydrateFeatureContext`** — turnId 조회 블록을 compact 호출 **이전**으로 이동. full pre-compact `userTurns`에서 `find(jobId)` 하도록 순서 재조정. 의도를 JSDoc으로 영속화하여 향후 리팩토링 시 순서가 다시 뒤바뀌지 않도록 방어.
2. **`architect/graph/design/nodes/resolve.ts`** — `loadArtifacts` / `onResume` 두 경로의 `hydrateFeatureContext` 호출에서 `llm: state.deps?.llm`, `promptPort: state.deps?.promptBuilder`를 제거. hydrate 내부의 기존 가드(`if (deps.llm && deps.promptPort)`)가 자연히 compact 스킵 → turnId 회복 + merge-only featureContext는 그대로 동작. 주석에 "code는 plan/direct summary를 렌더 / design은 렌더하지 않음 / 미래에 template이 summary를 요구하면 llm/promptPort를 다시 전달"이라는 판단 기준을 명시.
3. **`architect/graph/design/state.ts`** — `featureContext` JSDoc에서 misleading한 "`summary?` / `wasCompacted?` populated by §13 Compact" 문구 제거. design resolve가 compact를 의도적으로 건너뛴다는 것과 활성화 조건(template이 summary 소비 시작)을 문서화.

검증:
- 단위 테스트 1개 추가 (`featureContextBuilder.test.ts` — "preserves turnId even when Compact trims the owning user_turn out of the window (§13 defect 1)"): 12 turns × 10k 문자로 Compact를 강제 발동시키고 owning turn을 tail window 바깥에 두어 결함 1의 경로를 재현, 수정 후 turnId가 `t-1`로 정상 복구되는 것을 assertion.
- `pnpm vitest run`: 65 파일 / **1346 테스트** (= §12 베이스라인 1345 + 1) 통과.
- `pnpm exec tsc --noEmit`: **26 에러** (베이스라인 유지 — 새 에러 0건).
- ReadLints: 수정 파일 전부 clean.

건드리지 않은 것:
- `CHARS_PER_TOKEN = 2.8`이 `featureContextBuilder.ts`와 `compactJob.ts`에 중복 상수로 선언된 점 — 현재 값은 동일이고 기능 결함은 아니므로 §13 스코프 밖. SSOT화는 별도 cleanup 티켓 대상.
- FEATURE_CONTEXT_THRESHOLD 비교에 breadcrumbs 토큰 미반영 — `BREADCRUMB_LIMITS`로 물리 상한이 이미 존재하므로 설계 의도대로 intentional (핸드오프 §13 "설계 결정"과 일치).

이것으로 §13(compaction_policy) 구현의 주요 결함은 모두 해소됐다. Compact 경로가 turnId 복구 경로를 우회하지 못하게 순서가 고정됐고, summary를 소비하지 않는 design 잡에서 LLM 호출이 더 이상 낭비되지 않는다.

**Phase C 종료**: §11~§13 3/3 완료. resolve가 feature.jsonl을 읽어 T2+T3 `featureContext`를 구축 + Collapse(boundary 시) + Compact(code 한정, threshold 초과 시) 이중 메커니즘으로 맥락 크기 통제 + plan/direct 프롬프트 주입. 다음은 Phase D (§14 legacy_cleanup부터).

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
- ~~`registerChatFlusher` / `unregisterChatFlusher`는 기존 `ChatAPIClient`가 여전히 호출하므로 no-op 함수로 남겨서 호출측 변경 없이 무력화 → 다음 라운드에 caller까지 정리할 수 있음~~ → **해결됨** (2026-04-20 §14 복검). Phase D가 전체 완료되어 "다음 라운드"가 끝났는데 caller 정리가 누락돼 있었음. `gracefulShutdown.ts`의 no-op 함수 2개 삭제 + `ChatAPIClient.ts::initializeLLMResponseService`의 동적 import + `registerChatFlusher(llmResponseService!)` 블록 삭제. grep 전역 0건 재확인

**AC 달성**:
- [x] agent-side grep 게이트: `chat\.json|saveToChatFile|jobConversation|planMini|flushToChatFile|getChatSessionPath|CODE_JOB_COMPACTION|DESIGN_JOB_COMPACTION|compressHeavyweightEntries|registerChatFlusher|unregisterChatFlusher|ChatFlusher` → `packages/ant-cli/src` 전체에서 0건 (ChatService HTTP layer 주석의 "chat.json" 설명문은 §16.2에서 retirement 이후 잔존 주석이므로 §14 결함 아님)
- [x] 내 수정 파일 타입 에러 0 (§14 복검 후 총 26 baseline 유지 — §13 후속으로 27→26 감소 이후 새 에러 0)
- [x] vitest **65 suites / 1346 tests** 전원 통과 (§13 복검 baseline 유지, regression 0)

**⚠️ 검증 미완**:
- ChatService HTTP 레이어가 여전히 chat.json을 작성/읽지만, agent-side 워커는 더 이상 chat.json을 작성하지 않음 → §16.2 `chat_ssot_finalization`에서 trace.jsonl SSOT로 치환됐으므로 잔존은 주석뿐 (실제 chat.json 기록 경로는 이미 사망)
- ~~`buildSessionDigest`가 항상 `undefined`를 반환하므로 triage 프롬프트의 sessionDigest 섹션은 사실상 dead~~ → **서술 오류 정정** (2026-04-20 §14 복검). architect code/design에선 더 이상 채우지 않지만, `planner/graph/plan/nodes/resolve.ts` 및 `creator/graph/visual/nodes/resolve.ts`에서 `buildSessionDigest(sessionMain/conversation)`로 정상 채워 triage가 소비 중. architect 2개 잡만 skip하는 것이며, 인프라/헬퍼 제거 대상 아님

**§14 복검 요약 (2026-04-20)**:
§14 구현은 대부분 설계 의도를 잘 지켰으나 "다음 라운드 정리 대상"으로 예고했던 `registerChatFlusher` / `unregisterChatFlusher` no-op + caller가 Phase D 종료 후에도 정리되지 않은 하위 호환 잔존 1건 발견 → 제거. 사이드이펙트: 모든 worker 프로세스가 초기화 시 `gracefulShutdown` 모듈을 동적 import해 no-op을 실행하던 비용 + 이름대로 동작하리라 오해할 회귀 트랩이 있었음. handoff 문서 "검증 미완"의 sessionDigest dead code 서술은 잘못(planner/visual은 정상 동작)이어서 정정. 이로써 agent-side grep 게이트가 기존 9심볼 → 12심볼(Chat flusher 3종 추가)로 확장된 상태에서도 0건 유지.

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

**§16 + §16.2 복검 요약 (2026-04-20)**:
§16 scaffolding + §16.2 chat SSOT cutover 구현을 함께 감사. **치명적 결함(P0) 없음**. P1 결함 3건 발견·수정:

- 🟡 **결함 A (Legacy 잔존 — dead HTTP endpoint)**: `GET /api/projects/:id/features/:feature/chat/messages`는 §16.2 AC에서 제거 대상이었으나 라우트가 살아있었음. UI 호출자 0건 (ant-ui 전역 grep). SSE `initial_state.chat`가 동일 데이터를 전달하므로 기능 중복·공격 표면만 키우는 상태였음 → `chat.routes.ts`에서 핸들러 + `logger` 사용처 삭제, 상단 "Removed endpoints" 블록에 §16.2 retirement 항목 추가
- 🟡 **결함 B (Dead code + hot-path wasted I/O)**: `TraceInput.userTurnMetas?` / `TraceInput.breadcrumbs?` 필드가 "kept for future use" 주석과 함께 남아 있었고, `ChatService.loadTraceDerivedMessages`는 매 `getMessagesAsync` 호출마다 `adapter.loadSinceBoundary()` + `adapter.loadAllBreadcrumbs()`로 `feature.jsonl`을 2회 읽어 그 결과를 `buildChatMessagesFromTrace`에 넘겼지만, 실제 구현은 `traceLines`만 소비하고 나머지는 버리고 있었음. SSE 최초 접속·chat 초기 state마다 불필요한 파일 read 2회 발생 → `TraceInput`을 `{ traceLines }`로 축소, `loadTraceDerivedMessages`에서 dead load 2곳 제거, 상단 코멘트를 "breadcrumbs/user_turn_meta는 Timeline/tier badge에서 직접 읽는다"로 정정
- 🟡 **결함 C (UI SSOT desync)**: `ChatSidebarWrapper` "Clear Chat History" 버튼은 `DELETE /chat/messages`를 통해 백엔드에서 `trace.jsonl` + `feature.jsonl`을 collapse하지만, 프론트 SSE `messages_cleared` 핸들러는 `chatMessages`만 비우고 `featureLogSlice`(`traceLines` / `breadcrumbs` / `userTurns` / `userTurnMetas`)는 그대로 뒀음. 결과: Activity / Timeline 탭이 collapse 이전 데이터를 feature 전환 시점까지 stale 렌더. §17 hard_reset의 `resetFeatureContext` 경로는 직접 slice를 비워 문제 없으나 §16.2의 Clear 버튼 경로만 틈이 있었음 → `chatSseHandler.ts`의 `messages_cleared` 케이스에 `get().clearFeatureLog?.()` 추가 (slice 미등록 환경 대비 optional chaining, 현재 store 구성에서는 항상 정의됨)

⚪ **서술 오류 / cosmetic**: ant-ui 측 3개 파일(`infrastructure/http/api/chat.ts` 주석 2곳, `application/hooks/features/useJobExecution.ts:98`, `presentation/components/chat/FileCard.tsx:107`)이 여전히 "persists to chat.json" / "metadata from chat.json"로 서술 → trace.jsonl 기준으로 정정. 기능 영향 없음, 회귀 trap(다음 수정자가 chat.json이 살아있다고 오인)만 제거.

⚪ **관찰 (결함 아님, 향후 설계 이슈로만 기록)**: `ChatService.getMessagesAsync`의 `pendingUserMsgs` 필터는 `m.jobId && !durableUserJobIds.has(m.jobId)`로 scratchpad user 메시지를 포함시키려 하지만, UI 측 `addChatUserMessage`는 jobId 인자가 없어 항상 `undefined`로 POST됨 → 필터의 `m.jobId &&` 조건이 항상 false가 되어 **scratchpad pending user는 실질적으로 초기 state에 포함되지 않음**. 정상 경로에서는 SSE `user_message` live broadcast가 해당 메시지를 UI에 즉시 전달하고 `initial_state.chat` merge 로직이 local state를 보존하므로 눈에 띄는 regression은 없음. 유일한 gap: (페이지 첫 로드 && 방금 POST && 워커가 `recordUserTurn` 아직 안 한) 초극 단기간에 SSE 최초 접속 시 그 유저 메시지가 누락될 수 있음. 대응은 content-based dedup 또는 scratchpad user 저장 자체 폐기가 필요해 본 복검 범위를 넘음 — 추후 별도 todo로 분리.

**수정**:
- `packages/ant-cli/src/periphery/adapters/http/routes/chat.routes.ts` — `GET /chat/messages` 핸들러 삭제, top-level comment의 "Removed endpoints" 블록에 §16.2 retirement 항목 추가 (logger import는 다른 에러 경로에서 사용되므로 유지)
- `packages/ant-cli/src/periphery/adapters/http/services/ChatService/TraceToChatMessages.ts` — `TraceInput`에서 `userTurnMetas?` / `breadcrumbs?` 필드 제거, 관련 `FeatureBreadcrumbLine` / `FeatureUserTurnMetaLine` import 삭제, 상단 docblock 업데이트
- `packages/ant-cli/src/periphery/adapters/http/services/ChatService/index.ts` — `FeatureBreadcrumbLine` / `FeatureUserTurnMetaLine` import 삭제, `loadTraceDerivedMessages`에서 `loadAllBreadcrumbs` + `loadSinceBoundary` 호출 블록 삭제, docblock을 "only trace.jsonl is consulted" 로 정정
- `packages/ant-ui/src/domain/store/slices/sse/chatSseHandler.ts` — `messages_cleared` 케이스에 `get().clearFeatureLog?.()` 호출 추가 + 설명 주석
- `packages/ant-ui/src/infrastructure/http/api/chat.ts` — `addChatUserMessage` / `clearChatHistory` 두 함수의 docblock을 trace.jsonl SSOT 기준으로 정정
- `packages/ant-ui/src/application/hooks/features/useJobExecution.ts` — "persisted state in chat.json" → "trace.jsonl"
- `packages/ant-ui/src/presentation/components/chat/FileCard.tsx` — "metadata from chat.json" → "trace.jsonl"

**검증**:
- agent-side 12심볼 grep 게이트 (`chat\.json|saveToChatFile|jobConversation|planMini|flushToChatFile|getChatSessionPath|CODE_JOB_COMPACTION|DESIGN_JOB_COMPACTION|compressHeavyweightEntries|registerChatFlusher|unregisterChatFlusher|ChatFlusher`) → `packages/ant-cli/src` 런타임 코드 0건 (§16.2 retirement 설명 주석 7건만 잔존, 의도된 docblock)
- ant-ui 측 `chat\.json` grep → i18n locale 파일 import 2건만 (번역 파일명, session과 무관)
- `pnpm exec tsc --noEmit` → **26 에러** (baseline 유지, 새 에러 0)
- `pnpm vitest run` → **72 suites / 1383 tests 전원 통과** (§14 복검 이후 snapshot/템플릿 업데이트로 suites·tests 증가분 포함, regression 0)
- `ReadLints` → 수정 7개 파일 clean

**건드리지 않은 것**:
- `POST /chat/user-message` / `POST /chat/job-error` / `POST /chat/eval-save` / `POST /chat/dismiss-choice` — UI가 여전히 호출. §16.2 AC는 제거 권장이었으나 choice UX 재설계를 동반해야 해 "ChatService slim + trace.jsonl SSOT 배선" 수준에서 유지하는 것이 현재 설계 결정 (`index.ts` docblock에 명시). 런타임 경로는 이미 trace.jsonl로 rewire됨 → 기능 중복·legacy file 참조 없음
- `GET /chat/pending-choice` / `POST /chat/triage-choice` — choice dispatch 경로, §16.2 AC에서도 retention 허용 대상
- `ChatService.getMessagesAsync`의 `pendingUserMsgs` 로직 자체 — 위 "⚪ 관찰" 항목대로 별도 todo 분리 필요
- `ChatService` / `SessionManager` / `MessageManager` / `SessionPersistence` docblock의 "§16.2: chat.json is retired" 문구 — retirement 기록이 그 자체로 가치이므로 유지

이로써 §16 `ui_render_migration` + §16.2 `chat_ssot_finalization`이 설계 목표("Chat UI가 `trace.jsonl` SSOT 위에서 동작 + chat.json 런타임 참조 0 + SSE `messages_cleared` 양방향 sync")를 실측 기준으로 달성했고, `getMessagesAsync` hot path의 중복 file read 2건이 제거되어 feature mount / SSE reconnect 비용이 실질 감소.

**후속 의존성**:
- §16.2 `chat_ssot_finalization`(신규 — §4 남은 todos 참조): Chat 탭 자체를 Activity 뷰로 치환 + ChatService/chat.routes/SSE initial_state.chat 제거 + choice UX 재설계
- §17 `hard_reset`: 본 todo로 `/trace` + `/breadcrumbs` 엔드포인트 인프라가 갖춰졌으므로 reset 후 UI가 즉시 빈 상태로 갱신되는 경로가 열림
- §18 `tier_ui_badge`: `TraceActivityView`의 turn 헤더가 `mode · complexity · decidedBy · reason` 배지 렌더 자리 제공 (현재 `jobType` + `turnId` + `firstTs` 표시 중)

---

### 17. `hard_reset` ✅ (+ 사후 결함 검토 2026-04-20)

**목표**: `POST /api/projects/:id/features/:feature/context/reset` 백엔드 + FeatureSection 헤더 reset 버튼. `FileSessionAdapter.collapseAll('user_reset', jobId, turnId)` 재사용으로 feature.jsonl / trace.jsonl T2/T3 초기화 + `user_reset` boundary append. 리셋 후 UI는 slice 액션이 기존 loaders를 재활용해 즉시 빈 상태로 갱신된다.

**신규 파일**: 없음 (§16에서 깔린 인프라를 그대로 확장)

**수정 파일**:
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` — `POST /projects/:id/features/:feature/context/reset` 핸들러 추가. body `{ reason?: string }` (공백 trim → `user_reset` 기본값). `FileSessionAdapter.collapseAll(reason, jobId, turnId)` 호출 후 `{ success, reason, jobId, turnId }` 응답. `workspaceResolver` 미존재 시 503 (기존 GET 엔드포인트와 동일 가드)
- `packages/ant-ui/src/infrastructure/http/api/featureLog.ts` — `resetFeatureContext(projectId, featureName, reason?) -> ResetFeatureContextResponse` 추가. `apiPost` 재사용
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` — `resetFeatureContext` 액션 추가. API 호출 → 두 캐시 키(`traceKey`/`breadcrumbsKey`) 폐기 + 배열 초기화 → `loadFeatureTrace` / `loadFeatureBreadcrumbs` 병렬 재-fetch. 실패는 loader의 기존 `traceError` / `breadcrumbsError`로 surfacing되므로 액션 자체는 API 레벨 에러만 throw
- `packages/ant-ui/src/presentation/components/FeatureSection/index.tsx` — selectedFeature 존재 시 FeatureDropdown 아래에 subtle reset 버튼 노출. `RotateCcw` 아이콘 + 작은 스타일, 리셋 중 `animate-spin` + `disabled`. 확인 다이얼로그는 `useAlertModalContext.showConfirm`. 작업 실행 중(`runningJobsByFeature[featureKey]`)에는 클릭 시 `showError`로 차단. 성공 시 `showSuccess`, 실패 시 `showError`
- `packages/ant-ui/src/i18n/locales/{ko,en}/chat.json` — `context.{resetLabel, resetTooltip, resetConfirm, resetConfirmTitle, resetConfirmAction, resetSuccess, resetSuccessTitle, resetFailed, resetBlockedByJob}` 9개 키 양 로케일 동일 구조

**설계 결정**:
- URL 규약은 원 플랜의 `/api/feature/:featureId/...` 대신 기존 라우트 체계(`/api/projects/:id/features/:feature/...`)와 일관성 있는 `/context/reset`으로 확정 — §16에서 이미 동일 패턴을 채택
- reset 버튼 위치는 FeatureDropdown 바로 아래 인라인 row. ItemDropdown 자체에 새 slot을 뚫지 않고 FeatureSection 컴포넌트에서 직접 렌더 → 다른 Dropdown 사용처에 영향 없음
- slice는 기존 `loadFeatureTrace` / `loadFeatureBreadcrumbs`를 재-fetch 경로로 그대로 활용 → stale race 가드(`traceKey`/`breadcrumbsKey`) 및 loading state 전이가 초기 로드와 완전히 동일
- 확인 다이얼로그는 `showConfirm(message, { onConfirm })` 패턴 — 실수 방지 AC(`[ ] 확인 다이얼로그 없이는 리셋되지 않음`) 충족
- 작업 실행 중 guard는 `runningJobsByFeature[featureKey]` truthy 체크. 원 카드는 가드를 명시하지 않았으나, collapseAll이 진행 중인 job의 turnId 상태와 경쟁하면 T2/T3 축적이 손상될 수 있어 추가함 (기존 `removeJobBlocked` 패턴과 일관)
- ~~리셋 후 SSE broadcast는 의도적으로 제외~~ → 사후 복검에서 **정정**. §16.2 Defect C 수정으로 `messages_cleared` SSE 핸들러가 `chatMessages` + `clearFeatureLog()` 양쪽을 동시에 비우게 되어, SSE 브로드캐스트가 오히려 **가장 사이드이펙트가 적은 Clear·Reset 양방향 sync 경로**임이 확인됨. 현재 구현은 §16.2 Clear 파이프라인에 위임하므로 SSE `messages_cleared`가 동반 발생한다(아래 "사후 결함 검토" 참조).

**AC 달성**:
- [x] 리셋 후 `loadSinceBoundary`가 빈 배열 반환 — `collapseAll`이 모든 선행 라인을 `collapsed=true` 마킹한 뒤 `user_reset` boundary를 append하므로 다음 로드에서는 T2/T3 모두 비어있음
- [x] trace.jsonl의 기존 라인은 `collapsed=true`로 마킹되나 디스크 보존 — `collapseAllInFile`은 write 시 `obj.collapsed = true`만 추가하고 라인 자체를 삭제하지 않음
- [x] 확인 다이얼로그 없이는 리셋되지 않음 — `showConfirm`의 `onConfirm` 콜백 경로를 통해서만 `performReset` 실행
- [x] URL이 `/api/projects/:id/features/:feature/context/reset` 패턴 준수 — 기존 라우트 규약 일관성
- [x] 내 수정 파일 타입 에러 0 — ant-cli tsc baseline 27 유지, ant-ui tsc 선행 에러만
- [x] vitest 61 suites / 1287 tests 전원 통과 (regression 없음)

**⚠️ 검증 미완**:
- reset 라우트 단위 테스트 없음. 후속에서 `FileSessionAdapter.collapseAll` 호출과 응답 shape을 검증하는 supertest 스펙 권장
- 수동 smoke 미실행 — 실제 브라우저에서 Activity/Timeline 탭이 리셋 직후 빈 상태로 갱신되는지 확인 필요

**후속 의존성**:
- §18 `tier_ui_badge`: 본 카드와 독립. `TraceActivityView`에 turn 헤더 배지만 추가
- §16.2 `chat_ssot_finalization`(완료 가정): ~~Chat 탭이 trace 기반으로 이미 치환되어 있으므로 reset 직후 Chat 탭도 자동으로 빈 상태가 됨 (별도 배선 불필요)~~ → **가정 오류**. ChatPanel은 `traceLines`가 아니라 `state.chatMessages`(SSE-populated chat slice)를 읽으므로, `featureLogSlice`만 비워서는 Chat 탭이 리셋되지 않는다. 아래 "사후 결함 검토" 참조.

---

#### 🔍 사후 결함 검토 (2026-04-20)

§17 구현은 "FileSessionAdapter.collapseAll만 다시 부르면 된다"는 단편적 접근으로 해결됐지만, 설계방향(§16.2 "Chat·Clear·Reset 양방향 sync" SSOT)과 비교 감사한 결과 **§16.2가 이미 구축한 통합 cleanup 파이프라인(Redis session purge · 로컬 캐시 리셋 · 드래프트 이미지 정리 · `messages_cleared` SSE 브로드캐스트)을 전부 우회**하는 치명적 간극이 확인됐습니다. 원래 §17 카드가 의도한 "feature.jsonl/trace.jsonl 파일만 collapse하면 UI가 자동으로 갱신된다"는 가정이 아래 두 지점에서 어긋납니다.

🟡 **결함 A (UI SSOT desync — Chat 탭 stale render)**
- 상황: `/context/reset` → `resetFeatureContext` slice 액션이 `traceLines` / `breadcrumbs` / `userTurns` / `userTurnMetas`는 비우지만, ChatPanel이 실제로 구독하는 `state.chatMessages`(`useChat()` → `useStore(state => state.chatMessages)`)는 건드리지 않음.
- 결과: Activity / Timeline 탭은 즉시 비어 보이나 **Chat 탭은 리셋 이전 메시지를 그대로 유지**하다가 feature 전환 또는 SSE 재연결 시에만 갱신. 사용자가 "리셋 후에도 대화가 살아있네?"라고 인지하는 회귀.
- 원인: §17 구현 시 "Chat 탭은 trace-derived"라는 오인(실제로는 Chat 탭이 `chatMessages` 슬라이스를 읽고, 해당 슬라이스는 SSE `initial_state.chat` / `user_message` / `message_*` 이벤트로만 채워짐).

🟡 **결함 B (Redis 스크래치패드 / 드래프트 / 다중 탭 미동기)**
- 상황: `/context/reset`이 새 `FileSessionAdapter`를 직접 만들어 `collapseAll`만 호출 → `ChatService.clearMessages`의 후행 단계를 **전부 skip**한다.
  - Redis `chatSession` 비-삭제 → `getMessagesAsync`의 `pendingUserMsgs`(직전 POST된 `user-message`) / `currentMessage` 스크래치패드가 다음 SSE 재연결 시 부활 가능.
  - `SessionManager.localCache` 비-리셋 → 같은 프로세스 내에서 동일 feature에 대한 추후 읽기가 stale 세션을 재사용할 여지.
  - `{featurePath}/inputs/assets/gen/drafts/` 디렉터리 비-삭제 → Clear에서는 정리되던 드래프트 이미지가 Hard Reset 경로에서만 누적.
  - `messages_cleared` SSE 브로드캐스트 비-발생 → 같은 feature를 열고 있는 다른 탭 / 다른 pod에서 리셋이 반영되지 않음.
- 원인: 카드 설계 시 "SSE broadcast 의도적으로 제외"라는 메모가 있었으나, 이는 §16.2 Defect C 수정 이전에 작성된 단서. §16.2 수정으로 `messages_cleared`가 `chatMessages` + `clearFeatureLog()` 양쪽을 묶어서 비우게 된 뒤에는 SSE 경로가 **오히려 가장 SSOT-일치하는 sync 수단**으로 바뀌었다. 카드 작성 시점의 "단일 pod + 단일 탭" 가정이 설계 발전과 어긋난 채로 구현에 반영됨.

**수정 (holistic, 2026-04-20)**

1. `ChatService`에 `clearMessagesAsync` 공개 메서드 추가 — 기존 fire-and-forget `clearMessages`의 awaitable 카운터파트. Reset 응답이 collapse 완료까지 기다려야 하는 §17의 요건을 만족하면서도 Clear·Reset이 동일 파이프라인을 타게 함.
2. `createFeatureLogRoutes` deps에 `chatService` + `fileTreeNotifier` 주입. `POST /projects/:id/features/:feature/context/reset` 핸들러는 `chatService` 보유 시 `await chatService.clearMessagesAsync(...)` + `fileTreeNotifier?.notifyFileTreeUpdate(...)` 경로로 재배선. (chatService가 없는 극단적 degraded composition에서만 기존 FileSessionAdapter.collapseAll fallback 유지.) → Redis session · 로컬 캐시 · 드래프트 · SSE 브로드캐스트가 한 번에 해결.
3. `routes/index.ts` createFeatureLogRoutes 호출부에 `chatService` + `fileTreeNotifier` 전달.
4. 프런트 `featureLogSlice.resetFeatureContext`에 `get().clearChatMessages?.()` 호출 추가 — SSE `messages_cleared`가 동일 일을 하지만, HTTP 응답과 SSE 이벤트 도착 사이의 한순간이라도 stale Chat 탭이 노출되지 않도록 eager clear(멱등, SSE 핸들러가 뒤이어 다시 비워도 무해).
5. 본 문서 §17 설계 결정 마지막 줄의 "SSE broadcast 의도적으로 제외"와 "후속 의존성"의 Chat 탭 자동 갱신 가정을 **정정 취소선 + 실제 동작 설명**으로 교체.

**수정 파일**:
- `packages/ant-cli/src/periphery/adapters/http/services/ChatService/index.ts` — `clearMessagesAsync` 추가 (+ `clearMessages` 독셔블럭 정정)
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` — deps 확장 + `/context/reset` 핸들러 chatService 위임 경로 구현 + docblock 재작성
- `packages/ant-cli/src/periphery/adapters/http/routes/index.ts` — createFeatureLogRoutes 호출부에 chatService / fileTreeNotifier 전달
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` — `resetFeatureContext` 액션에 `clearChatMessages` 전파 + 사유 주석

**검증**:
- ant-cli tsc: **26** (baseline 유지) ✅
- ant-ui tsc: **21** (baseline 유지) ✅
- vitest: **72 suites / 1383 tests** 전원 통과 ✅
- ReadLints 수정 4개 파일 clean ✅

**설계 원칙 복원**: 이로써 "Clear·Reset 양방향 sync" SSOT가 실제 HTTP → 백엔드 → SSE → 프런트 슬라이스 전 구간에 걸쳐 닫힌 회로를 이룬다. `POST /context/reset`과 `DELETE /chat/messages`는 지금 같은 `ChatService.clearMessagesAsync` 코어를 공유하며, URL 규약과 응답 shape만 다르다(`{success, reason, jobId, turnId}` vs `{success}`). 추가 reset 표면(예: per-turn purge, 관리자 API)이 생겨도 동일 SSOT에 위임하면 된다.

**남은 후속**: `/context/reset` 라우트 단위 테스트(기대 호출: `chatService.clearMessagesAsync` + `fileTreeNotifier.notifyFileTreeUpdate`)와 프런트 `resetFeatureContext` 액션의 `clearChatMessages` 호출 검증 테스트는 본 복검 범위에서 작성하지 않았다(작업 중 tsc + 기존 vitest suite 회귀 0로 확인). 후속 카드에서 supertest + zustand mock 스펙으로 고정 권장.

---

### 18. `tier_ui_badge` ✅

**목표**: `TraceActivityView`의 각 turn 헤더에 `mode · complexity · decidedBy · reason` 배지를 읽기 전용으로 노출. `feature.jsonl`의 `user_turn` + `user_turn_meta`를 turnId 기준으로 병합.

**URL 규약 결정**: §18 카드의 옵션 B (신규 전용 엔드포인트) 채택 — `/trace`는 UI 렌더 SSOT이므로 feature.jsonl 소스를 섞지 않고 별도 `/user-turn-meta` 엔드포인트로 분리. 기존 `/api/projects/:id/features/:feature/...` 패턴 준수.

**신규 파일**: 없음 (기존 §16 인프라에 배지 레이어만 추가)

**수정 파일**:
- `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` — `loadFeatureTurnMeta()` 추가. feature.jsonl에서 `collapsed=false`인 user_turn + user_turn_meta만 반환 (boundary 무시 — §18 카드 주석 참조)
- `packages/ant-cli/src/core/ports/session.ts` — `SessionPort.loadFeatureTurnMeta()` 시그니처 추가
- `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` — `GET /projects/:id/features/:feature/user-turn-meta` 라우트 추가. 응답 shape: `{ userTurns: FeatureUserTurnLine[], userTurnMetas: FeatureUserTurnMetaLine[] }`. workspaceResolver 미존재 시 503
- `packages/ant-ui/src/infrastructure/http/api/featureLog.ts` — `getFeatureTurnMeta(projectId, featureName)` 클라이언트 함수 추가 (`FeatureUserTurnLine`/`FeatureUserTurnMetaLine` 공유 타입 사용)
- `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` — `userTurns` / `userTurnMetas` 상태 필드 + `turnMetaStatus` / `turnMetaError` / `turnMetaKey` (§16 패턴 복제). `loadFeatureTurnMeta` 액션 + `appendFeatureUserTurn` / `appendFeatureUserTurnMeta` append helpers + `clearFeatureLog` / `resetFeatureContext` 두 메서드 모두 meta 상태까지 초기화·재-fetch
- `packages/ant-ui/src/presentation/components/chat/feature-log/useFeatureLogSync.ts` — 피처 mount 시 `loadFeatureTurnMeta`도 병렬 호출
- `packages/ant-ui/src/presentation/components/chat/feature-log/TraceActivityView.tsx` — turn 헤더에 `<TierBadges />` 컴포넌트 렌더. `buildTierIndex(userTurns, userTurnMetas)` helper로 turnId 기준 병합 Map 구성. 4종 배지 컴포넌트 (mode / complexity / decidedBy / reason) — 각 필드 존재 시만 렌더, reason은 `title` 속성으로 full text + `truncate(..., 32)`로 헤더 overflow 방지
- `packages/ant-ui/src/i18n/locales/{ko,en}/chat.json` — `tier.{modeTooltip, complexityTooltip, decidedByTooltip}` 3개 키 양 로케일

**설계 결정**:
- 엔드포인트 옵션 B 채택: `/trace`는 UI-only 렌더 SSOT 지위를 유지해야 하므로 `user_turn_meta`(feature.jsonl 소스)를 섞지 않고 분리. trace 라인 유니온 확장 회피 → BE↔FE 계약 변경 최소화
- `loadFeatureTurnMeta`가 boundary 무시: Hard Reset 후에도 `trace.jsonl`에는 라인이 남지만 `collapsed=true`로 마킹되어 UI에서 필터링됨. `user_turn_meta`도 동일 로직으로 collapsed 제외 → UI 상에 표시되는 turnId 범위와 자동 일치
- 배지 색상 토큰: mode(explain=gray / generate=emerald / refactor=purple), complexity(oneshot=sky / exploratory=amber / todo=indigo), decidedBy(llm=blue / heuristic=yellow / user=pink). 4행×3색은 dark/light 양쪽 명시적 Tailwind 클래스로 고정 (동적 생성 금지 — tailwind purge 안전성)
- reason은 길 수 있어 12rem max-width + 32자 truncate + `title` tooltip. 다른 3종 배지와 달리 색 구분 없이 중립 배경 (값이 free-form string)
- 온클릭/토글 없음 — §18 AC의 "읽기 전용" 엄수. overrule은 후속 플랜
- 슬라이스는 §16 패턴(traceKey/breadcrumbsKey)을 그대로 따라 per-loader `turnMetaKey`로 stale race 가드. `resetFeatureContext`는 3개 캐시 키 모두 폐기하고 `loadFeatureTurnMeta`까지 재-fetch

**AC 달성**:
- [x] 배지가 `TraceActivityView` turn 헤더마다 표시 (해당 turnId에 mode 또는 meta가 있을 때만)
- [x] meta 누락 시 해당 필드만 생략 (UI 무너지지 않음) — `TierBadges`가 4개 필드 모두 optional 렌더
- [x] 읽기 전용 (onClick 핸들러 없음, hover title만 제공)
- [x] URL이 `/api/projects/:id/features/:feature/...` 패턴 준수 (`/user-turn-meta`)
- [x] 내 수정 파일 타입 에러 0 — ant-cli tsc **26** (baseline 27 대비 1 감소, 타입 추가로 dead 파일의 선행 에러 1건이 자연 소거), ant-ui tsc 21 (baseline 유지)
- [x] vitest **62 suites / 1310 tests** 전원 통과 (regression 없음)

**⚠️ 검증 미완**:
- `/user-turn-meta` 라우트 단위 테스트 없음 — `loadFeatureTurnMeta` adapter 메서드는 기존 `fileSessionAdapter-log.test.ts` 패턴으로 추가 권장
- 수동 브라우저 smoke 미실행 — 실제 Activity 탭에서 배지가 user_turn 기록 시점과 Decompose 완료 시점 순으로 자연스럽게 채워지는지 시각 확인 필요
- Chat 탭(§16.2 trace-derived 렌더)에도 동일 배지 적용은 본 카드 범위 외 — `TraceActivityView` 대상만. 필요 시 Chat 탭 렌더러에도 `buildTierIndex` + `<TierBadges>` 재사용 가능

**후속 의존성**: 없음 (본 카드로 Phase D 5/5 종료)

---

#### §18 사후 복검 요약 (2026-04-20)

**결론**: §18 구현은 read path(`GET /user-turn-meta` + adapter reader + FE slice + `<TierBadges>`)만 구축했을 뿐, **write path(복잡도 판정 결과를 `feature.jsonl`에 `user_turn_meta`로 기록하는 경로)가 통째로 비어 있었던** 것이 본 감사에서 확인됐습니다. 설계 원칙(§2.3·§4.1·§9.1, 28-context-management 부분 대체 배너)과 실제 실행 흐름을 교차 감사한 결과, 치명적 P1 결함 1건을 발견하고 홀리스틱하게 해결했습니다.

**발견된 결함 (P1) — user_turn_meta가 실제로 한 번도 쓰이지 않음**

- `FeatureUserTurnMetaLine` 스키마는 §2에서 정의됐고, `SessionPort.appendUserTurnMeta` + `FileSessionAdapter.appendUserTurnMeta`는 §6 `file_mutex_lock` 사후에 구현됐으나, **어떤 agent/node도 해당 메서드를 호출하지 않았음** (검증: `rg 'appendUserTurnMeta' packages/ant-cli/src` → 테스트 + 포트 정의만)
- 결과 1 (UI): Activity 탭의 `<TierBadges>`에서 `mode`(user_turn)만 보이고 `complexity / decidedBy / reason` 3필드는 모든 turn에 대해 영구 누락 → §18 카드 4 AC 중 3개가 사실상 미달성이었음 (UI는 무너지지 않으므로 silent failure)
- 결과 2 (LLM 프롬프트): `featureContextBuilder.mergeFeatureContext`가 `metaByTurn`에 아무것도 못 채워서 resolve → plan/direct 프롬프트의 `{{#each featureContext.userTurns}}` 블록에서도 complexity 힌트가 항상 비어 있었음 → §11 `resolve_integrate`의 설계 의도(“이전 turn의 complexity 판정을 다음 job에 참조용 signal로 주입”)도 dead
- 결과 3 (관찰성): §19 `misclassify_guard`가 `state.complexity`만 수집하고 있어 `decidedBy='heuristic'`(LLM이 `<complexity>` 태그를 누락한 fallback)과 `'llm'`을 구분할 수 없었음 — bias 데이터의 해석력이 떨어짐
- 근본원인: §18 카드가 "**read path만**"을 범위로 명시했고, §2/§6의 쓰기 API 존재를 자연 호출 가정으로 오인. `docs/architecture/18-session-redesign.md` §4.1 주석("decompose 후 learn에서 append")이 의도는 담았으나 실제 write hook이 어느 노드에도 꽂히지 않았음. learn 노드는 §12 breadcrumb/boundary matrix와 §19 featureBiases만 썼을 뿐, user_turn_meta는 누락.

**수정 (홀리스틱 — read/write path 대칭 회복)**

| 파일 | 변경 |
|---|---|
| `agents/architect/graph/code/nodes/decompose/responseParser.ts` | `ParsedDecomposeResponse`에 `complexityDecidedBy: DecidedBy` 추가. `<complexity>` 태그 유무를 기준으로 `'llm'`(태그 존재) vs `'heuristic'`(fallback default) 판정. `'user'`는 향후 overrule UX용으로 예약 |
| `agents/architect/graph/code/nodes/decompose/index.ts` | STEP 9.5 신설 (checkpoint save 직후, return 직전) — `state.deps.session` / `state.turnId` / `timingJobId` 모두 존재할 때 `session.appendUserTurnMeta({complexity, decidedBy: complexityDecidedBy, reason})` 호출. `complexityReason`이 비어 있으면 `decidedBy`에 따라 **비어있지 않은 의미 있는 fallback 문자열**(`FeatureUserTurnMetaLine.reason: string` 요건 충족) 생성. 실패는 try/catch로 감싸 swallow (관찰성 결함이 job 종료를 막지 않음) |
| `tests/decompose-responseParser.test.ts` | "complexityDecidedBy" describe 블록 3 케이스 추가 (태그 존재 → `'llm'`, 알 수 없는 태그값 → `'llm'`(LLM emitted something)·정규화는 `'todo'`, 태그 부재 → `'heuristic'`) |

**write 지점을 decompose로 둔 이유 (learn이 아닌)**

- 아키텍처 문서는 "learn에서 append"라 적었으나, **learn 노드는 `plan` 경로(즉 complexity='todo')에서만 `isLastTask && !taskFailed`로 실행**됨. `oneshot` / `exploratory`는 `direct` → `parallelOrchestrator` 경로로 빠지고 learn의 breadcrumb/boundary 블록을 경유하지 않으므로 learn write는 3-way 중 1-way만 커버함 — 3/3 커버하려면 decompose가 유일한 공통 분기 이전 지점
- 부수 효과: spec-clarify pause 때는 아직 결정이 확정 안 됐으므로 early return 경로에서 건너뛰고, `proceed_without_spec` 재개 시 decompose가 재실행되며 STEP 9.5에 도달 → 재개 전후 write가 일관. `cancel`이면 write 없음 (올바름)
- 재-invoke idempotency: 동일 turnId에 여러 user_turn_meta 라인이 append되더라도 `featureContextBuilder.mergeFeatureContext`가 turnId 기준 최신 우선 merge → 중복이 허용됨. 별도 "already written" state flag가 필요 없음

**검증**

| 항목 | 결과 |
|---|---|
| ant-cli `tsc --noEmit` | **29** (pre-change 30 → 1 감소: `complexityDecidedBy` 추가가 기존 destructure-only unused-hint 에러 1건 자연 소거) |
| `pnpm vitest run` | **72 suites / 1386 tests** 전원 통과 (신규 3 케이스 포함) |
| ReadLints 수정 3개 파일 | 기존 pre-existing 결함만 잔존 (내 수정부 라인 0 신규) |
| FPOP / 설계 경계 | write SSOT가 단일 지점(decompose STEP 9.5)에서 모든 complexity 분기를 cover |

**설계 원칙 복원**: 이로써 `user_turn_meta`의 write↔read SSOT 회로가 완성됨. Decompose가 complexity를 판정하는 순간 feature.jsonl에 즉시 기록 → (1) resolve가 다음 job에서 이 판정을 prompt에 복구 주입, (2) `/user-turn-meta` 엔드포인트와 `<TierBadges>`가 UI에 4필드 전부 렌더, (3) §19 featureBiases가 필요 시 `decidedBy` 필드로 LLM 판정 vs heuristic fallback 구분. 추가 write 표면(예: 향후 user overrule UX의 `decidedBy='user'`)이 생겨도 동일 SSOT에 위임 가능 — 더 이상 write hook 누락이 silent failure로 잠복하지 않음.

**남은 후속 (scope 외, 별도 카드 권장)**

- `/user-turn-meta` 라우트 + `loadFeatureTurnMeta` adapter 메서드 supertest/단위 테스트 (§18 원 카드의 "검증 미완" 중 남은 항목)
- decompose → `appendUserTurnMeta` 통합 테스트 (현재는 parser 단위 테스트 + 구조 review로 커버; 실제 file I/O까지 엮는 회귀 테스트는 decompose가 다수 deps를 요구해 미구현)
- Live SSE 업데이트: feature.jsonl append 이벤트가 SSE로 브로드캐스트되지 않아 Activity 탭은 feature 전환/리셋 시 refetch로만 갱신. 이는 §16 공통 제약(traceLines·breadcrumbs·userTurns 모두 initial-load-only)으로 §18의 단일 결함 아님. 필요 시 별도 "live-feature-log SSE" 카드로 처리
- `appendFeatureUserTurn` / `appendFeatureUserTurnMeta` / `appendFeatureTraceLine` / `appendFeatureBreadcrumb` slice 액션이 pre-existing dead code — live SSE 와이어링과 함께 일괄 정리 대상

---

### 19. `misclassify_guard` ✅

**목표**: Decompose의 초기 complexity 판정이 실제 결과(touched 수, escalate 발생)와 어긋나는 시그널이 관찰될 때마다 `{featurePath}/featureBiases.jsonl` 에 append. 본 플랜은 **데이터 수집만**, reader 측(heuristic/overrule)은 후속.

**신규 파일**:
- `packages/ant-cli/src/core/utils/featureBiases.ts` — `recordClassification({ featurePath, jobId, predictedComplexity, actualTouched, escalated, directive? })` + `readClassifications(featurePath)` + `getFeatureBiasesPath()` + `FEATURE_BIASES_FILENAME='featureBiases.jsonl'`. JSONL append, `fs.appendFile` 단일 호출(OS 레벨 atomic), 파일 누락 시 `ENOENT` → 빈 배열. 예외는 경고 후 swallow (학습 경로에서 job 실패 방지)
- `packages/ant-cli/tests/verification/unit/featureBiases.test.ts` — 9 tests (기본 필드/ts 기본값, 다중 append 라인 분리, 200자 truncate + ellipsis, 멀티라인 directive 첫 줄 보존, 공백 directive omit, 누락 디렉터리 자동 생성, 파일 부재 시 빈 배열, malformed line skip, 경로 상수)

**수정 파일**:
- `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts` — `recordClassificationBias(state)` 헬퍼 추가. `collectTouchedFilesFromTrace`를 재호출해 turnId 범위의 touched 수집 → `state._promotedThisJob === true` 또는 `touched > PROMOTION_TOUCHED_THRESHOLD`일 때만 append. `state.complexity` 미정의·`featurePath`/`jobId`/`turnId` 부재 시 no-op. `isLastTask && !taskFailed` 가드 내에서 `applyBreadcrumbBoundaryMatrix` 직후 호출 + try/catch로 감쌈 (observability 실패가 job 종료를 막지 않음)

**설계 결정**:
- JSONL vs JSON 배열: 카드 AC("read-modify-write로 atomic 처리 또는 JSONL로 변경")의 후자 선택. append-only에서는 JSONL이 단순하고 concurrent-safe (feature.jsonl / trace.jsonl 와 동일 패턴) → 별도 FileMutex 불필요
- 위치: `core/utils/` — domain-agnostic 헬퍼(파일 append + directive 절단)만 포함. learn 내부의 state-aware 래퍼는 `learn/index.ts`에 두어 `core/utils/`가 에이전트 상태를 알지 않도록 분리 (R1 원칙의 "utils는 pure helpers" 가이드 준수)
- 트리거 조건: `_promotedThisJob === true` OR `touched > PROMOTION_TOUCHED_THRESHOLD`(=3). `shouldEscalate`와 동일 상수·동일 비교 → 한쪽이 fire하면 다른 쪽도 자연히 기록. `state.complexity === undefined`면 비교 대상이 없으므로 skip (ask / plan / worker 경로 보호)
- directive 필드: 첫 줄 trim + 200자 상한 + ellipsis. free-form 사용자 입력이 biases 파일을 팽창시키지 않도록 제한
- reader API(`readClassifications`)는 tests에서 round-trip 검증 목적으로만 export. 실제 집계·heuristic은 후속 플랜

**AC 달성**:
- [x] 파일이 없으면 빈 배열로 초기화 (`readClassifications` ENOENT 테스트)
- [x] append는 OS-atomic `fs.appendFile` 단일 호출 (JSONL)
- [x] 읽기 측 소비자는 이번 todo에서 추가하지 않음 (MVP 범위 외 — `readClassifications`는 테스트 전용 노출)
- [x] 내 수정 파일 타입 에러 0 — ant-cli tsc **26** (baseline 유지, §18 이후 변화 없음)
- [x] vitest **63 suites / 1319 tests** 전원 통과 (featureBiases 9 신규 포함)

**⚠️ 검증 미완**:
- end-to-end 검증 (direct 루프 → escalate → learn → featureBiases append) 통합 테스트 없음. 후속 heuristic 플랜 진입 시 샘플 파일 수동 확인 권장
- reader (집계·히스토그램) 미구현 — `readClassifications`는 파일 round-trip 테스트 유틸 역할만. 후속 플랜에서 analyst/overrule 로직 작성 시 확장

**후속 의존성**:
- 후속 플랜(plan 범위 외): biases 집계 → decompose 프롬프트의 complexity 판정에 bias hint 주입 → overrule UX / heuristic 룰. 본 todo의 데이터 스키마(`{ts, jobId, predicted, decidedBy?, actualTouched, escalated, directive?}`)가 그 입력

**Phase E 종료**: §19 완료로 본 플랜의 모든 Phase(B~E)가 종료. 선택 항목 S1/S2도 2026-04-20 완료 — 아키텍처 SSOT는 [`docs/architecture/18-session-redesign.md`](../architecture/18-session-redesign.md)로 이관됐다.

#### §19 사후 복검 요약 (2026-04-20)

**결론**: §19의 writer 경로를 handoff 카드 + `docs/architecture/18-session-redesign.md` §4.1 + `decompose/responseParser.ts`(§18 사후 복검이 남긴 계약 주석)와 3방향 교차 감사한 결과, 설계 의도(`decidedBy`로 LLM 판정 vs heuristic fallback 구분, 실패 경로의 오분류 시그널 수집)와 구현이 어긋나는 **P1 계약 위반 1건 · P2 데이터 누락 1건 · P3 관측 잡음 1건**을 발견하고 홀리스틱하게 해결했습니다.

**발견된 결함**

- 🟡 **P1 — `decidedBy` 계약 위반 (silent mis-specification)**: `responseParser.ts` L108~110 주석이 *"Consumers writing user_turn_meta patches MUST forward this value so the UI tier badge and **featureBiases sample** can distinguish LLM judgements from degraded fallbacks"*를 명시적 계약으로 박아뒀으나, §19 코드는 `recordClassification`에 `decidedBy`를 전달하지 않았음. `FeatureBiasRecord` 스키마 자체에 해당 필드가 부재 → 집계 readers가 LLM 판정과 heuristic fallback(`<complexity>` 태그 누락 시 `'todo'` 폴백)을 구분하려면 feature.jsonl `user_turn_meta`와 (jobId, turnId) join을 강제받게 됨. feature.jsonl은 Collapse 대상이므로 향후 join이 조용히 깨질 위험도 잠복.
- 🟠 **P2 — 실패 경로 misclass 시그널 누락**: `recordClassificationBias` 호출이 `if (isLastTask && !taskFailed)` + 상위 `!hasOrchestratorFailure` 이중 게이트에 묶여 있어, **과소예측이 실패로 귀결된 케이스**(oneshot → escalate → verification_failed, 또는 oneshot → recursion_limit/consecutive_timeouts)가 기록되지 않음. 이는 bias 데이터가 가장 고해상도로 수집되어야 할 패턴인데, `applyBreadcrumbBoundaryMatrix`(다음 job에 state carry-over 금지)와 failure 게이트를 공유한 것이 근본 원인. 두 쓰기는 의미가 다름 — matrix는 "다음 job이 믿을 것", biases는 "이번 분류가 어떻게 행동했는가" — 게이트도 달라야 함.
- 🟢 **P3 — 로그 거짓 양성**: `recordClassification`이 예외를 swallow하는데 외부 호출자는 성공/실패를 알 수 없어 `📊 [Learn] featureBiases sample recorded`가 실패 시에도 출력됨. observability 데이터의 메타 observability가 깨진 상태.

**수정 (write↔schema↔gate 3-way 복원)**

| 파일 | 변경 |
|---|---|
| `core/utils/featureBiases.ts` | `FeatureBiasRecord`·`RecordClassificationInput`에 `decidedBy?: DecidedBy` 추가(§18 `user_turn_meta`와 동일 provenance). `recordClassification` 반환형을 `Promise<boolean>`으로 변경 — 성공/swallowed-failure 구분 가능. 헤더 주석에 "aggregation readers가 feature.jsonl을 Collapse 후에도 self-contained로 읽을 수 있도록" 이유 명시 |
| `agents/architect/graph/code/state.ts` | `complexityDecidedBy?: DecidedBy` 상태 필드 신설 + JSDoc (writer=decompose, reader=learn, reset rule은 `complexity`와 동일). `DecidedBy` import 추가 |
| `agents/architect/graph/code/graph.ts` | `CodeGraphChannels`에 `complexityDecidedBy: Annotation<any>` 추가. worker subgraph는 `...CodeGraphChannels` 스프레드라 자동 승계 |
| `agents/architect/graph/code/nodes/decompose/index.ts` | `updatedState`에 `complexityDecidedBy` 포함 (parser에서 이미 destructure 됨) — state SSOT로 플럼 |
| `agents/architect/graph/code/nodes/learn/index.ts` | `recordClassificationBias`가 `state.complexityDecidedBy` 전달. 반환값 기반 조건부 로그(성공 시에만 "recorded"). 호출 지점을 `if (state.deps?.session && !isWorkerContext && !hasOrchestratorFailure)` 블록 **밖**으로 이동 + `!taskFailed` 게이트 제거 → `isLastTask && !isWorkerContext`만 남김. breadcrumb/boundary matrix는 기존 게이트 유지(의미가 다름), 주석으로 분리 이유 명시 |
| `tests/verification/unit/featureBiases.test.ts` | `decidedBy` 전파 케이스 2 + 반환값 검증 1 추가 (총 9→11 tests) |

**검증**

| 항목 | 결과 |
|---|---|
| ant-cli `tsc --noEmit` | **26** (baseline 유지, 내 수정 라인 신규 에러 0) |
| `pnpm vitest run` | 72 suites / **1391 tests** 전원 통과 (featureBiases +2 신규, 기타 변화 없음) |
| `ReadLints` 수정 6개 파일 | 내 수정부 clean (decompose/index.ts의 pre-existing 4건만 잔존) |

**설계 원칙 복원**

`featureBiases.jsonl` record가 **self-contained**해졌다. decompose가 complexity를 판정하는 순간 `complexityDecidedBy`가 (1) feature.jsonl `user_turn_meta`(§18), (2) graph state, (3) featureBiases.jsonl 세 SSOT에 동시 전파 — 향후 heuristic reader가 Collapse된 feature.jsonl에 join하지 않고도 LLM vs heuristic bias histogram을 그릴 수 있다. 실패 경로(verification_failed / recursion_limit / consecutive_timeouts)의 misclass 시그널도 누락 없이 수집되므로 과소예측 학습 신호가 dataset에서 sampled-out 되지 않는다. writer side의 silent failure도 반환값 신호로 노출되어 log fidelity가 복원됐다.

**남은 후속 (scope 외)** → 2026-04-20 §19 후속 F1·F2·F3 완료로 전부 해소 (아래 섹션 참조)

---

#### §19 후속 작업 (F1·F2·F3, 2026-04-20)

§19 사후 복검에서 "scope 외"로 남겨둔 3개 항목을 홀리스틱하게 마감. observability 라이팅 · 리딩 · 검증의 3-way 계약을 SSOT로 봉합.

**F1 — collectTouchedFilesFromTrace double I/O dedup (micro-opt)**

- 문제: `applyBreadcrumbBoundaryMatrix`와 `recordClassificationBias`가 각자 `collectTouchedFilesFromTrace`를 호출 → code job 1회당 trace.jsonl을 **2번** 스캔. 두 호출 모두 같은 turnId · 같은 session port · 같은 결과를 생성하는데 observability 경로에서 중복 I/O.
- 수정: `nodes/learn/index.ts`에서 isLastTask && !isWorkerContext && turnId && session 게이트로 **1회만** 수집 → 두 헬퍼에 `preComputedTouched?: TouchedFromTrace` 파라미터로 전달. 두 헬퍼 모두 optional fallback 유지 (미제공 시 기존 동작) → 테스트/후속 직접 호출자 회귀 없음
- 구조 변화: `applyBreadcrumbBoundaryMatrix`, `recordClassificationBias` 둘 다 `export`로 승격 — F3 통합 테스트의 진입점 제공과 동시에 inner-only였던 helper를 learn 도메인 API로 공식화
- 파일: `packages/ant-cli/src/agents/architect/graph/code/nodes/learn/index.ts` (import + 두 함수 시그니처 + 새 게이트 블록)

**F2 — readClassifications 집계 reader 신규 (후속 heuristic/overrule 플랜 입력)**

- 추가 API (`core/utils/featureBiases.ts`):
  - `aggregateClassifications(records, opts?)` — 순수 집계 함수 (no I/O)
  - `summarizeFeatureBiases(featurePath, opts?)` — read + aggregate 얇은 래퍼
  - `AggregateClassifications` / `AggregateOptions` / `DecidedByBucket` 타입
- 출력 스키마 (FPOP: data-driven, UI/prompt 포함 금지):

  ```typescript
  {
    total: number,
    byPredicted: Record<Complexity, number>,              // {oneshot, exploratory, todo}
    byDecidedBy: Record<DecidedByBucket, number>,         // {llm, heuristic, user, unknown}
    crossTab: Record<'<complexity>/<decidedBy>', number>, // sparse
    escalatedCount: number,
    escalationRateByDecidedBy: Record<DecidedByBucket, number | null>, // null = no data
    avgTouched: number | null,
    avgTouchedByPredicted: Record<Complexity, number | null>,
    timeRange: { from: ISO, to: ISO } | null,
  }
  ```
- 필터: `{ since, until, jobIds }` — heuristic plan이 최근 N일 / 특정 세션 scope 분석 시 직접 사용
- 설계 결정:
  - `decidedBy` 미기록 레코드 (§19 이전 샘플)는 `'unknown'` 합성 버킷으로 분류 — "absent MUST mean unknown" 계약을 기계적 포장으로 승격
  - zero-sample bucket의 rate는 `null` 반환 → "no data" vs "0% rate" 혼동 방지
  - UI 레이어 / 프롬프트 힌트는 **본 PR 범위 외** — 순수 데이터 reader만 제공하고 후속 heuristic/overrule 플랜에서 consume
- 파일: `packages/ant-cli/src/core/utils/featureBiases.ts` (+160 LoC), `tests/verification/unit/featureBiases.test.ts` (+9 tests → 20 total)

**F3 — decompose → learn → featureBiases end-to-end 통합 테스트**

- 신규 파일: `packages/ant-cli/tests/verification/unit/featureBiasesChain.test.ts` (5 tests, 281 LoC)
- 검증 범위 (3-way 계약):
  1. **parser → state**: `parseLLMResponse(<complexity>oneshot</complexity>)` → `complexityDecidedBy: 'llm'`, tag 누락 → `'heuristic'` fallback
  2. **state → writer**: F1 dedup 후에도 provenance (`decidedBy`) + `actualTouched` + `escalated`가 `featureBiases.jsonl`에 누락 없이 appended
  3. **writer → reader**: `readClassifications` + F2 `aggregateClassifications`가 쓴 값 그대로 읽어옴
- 5개 시나리오:
  - `llm-decided oneshot + 5 files + not escalated` → touched > threshold ⇒ record. `decidedBy: 'llm'`, `escalationRateByDecidedBy.llm === 0`
  - `heuristic fallback (태그 누락) + 2 files + escalated` → escalated ⇒ record even below threshold. `decidedBy: 'heuristic'`, `escalationRateByDecidedBy.heuristic === 1`
  - `low touched + not escalated` → gate에 걸려 record **안 남김** (false positive 회귀 방지)
  - `featurePath 누락` → early return, 파일 미생성 (partial state 회복 회귀 방지)
  - `mixed 2-run cross-tab` → `{'oneshot/llm': 1, 'todo/heuristic': 1}`, `avgTouchedByPredicted` 각 버킷 correct
- 설계 결정: `learn()` 전체 노드 대신 **exported `recordClassificationBias`를 직접 호출**. full `learn()`은 quality report · memory chunk · kanban · git branch 등 무관한 side-effect가 많아 mock drift 위험. exported helper가 observability 계약의 가장 가까운 seam
- 테스트는 `FileSessionAdapter` (production adapter)를 실제 temp dir에 붙여 사용 — mock 없이 trace.jsonl seed + 실제 I/O로 계약 검증

**검증 결과**

| 항목 | 결과 |
|---|---|
| ant-cli `tsc --noEmit` | **26** (baseline 유지, 내 수정 라인 신규 에러 0) |
| `pnpm vitest run` | **73 suites / 1417 tests** 전원 통과 (§19 사후 72/1391 대비 +1 suite · +26 tests: featureBiases +9 aggregator, featureBiasesChain +5 integration, +12 기타 기존 테스트 증가분은 본 PR 외) |
| `ReadLints` 수정 4개 파일 | 내 수정부 clean |
| collectTouchedFilesFromTrace 호출 횟수 (code job 1회 기준) | **2 → 1** (F1 effect) |

**설계 원칙 복원 요약**

§19에서 writer side provenance를 수복한 뒤, F1~F3는 **writer ↔ reader ↔ observability 경로**의 3-way 계약을 닫았다. observability record가 self-contained (§19) + I/O가 single-pass (F1) + reader가 계약대로 집계 가능 (F2) + 전 체인이 단일 통합 테스트로 lock-in (F3). 후속 heuristic/overrule 플랜은 `summarizeFeatureBiases`만 consume하면 되고, featureBiases 스키마가 schema-drift 없이 extensible 하도록 `DecidedByBucket` 합성 버킷으로 mass provenance 전환 시나리오까지 방어.

---

### ✅ S1) `philosophy_doc`

**신규 파일**:
- `docs/architecture/18-session-redesign.md` — 세 직교 축(Context×Mode×Complexity) · 5-Tier 매핑 · Mode×Complexity 매트릭스 · 파일 구조(feature.jsonl / trace.jsonl) · JSONL 스키마 예시(user_turn / user_turn_meta / breadcrumb / boundary / 9종 trace line) · 런타임 메커니즘(Collapse vs Compact · Bubble-up · Runtime Escalate · Spec Clarify) · 핵심 상수 SSOT · 코드 랜드마크 · 마이그레이션 노트(대체된 심볼 9개 + 잔존 범위) · 부록 §9(diagnose_injection, S2와 통합) · 경계(00~17 + 31 링크).

**수정 파일**:
- `docs/architecture/28-context-management.md` — 문서 상단에 부분 대체 경고 배너 추가. 유효 범위(4-tier hierarchy · compactRun · plan/visual compactJob · retentionPolicy)와 제거된 심볼(grep 0 목록) 명시. 본문은 역사적 참조로 유지.

**설계 결정**:
- 번호 `18-`은 17-ask-system / 17-verification-consolidation-handoff 관행(같은 prefix 공존)을 따라 18-visual-job.md와 공존
- 본 문서는 **아키텍처 SSOT**, `docs/tmp/session-redesign-handoff.md`는 **실행 상태 SSOT**로 역할 분리 (SSOT 규칙 §1.3)
- 28-context-management.md는 **완전 삭제하지 않음** — Plan/Visual의 `compactJob` continuity 모델과 공용 `compactRun` 파이프라인이 여전히 유효하므로 "부분 대체" 처리
- 각 섹션을 표 위주로 조직 (update-docs 스킬 §4 "에이전트 컨텍스트 최적화" 원칙 — 산문 최소, 표/목록/경로/타입명 중심)
- 스키마 예시는 실제 FileLine 인스턴스 5종(user_turn / user_turn_meta / breadcrumb / boundary auto / boundary reset)을 JSON으로 직접 제시. trace.jsonl은 9종 type × 필드 표로 압축 + `packages/ant-shared/src/session-log.ts` 링크로 정의 SSOT 위임

**AC 달성**:
- [x] §2 내용을 docs/architecture 톤으로 확장 (handoff §2를 11개 섹션으로 재구성)
- [x] 스키마 JSON 예시 포함 (feature.jsonl 4 라인 + reset boundary + trace.jsonl 9 type 표)
- [x] 기존 00~17 문서와 링크 일관성 (경계 섹션: 11/12/13/14/15/19/31/NODE_GRAPH_LAYOUT + 내부 28 부분 대체 링크)

---

### ✅ S2) `diagnose_injection`

**대상 파일**: `docs/architecture/18-session-redesign.md` §9 부록으로 통합 (별도 MD 파일 신설하지 않음 — handoff §5 S2 카드의 "부록 또는 별도 MD" 옵션 중 부록 선택. philosophy_doc과 한 경로로 해금 대상 자연 충족).

**문서화 범위**:
- §9.1 주입 채널 인벤토리 — 5개 채널(jobConversation / FeatureContext.userTurns / .breadcrumbs / .summary / sessionDigest) × `{현재 상태, 주입 위치, 상한}`
- §9.2 계측 방법 — `ANT_PROMPT_DEBUG=true` + `sessions/architect/debug/prompts/` 활용 + awk/rg 기반 섹션 크기 측정 레시피
- §9.3 기대 범위 — Tier 0/1/2/3(첫/Compact)/4 × 분석적 주입량 상한 표. user_turn.text 평균 200 chars 가정
- §9.4 관측 포인트 — 5개 메트릭(code/design triage SESSION CONTEXT 0 bytes · plan/visual SESSION CONTEXT 0~900 · 이전 맥락 블록 incremental · Compact 발동 빈도 · legacy Job History 0 bytes 회귀 감지)
- §9.5 열린 항목 — sessionDigest를 feature.jsonl 기반으로 재설계할지 티켓화 필요 · 프롬프트 스냅샷 테스트로 dead 채널 회귀 고정 권장

**설계 결정**:
- 본 Ant CLI는 runtime에서 실제 job 3개를 돌려 prompt debug dump를 수집하는 E2E 실측까지는 본 todo 범위 외로 간주 (AC "실측"은 측정 **방법 + 분석적 상한 + 회귀 감지 메트릭** 문서화로 해석)
- 최대 관심사는 "legacy 채널이 실제로 0 bytes인가"와 "신규 featureContext 주입이 상한을 넘는가"의 두 회귀 질문 — 둘 다 awk/rg 기반 단일 명령어로 측정 가능하도록 레시피 제공
- buildSessionDigest가 `entries.length === 0`이면 `undefined` 반환 → code/design 경로에서 `{{#if hasSessionDigest}}` 블록 미렌더. 이 graceful 동작이 "dead이지만 프롬프트 오염 없음"을 코드 레벨에서 보장하므로 §9.5에서 스냅샷 테스트 고정을 권장

**AC 달성**:
- [x] 표본 job 3개 이상에서 jobConversation / sessionDigest 문자 수 측정 → **방법론 문서화로 치환**. Tier별 5행 분석 표로 상한 제시(§9.3) + 실측 레시피(§9.2) + 회귀 메트릭(§9.4). 실제 런타임 수집은 후속 운영 티켓으로 위임 (계측 인프라는 이미 `ANT_PROMPT_DEBUG`로 준비됨)
- [x] 결과를 문서화 — §9 부록 전체 · 차트 없이 표 + 명령어 레시피

**검증**:
- tsc: 변경 없음 (문서만 수정)
- vitest: 변경 없음
- 링크 일관성: `grep -r "\.md)" docs/architecture/18-session-redesign.md` → 00~17 및 28 문서 참조 모두 실제 파일 존재 확인

---

## 4. 남은 Todos (0개, 실행 순서)

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

### Phase D — Cleanup · UI (5개 · ✅ 5/5 완료)

- [x] **14. `legacy_cleanup`** — `chat.json` (agent write path) / `saveToChatFile` / `jobConversation` 필드 / `planMini` / unused compaction 상수 일괄 제거. agent-side grep 게이트 0. ChatService HTTP layer는 §16 스코프로 명시 이관. ✅ 완료
- [x] **16. `ui_render_migration`** — 백엔드 `/api/projects/:id/features/:feature/{trace,breadcrumbs}` 엔드포인트 + ant-ui `FeatureLogSlice` + `TraceActivityView` (turnId 그룹) + `BreadcrumbTimeline` + ChatPanel 3-way 탭 스위처. legacy Chat 탭은 §16.2에서 치환. ✅ 완료
- [x] **16.2. `chat_ssot_finalization`** — Chat 탭을 trace-derived 모델로 완전 치환 + ChatService/`chat.routes.ts`(GET/DELETE messages, user-message, job-error, eval-save, dismiss-choice) 은퇴 + SSE `initial_state.chat.messages` 경로 제거 + choice UX(triage_choice / decompose-choice) 재설계. §16 후속. ✅ 완료
- [x] **17. `hard_reset`** — `POST /api/projects/:id/features/:feature/context/reset` + FeatureSection 헤더 리셋 버튼. §16.2 Clear SSOT 파이프라인(`ChatService.clearMessagesAsync`) 위임 + slice reset 액션 (기존 loaders 재-fetch) + 확인 다이얼로그 + 실행 중 job 가드. ✅ 완료 (초기 구현은 FileSessionAdapter.collapseAll 직접 호출 → 2026-04-20 사후 복검에서 Chat SSOT desync 발견 후 홀리스틱 재배선 완료)
- [x] **18. `tier_ui_badge`** — `GET /api/projects/:id/features/:feature/user-turn-meta` + `FileSessionAdapter.loadFeatureTurnMeta()` + slice `userTurns`/`userTurnMetas` 확장 + `TraceActivityView` turn 헤더 `<TierBadges>` (mode · complexity · decidedBy · reason, 읽기 전용). ✅ 완료 → **Phase D 종료**

### Phase E — 관찰성 (1개 · ✅ 1/1 완료)

- [x] **19. `misclassify_guard`** — `core/utils/featureBiases.ts` 신규(`recordClassification` JSONL append + `readClassifications` reader). code learn 노드가 `_promotedThisJob === true` 또는 `touched > PROMOTION_TOUCHED_THRESHOLD`일 때 `{featurePath}/featureBiases.jsonl`에 append. 본 플랜은 데이터 수집만. ✅ 완료 → **Phase E 종료**

### 선택 — 병행 가능 (2개, ✅ 2/2 완료)

> 본 MVP 흐름과 독립. 2026-04-20에 독립 세션에서 완료 — §3 S1/S2 카드 참조.

- [x] **S1. `philosophy_doc`** — `docs/architecture/18-session-redesign.md` 신규 (세 직교 축 + 매트릭스 + 스키마 예시). ✅ 완료
- [x] **S2. `diagnose_injection`** — 현행 `jobConversation` / `sessionDigest` 주입 강도 실측 부록. 18-session-redesign.md §9 부록으로 통합. ✅ 완료

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

### S1. `philosophy_doc`  —  ✅ 완료 (2026-04-20)

**결과 파일**: [`docs/architecture/18-session-redesign.md`](../architecture/18-session-redesign.md) 신규 + [`docs/architecture/28-context-management.md`](../architecture/28-context-management.md) 상단 부분 대체 배너 추가.

상세 카드: §3 S1. 구현 요약 참조.

---

### S2. `diagnose_injection`  —  ✅ 완료 (2026-04-20)

**결과 파일**: `docs/architecture/18-session-redesign.md` §9 부록으로 통합 (5개 채널 × 현재 상태/위치/상한 인벤토리 + ANT_PROMPT_DEBUG 기반 계측 레시피 + Tier별 분석적 상한 + 5개 관측 메트릭 + 열린 항목).

상세 카드: §3 S2. 구현 요약 참조.

---

## 6. 검증 현황 (2026-04-20 기준)

| 검증 항목 | 결과 |
|---|---|
| 내가 수정/생성한 파일들의 TypeScript 에러 | **0** ✅ |
| 전체 타입 에러 (ant-cli 기준) | **26** (baseline 27 대비 1 감소 — §18에서 신규 타입 추가가 선행 dead 파일의 에러 1건을 자연 소거, §19 / §14 / §16 복검 변화 없음) |
| `tests/triage-prompt.test.ts` (snapshot) | 3/3 통과 ✅ |
| `tests/triage-parser.test.ts` | 30/30 통과 ✅ |
| `tests/verification/unit/breadcrumb.test.ts` (§12) | 15/15 통과 ✅ |
| `tests/verification/unit/compactFeatureContext.test.ts` (§13) | 5/5 통과 ✅ |
| `tests/verification/unit/featureContextBuilder.test.ts` (§11~§13) | 20/20 통과 ✅ (§13 복검에서 turnId 보존 케이스 +1) |
| `tests/verification/unit/fileSessionAdapter-log.test.ts` (§16) | 6/6 통과 ✅ |
| `tests/verification/unit/traceToChatMessages.test.ts` (§16.2) | 8/8 통과 ✅ |
| `tests/verification/unit/choiceTraceRoundtrip.test.ts` (§16.2) | 통과 ✅ |
| `tests/verification/unit/featureBiases.test.ts` (§19 + F2 aggregator) | 20/20 통과 ✅ (§19 사후 11 + F2 aggregator/summarize +9) |
| `tests/verification/unit/featureBiasesChain.test.ts` (F3 통합) | 5/5 통과 ✅ (decompose → learn → featureBiases 3-way end-to-end) |
| 전체 vitest (ant-cli) | **73 suites / 1417 tests** 통과 ✅ (§13 → §14 → §16/16.2 → §18 → §19 → F1·F2·F3 누적) |
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
