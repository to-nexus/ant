# 18. Session Redesign (Three Orthogonal Axes + 5-Tier Execution)

> **Status**: §3 Phase B~E 구현 완료 (2026-04-20). 본 문서는 실행 SSOT([`docs/tmp/session-redesign-handoff.md`](../tmp/session-redesign-handoff.md))를 `docs/architecture/` 톤으로 정착시킨 **아키텍처 SSOT**. 인수 시점 이후의 설계/배선 변경은 이 문서를 먼저 갱신한다.
> **선행 계획서**: `/Users/probe/.cursor/plans/ant_5-tier_execution_model_cc518235.plan.md`
> **코드 기준**: `8277b313` + §1~§19 (docs/tmp/session-redesign-handoff.md Phase B~E 반영)

---

## 0. 한 줄 요약

Context(구조) × Mode(의도) × Complexity(규모) **세 직교 축의 곱집합**을 **5-Tier**로 라우팅한다. 세션 저장은 `feature.jsonl`(프롬프트 맥락 SSOT) + `trace.jsonl`(UI 렌더 SSOT) **2-파일 분리**. 이전의 `jobConversation` Inter-Job Context Bridge (28-context-management.md §2)는 본 재설계로 **완전히 대체**됐다.

---

## 1. 세 직교 축

| 축 | 값 | 결정자 | 결정 시점 |
|---|---|---|---|
| **Context** (구조) | T1 Artifact / T2 user_turn / T3 Breadcrumb | 구조적 (파일 저장 레이어) | `feature.jsonl` append 시점 |
| **Mode** (의도) | `generate` / `refactor` / `explain` | **Detect 노드** (`ResolvedAction.mode`) | Triage 직전 |
| **Complexity** (규모) | `oneshot` / `exploratory` / `todo` | **Decompose 노드** (LLM 3-way 판정) | decompose LLM 1회 호출 |

설계 제약:
- 세 축은 서로 **교환 불가**. 한 축이 다른 축을 함의하지 않는다. (예: `explain`도 `todo`가 될 수 있고 `generate`도 `oneshot`일 수 있음)
- Heuristic/Overrule은 **제외**. MVP는 LLM 판정만 신뢰 (D10)
- Tier 내부는 균일 — 같은 Tier 셀에 도달한 실행은 **동일 파이프라인 + 동일 프롬프트**를 쓴다 (D11). 프롬프트가 `taskQueue.size`, `touched 수` 같은 런타임 관측치로 if/else 분기하지 않는다.

---

## 2. Mode × Complexity 매트릭스 → 5-Tier

### 2.1 5-Tier 정의

| Tier | 이름 | Mode | Complexity | 경로 | 특징 |
|---|---|---|---|---|---|
| 0 | Reflex | `explain` | oneshot + tool 0~1 | `direct` (read-only) | 최소 비용, read-only tools만 |
| 1 | One-shot | 모두 | oneshot | `direct` | 1~2 step ReAct |
| 2 | Exploratory | 모두 | exploratory | `direct` (ReAct) | 최대 `ANT_DIRECT_MAX_STEPS`(=10) step |
| 3 | Todo | `generate`/`refactor` | todo | `decompose → plan → execute` | 기존 full pipeline |
| 4 | Plan | — | — | `design` / `plan` (별도 jobtype) | Mode×Complexity 미적용 (D5) |

### 2.2 판정 매트릭스 (Decompose 프롬프트 출력 shape)

| Mode | Complexity | `<tasks>` | `<directHints>` |
|---|---|---|---|
| `explain` | oneshot | `[]` | `{ "explorationScope": "..." }` |
| `explain` | exploratory | `[]` | `{ "explorationScope": "..." }` |
| `explain` | todo | 1 explain task (priority 200) | `{}` |
| `generate`/`refactor` | oneshot | `[]` | `{ "targetFiles": [...] }` |
| `generate`/`refactor` | exploratory | `[]` | `{ "explorationScope": "..." }` |
| `generate`/`refactor` | todo | 전체 breakdown | `{}` |

### 2.3 메타데이터 정책 매트릭스 (feature.jsonl 기록)

| Mode | Complexity | T2 (user_turn) | T3 (breadcrumb) | Boundary |
|---|---|---|---|---|
| `explain` | 모두 | 기록 | ❌ (T1 무수정) | `todo`만 ✅ |
| `generate`/`refactor` | oneshot | 기록 | ❌ | ❌ |
| `generate`/`refactor` | exploratory | 기록 | `touched ≥ 3` → mini-BC | ❌ |
| `generate`/`refactor` | todo | collapse(boundary 시) | ✅ bubble-up | ✅ `auto_job_complete_todo` |
| `ask`/`inline-ask` | — | **미기록** (feature.jsonl 안 감) | ❌ | ❌ |

**Hard Reset**은 축에 무관한 별도 이벤트 — `FeatureBoundaryLine.reason = 'user_reset'`, `jobType = 'reset'`.

---

## 3. 파일 구조 & SSOT 분리

### 3.1 디렉토리 레이아웃

```
{featurePath}/sessions/
├── feature.jsonl            ← NEW: 맥락 SSOT (T2 + T3 + boundary)
├── trace.jsonl              ← NEW: UI 채팅 렌더 SSOT (모든 이벤트)
├── architect/
│   ├── code.json            ← 기존 — 재개 체크포인트 전용 (§14에서 jobConversation 필드 제거)
│   ├── design.json
│   └── learn.json
├── planner/
│   └── plan.json
└── creator/
    └── visual.json
```

### 3.2 책임 MECE

| 파일 | 책임 | 생명주기 | 소비자 | 기록자 |
|---|---|---|---|---|
| `feature.jsonl` | LLM 프롬프트 주입용 맥락 SSOT | 영속 (append-only, Collapse 마킹) | `resolve` 노드 → `featureContextBuilder` | `FileSessionAdapter.appendUserTurn/Meta/Breadcrumb/Boundary` |
| `trace.jsonl` | UI 채팅 렌더 SSOT | 영속 (append-only) | UI(`/trace` HTTP GET) | tool 노드 / direct 노드 / learn 노드 |
| `architect/code.json` 등 | 재개 체크포인트 (세션 state) | job 완료/실패 시 갱신 | LangGraph runner (resume 경로) | `FileSessionAdapter.save/updateArtifacts` |

**user_turn만 양쪽 복제**. feature.jsonl은 `text + mode`, trace.jsonl은 `text + sourceRef`로 링크.

### 3.3 라우트 매핑

| HTTP 엔드포인트 | 파일 | 연결 |
|---|---|---|
| `GET /api/projects/:id/features/:feature/trace` | `trace.jsonl` | Activity 뷰 |
| `GET .../breadcrumbs` | `feature.jsonl` breadcrumb 라인 | Timeline 뷰 |
| `GET .../user-turn-meta` | `feature.jsonl` user_turn + user_turn_meta | turn 헤더 배지 |
| `POST .../context/reset` | `collapseAll('user_reset')` | Hard Reset 버튼 |
| `POST .../chat/decompose-choice` | session state | Spec Clarify 3-way 응답 |

---

## 4. JSONL 스키마 예시

### 4.1 feature.jsonl 라인 타입

```jsonc
// user_turn — 사용자 원본 directive
{
  "type": "user_turn",
  "ts": "2026-04-20T09:12:03.421Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "text": "Add dark mode toggle to the settings page.",
  "mode": "generate"
}

// user_turn_meta — complexity 판정 패치 (decompose 후 learn에서 append)
{
  "type": "user_turn_meta",
  "ts": "2026-04-20T09:12:45.108Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "complexity": "todo",
  "decidedBy": "llm",
  "reason": "multi-file feature spanning UI + theme context"
}

// breadcrumb — bubble-up된 작업 흔적 앵커
{
  "type": "breadcrumb",
  "ts": "2026-04-20T09:18:22.910Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "mode": "generate",
  "scope": "modification",
  "anchors": {
    "specs": ["docs/ui-spec.md"],
    "paths": ["src/components/settings", "src/theme"],
    "files": ["src/components/settings/Toggle.tsx"]
  },
  "summary": "settings page: dark mode toggle wiring",
  "stats": { "created": 2, "modified": 5, "touched": 7 },
  "traceRangeRef": {
    "startTs": "2026-04-20T09:12:45.108Z",
    "endTs": "2026-04-20T09:18:22.000Z"
  }
}

// boundary — 맥락 경계 (todo 완료 또는 Hard Reset)
{
  "type": "boundary",
  "ts": "2026-04-20T09:18:23.001Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "reason": "auto_job_complete_todo"
}

// Hard Reset — jobType widening
{
  "type": "boundary",
  "ts": "2026-04-20T11:02:11.000Z",
  "jobId": "reset-7f8g9h",
  "turnId": "t-reset",
  "jobType": "reset",
  "reason": "user_reset"
}
```

### 4.2 trace.jsonl 라인 타입 (요약)

| `type` | 필드 | 기록자 |
|---|---|---|
| `user_turn` | `text`, `sourceRef` (`feature.jsonl#<turnId>` \| `ask-only`) | orchestrator `recordUserTurn` |
| `assistant_thinking` | `text` | direct/execute LLM 스트리밍 |
| `tool_call` | `tool`, `args`, `result`, `error?` | `ToolOrchestrator` (TraceAppender) |
| `file_write` | `path`, `operation: create\|update\|delete`, `diff?` | tool/direct `emitFileWriteTrace` |
| `run_command` | `cmd`, `stdout`, `stderr`, `exitCode` | run_command tool handler |
| `job_status` | `phase`, `progress?`, `message?` | LLMResponseService |
| `assistant_message` | `text` | LLMResponseService (finalize) |
| `choice_presented` | `cardId`, `cardType`, `prompt?`, `payload?` | triage/decompose-clarify/eval-save 등 |
| `choice_resolved` | `cardId`, `choiceSelected`, `resolvedLabel`, `answer?` | choice 라우트 핸들러 |

공통 필드: `ts`, `jobId`, `turnId`, `jobType`, `collapsed?: true`.

전체 타입 정의: [`packages/ant-shared/src/session-log.ts`](../../packages/ant-shared/src/session-log.ts).

---

## 5. 런타임 메커니즘

### 5.1 Collapse vs Compact (orthogonal)

| | Collapse | Compact |
|---|---|---|
| **트리거** | Boundary append 시점 (쓰기) | resolve 노드 읽기 시점 (T2 토큰 > `FEATURE_CONTEXT_THRESHOLD`) |
| **대상** | `loadSinceBoundary` 이전의 모든 user_turn / meta / breadcrumb | window 초과 T2 user_turn (breadcrumb는 제외) |
| **수단** | `collapsed=true` 마킹 (파일 보존) | LLM 요약 → `FeatureContext.summary` 별도 필드 |
| **비용** | I/O만 (LLM 없음) | 1회 LLM call (graceful degradation: 실패 시 원형 반환) |
| **구현** | `FileSessionAdapter.appendBoundary` / `collapseAll` | `core/context/featureContextBuilder.ts#compactFeatureContext` |

두 메커니즘은 **직교**. Compact는 상한을 못 맞출 때 보강하는 안전망, Collapse는 `todo` 완료 시 정식 경계.

### 5.2 Breadcrumb Bubble-up (T3)

`core/context/breadcrumb.ts#buildBreadcrumb`:

| touched 수 | 앵커 shape |
|---|---|
| `≤ BREADCRUMB_THRESHOLDS.SMALL` (10) | `files[]` 그대로 (최대 10) |
| `≤ BREADCRUMB_THRESHOLDS.MEDIUM` (50) | top-level `paths[]` 패턴 승격 (최대 5) |
| `≤ BREADCRUMB_THRESHOLDS.LARGE` (200) | `specs[]` + top-level `paths[]` (각 ≤ 3 / ≤ 5) |
| `> LARGE` | `initial_creation` scope로 승격, `summary` 중심 |

scope 판정: `mode === 'refactor'` → `refactor` 우선 / `touched > LARGE` → `initial_creation` / 그 외 → `modification`. touched SSOT은 **`trace.jsonl`의 `file_write` 라인**.

### 5.3 Runtime Escalate (direct → decompose 승격)

direct 노드 ReAct 루프 내부에서 `shouldEscalate(state, touchedFiles)` 게이트:

- 조건: `touched.size > PROMOTION_TOUCHED_THRESHOLD` (=3) **또는** LLM `<needsEscalation>true</needsEscalation>` 태그
- 상한: **job당 1회** (`state._promotedThisJob` 플래그) — 재승격 시 `routeAfterDirect`가 `learn`으로 안전 복귀
- 3중 가드: `_promotedThisJob` / LangGraph `recursionLimit` / `recursionCount` tracking
- 구현: [`nodes/direct/shouldEscalate.ts`](../../packages/ant-cli/src/agents/architect/graph/code/nodes/direct/shouldEscalate.ts), `routeAfterDirect` at [`code/routing.ts`](../../packages/ant-cli/src/agents/architect/graph/code/routing.ts)

### 5.4 Spec Clarify (Decompose가 소유)

`generate/refactor + todo` 요청인데 spec 부재 시 Decompose가 `<specClarify>` emit → LangGraph `__end__` 경유 → UI가 3-way choice 카드 렌더:

| action | 효과 |
|---|---|
| `redirect_to_design` | 현 code job → failed, 동일 directive로 design job enqueue |
| `proceed_without_spec` | `_specClarifyBypassed=true` 기록 → `isResume: true` 재개 |
| `cancel` | `markUserStopped` + failed + idempotency lock release |

발동 조건 4-AND: `mode ∈ {generate, refactor}` ∧ `complexity === 'todo'` ∧ spec 부재 ∧ system-design 부재. Triage에서 처리하던 design redirect 책임은 Decompose로 **완전히 이관**됐다 (§4 `triage_scope_cleanup` 참조).

---

## 6. 핵심 상수 (SSOT)

모두 [`packages/ant-shared/src/session-log.ts`](../../packages/ant-shared/src/session-log.ts)에서 export.

| 상수 | 값 | 용도 |
|---|---|---|
| `FEATURE_CONTEXT_THRESHOLD` | 12000 (tokens) | Compact 트리거 임계값 (T2 user_turn 합산) |
| `FEATURE_CONTEXT_WINDOW` | 6 | Compact 시 보존할 최신 user_turn 개수 |
| `BREADCRUMB_THRESHOLDS` | `{SMALL:10, MEDIUM:50, LARGE:200}` | bubble-up 경계 |
| `BREADCRUMB_LIMITS` | `{specs:3, paths:5, files:10}` | 앵커 개수 상한 |
| `DIRECT_LOOP_LIMITS` | `{oneshot:2, exploratory:10}` | direct 노드 ReAct 루프 상한 (후자는 `ANT_DIRECT_MAX_STEPS`로 override) |
| `PROMOTION_TOUCHED_THRESHOLD` | 3 | direct → decompose 승격 touched 임계 |
| `DEFAULT_BREADCRUMB_WINDOW` | 5 | `featureContext.breadcrumbs` 렌더 최신 N개 (별도: `core/context/featureContextBuilder.ts`) |

---

## 7. 코드 랜드마크

| 파일 | 역할 |
|---|---|
| `packages/ant-shared/src/session-log.ts` | 전체 FeatureLine / TraceLine 타입 + 상수 SSOT |
| `packages/ant-cli/src/core/utils/sessionPaths.ts` | `getFeatureJsonlPath` / `getTraceJsonlPath` |
| `packages/ant-cli/src/core/ports/session.ts` | `SessionPort` (append* / load* / collapse*) |
| `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` | 유일 구현체. per-file mutex 동시성 안전 |
| `packages/ant-cli/src/composition/recordUserTurn.ts` | orchestrator → 2-file user_turn atomic append |
| `packages/ant-cli/src/core/context/featureContextBuilder.ts` | `buildFeatureContext` / `mergeFeatureContext` / `compactFeatureContext` |
| `packages/ant-cli/src/core/context/breadcrumb.ts` | `buildBreadcrumb` / `collectTouchedFilesFromTrace` |
| `packages/ant-cli/src/core/utils/featureBiases.ts` | `recordClassification` / `readClassifications` (misclassify 계측 §19) |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/` | 3-way complexity 판정 + `<specClarify>` emit |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/` | ReAct 루프 + `shouldEscalate` |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/{resolve,learn}/index.ts` | feature.jsonl 소비/생산 |
| `packages/ant-cli/src/agents/architect/graph/code/routing.ts` | `routeAfterDecompose` 4-way / `routeAfterDirect` |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md` | Complexity Classification + Spec Clarify 섹션 |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/base.md` | `{{#if featureContext}}` 주입 블록 |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/{base,rules}.md` | WHAT/HOW 분리 |
| `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` | `/trace` `/breadcrumbs` `/user-turn-meta` `/context/reset` |
| `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` | UI Zustand 슬라이스 |
| `packages/ant-ui/src/presentation/components/chat/feature-log/` | `TraceActivityView` / `BreadcrumbTimeline` / `useFeatureLogSync` |

---

## 8. 마이그레이션 노트 (무엇이 대체됐는가)

| 이전 (28-context-management.md) | 현재 (본 문서) | 상태 |
|---|---|---|
| `session.state.jobConversation: ConversationEntry[]` | `feature.jsonl` + `featureContext` state 채널 | **필드 제거 완료** (§14 legacy_cleanup) |
| `compressHeavyweightEntries` (Trigger 2) | — (heavyweight boundary 개념 폐기) | **함수 삭제** |
| `compactJob` on jobConversation (Trigger 1) | `compactFeatureContext` on `FeatureContext.userTurns` | 함수는 재사용, caller 교체 |
| `CODE_JOB_COMPACTION_THRESHOLD` / `DESIGN_JOB_COMPACTION_*` | `FEATURE_CONTEXT_THRESHOLD` (12000) | **상수 삭제** (code/design 경로만) |
| `jobs/code/base/injections/job-history.md` | `{{#if featureContext}}` block in `plan/base.md`, `direct/base.md` | **파일 삭제** |
| `jobs/design/base/injections/job-history.md` | (동일, design은 채널만 주입 — 서브그래프 프롬프트 미수정, D5) | **파일 삭제** |
| `infra/compaction/job-summary.md` | — | **파일 삭제** |
| `chat.json` (agent-side 쓰기) | `trace.jsonl` | **agent 쓰기 제거 완료** (§14). ChatService HTTP 레이어는 §16.2에서 치환 예정 |
| `saveToChatFile` / `flushToChatFile` / `getChatSessionPath` | — | **삭제** |
| `ChatStatusReporter.flush()` | — | 인터페이스에서 제거 |
| Triage Step 6 "Scope Routing" | Decompose `<specClarify>` | 프롬프트 단계 이관 (§4 `triage_scope_cleanup`) |

**28-context-management.md**의 "Inter-Job Context Bridge" 섹션은 본 문서로 **완전 대체**됐다. Plan/Visual (Context Continuity) 경로의 `compactJob` 사용은 유지된다 — 세 직교 축은 아직 code/design에만 적용.

**plan/visual의 `sessionDigest`** (buildSessionDigest → triage 프롬프트 `{{#if hasSessionDigest}}` 섹션)는 잔존한다. code/design은 `state.conversations[SESSION_MAIN]`을 더 이상 채우지 않기 때문에 해당 경로의 triage는 항상 sessionDigest 없이 렌더된다. plan/visual은 여전히 `conversation` continuity 모델을 쓰므로 sessionDigest가 활성 상태. 자세한 계측은 §9 부록 참조.

---

## 9. 부록 — 주입 현황 진단 (diagnose_injection)

> **목적**: 본 재설계가 실제로 프롬프트에 얼마나의 "이전 맥락"을 주입하는지, legacy 채널(sessionDigest / jobConversation)이 어디까지 비활성화됐는지 실측 가능한 형태로 문서화한다.

### 9.1 주입 채널 인벤토리 (2026-04-20 기준)

| 채널 | 현재 상태 | 주입 위치 | 상한 |
|---|---|---|---|
| `state.jobConversation` → `job-history` partial | **완전 제거** | — (템플릿 파일 삭제) | 0 bytes |
| `FeatureContext.userTurns` | **활성** (code/design resolve) | `plan/base.md`, `direct/variants/default/base.md` — `{{#each featureContext.userTurns}}` | window 6 until Compact 트리거 |
| `FeatureContext.breadcrumbs` | **활성** (code/design resolve) | 위 템플릿 — `{{#each featureContext.breadcrumbs}}` | `DEFAULT_BREADCRUMB_WINDOW` = 5 (각 summary 수십~수백 chars) |
| `FeatureContext.summary` | **활성** (Compact 발동 시) | 위 템플릿 — "Earlier Context (summary)" 블록 | `COMPACTION_MAX_OUTPUT_TOKENS` = 16384 |
| `sessionDigest` (triage) | **code/design: dead / plan/visual: 활성** | `jobs/shared/nodes/triage/variants/default/base.md` — `{{#if hasSessionDigest}}` | 최근 3 entries × 300/200 chars |

### 9.2 계측 방법

Ant는 `ANT_PROMPT_DEBUG=true` 환경변수로 모든 렌더된 프롬프트를 `{featurePath}/sessions/architect/debug/prompts/*.md`에 저장한다. 각 Tier별 단일 job을 기동한 뒤 해당 디렉터리에서 다음을 측정:

```bash
# sessionDigest 섹션 크기
awk '/^## SESSION CONTEXT$/,/^##|^---/' <prompt.md> | wc -c

# featureContext 섹션 크기
awk '/^## 이전 맥락/,/^## |^---/' <prompt.md> | wc -c

# jobConversation / job-history 잔재 체크 (항상 0이어야 함)
rg -c '## (Previous Work|Completed Work Boundary|Job History)' <prompt.md>
```

### 9.3 기대 범위 (분석적 상한)

`user_turn.text`를 평균 200 chars로 가정:

| Tier | 시나리오 | featureContext 예상 주입량 |
|---|---|---|
| 0/1 Reflex/Oneshot | 첫 요청 (공 feature.jsonl) | 0 chars (블록 자체 미렌더) |
| 2 Exploratory | 최근 5 turn + 3 mini-BC | `5 × 200 + 3 × 120 ≈ 1.4 KB` |
| 3 Todo (첫 실행) | 최근 6 turn + 5 breadcrumb | `6 × 200 + 5 × 120 ≈ 1.8 KB` |
| 3 Todo (Compact 발동) | summary + 6 turn + 5 BC | summary ≤ 64 KB (16384 tokens × 4) + 1.8 KB. 실측 평균은 2~5 KB |
| 4 Plan/Visual (sessionDigest 활성) | 3 recent entries | ≤ 900 chars (300+200+200 + 구분자) |

### 9.4 관측 포인트

| 메트릭 | 의미 | 정상 범위 |
|---|---|---|
| feature.jsonl 이후 triage 프롬프트에서 `## SESSION CONTEXT` 섹션 | code/design 요청에서 0 bytes여야 함 (`sessionMain`이 비어있음) | 0 bytes |
| plan/visual 요청에서 `## SESSION CONTEXT` | `buildSessionDigest`가 채움 | 0~900 chars |
| plan/direct 프롬프트에서 `## 이전 맥락` 블록 | 첫 요청 0, 이후 incremental | turn 수에 비례 |
| Compact 발동 빈도 | T2 누적 토큰 > 12000일 때만 | 일반 feature에서 수십 turn 이상 축적 시 |
| legacy "Job History" / "Completed Work Boundary" 섹션 | 완전 dead | **항상 0 bytes** (회귀 감지 시 §14 cleanup 위반) |

### 9.5 열려 있는 항목

- triage의 `sessionDigest` 섹션을 feature.jsonl 기반으로 재설계할지 별도 티켓 필요. 현재 plan/visual이 `session.state.conversation` 모델을 유지하는 한 legacy sessionDigest는 그대로 둔다.
- buildSessionDigest가 `entries.length === 0`이면 `undefined` 반환 → code/design triage 렌더에서 블록 자체가 미노출되므로 "dead 채널"이 프롬프트를 오염시키지 않는다. 이를 회귀 감지용 프롬프트 스냅샷 테스트에 고정하는 것이 바람직 (후속 티켓).

---

## 경계

- **직접적 후속**: [`docs/tmp/session-redesign-handoff.md`](../tmp/session-redesign-handoff.md) — 실행 SSOT (각 todo별 카드 + 검증 결과)
- **대체한 문서**: [`28-context-management.md`](./28-context-management.md) — §2 "Context Isolation" / "Inter-Job Context Bridge" 섹션은 본 문서로 대체됨. Continuity(plan/visual)·`compactRun`·`retentionPolicy` 부분은 여전히 유효.
- **연관 문서**:
  - [`11-agent-architecture.md`](./11-agent-architecture.md) — LangGraph StateGraph 배선
  - [`12-triage-routing.md`](./12-triage-routing.md) — Detect / Triage intent 판정
  - [`13-prompt-system.md`](./13-prompt-system.md) — Handlebars 템플릿 엔진
  - [`14-code-job.md`](./14-code-job.md) — code 그래프 세부
  - [`15-design-job.md`](./15-design-job.md) — design 그래프 (Mode×Complexity 미적용, D5)
  - [`19-tool-system.md`](./19-tool-system.md) — tool 사이드이펙트 → trace.jsonl file_write
  - [`31-chat-system.md`](./31-chat-system.md) — ChatService / chat.routes (§16.2에서 trace.jsonl 기반으로 치환 예정)
  - [`NODE_GRAPH_LAYOUT.md`](./NODE_GRAPH_LAYOUT.md) — Phase node task-type blindness (R1)
