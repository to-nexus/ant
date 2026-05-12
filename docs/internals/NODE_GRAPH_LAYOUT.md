# Node Graph Layout — 에이전트 그래프 디렉토리 정규화 규칙

> **적용 범위**: `packages/ant-cli/src/agents/{agent}/graph/{job}/` 하위 모든 LangGraph StateGraph.
> **목적**: task type·phase·도메인 책임이 디렉토리 축에 일관되게 응집되도록 강제한다.
> **관련 문서**: [14-code-job.md](./14-code-job.md), [17-code-verification-task.md](./17-code-verification-task.md), [`.cursorrules`](../../.cursorrules) `Node Graph Layout — Task Type Blind Phases (R1)` 섹션.

---

## 1. 왜 이 규칙인가

- LangGraph 그래프가 커지면 `task.type === '...'` 분기, 도메인 state 필드, carry-over 로직, 훅/핸들러가 phase 노드·routers·parallel·tool handlers 전반에 산발한다.
- "verification 한 번 정리"로 끝나지 않고, error / setup / ui / design-system / test-code / doc / feature 같은 모든 task type이 동일한 변형을 만든다.
- 따라서 **어떤 냄새가 어느 디렉토리로 가야 하는지**를 규칙(R1~R5)으로 고정한다. 미래 그래프에도 동일하게 적용한다.

---

## 2. 8축 레이아웃

모든 agent 그래프(`agents/{agent}/graph/{job}/`)는 아래 8축을 따른다.

| # | 폴더/파일 | 책임 | 존재 조건 |
|---|---|---|---|
| ① | `graph.ts` · `state.ts` · `routing.ts` · `runner.ts` | 그래프 조립, state 타입, edge predicate, entry | 모든 그래프 필수 |
| ② | `nodes/{name}/` | phase 노드 (graph.addNode 대상) 1개 = 1 디렉토리. `nodes/_common/` 은 phase-공유 state-aware 헬퍼 전용 (§2.4) | 모든 그래프 필수 |
| ③ | `routers/` 또는 `routing.ts` | edge predicate. **순수 함수, state mutation 금지** | 모든 그래프 필수 |
| ④ | `parallel/` | 오케스트레이션 (worker/queue) | 필요 시 |
| ⑤ | `session/` | 체크포인트·리저움 **로직 전용**. LLM 프롬프트 adapter (SessionContextBuilder 계열) 는 포함하지 않음 — 사용 노드 내부 (`nodes/{name}/`) 또는 `utils/` 로 귀속. **다른 job graph 의 `session/` 을 cross-import 하는 것도 금지** (R5) — 각 job 은 자기 `session/` SSOT 를 소유한다. `session.updateArtifacts` 직접 호출도 이 폴더 내부로 응집 (axis ⑤ SSOT) | 필요 시 |
| ⑥ | `config/` | 상수/환경 | 필요 시 |
| ⑦ | `tasks/{taskType}/` | **task.type-specific cross-phase 모듈** (0..N) | task.type 분기가 생길 때 필수 |
| ⑧ | `utils/` | **pure helper only** (도메인 로직 금지) | 필요 시 |

> **축 외 SSOT**: cross-agent Tier 전략 (`Breadcrumb / Boundary / Collapse / Compact` — operation-per-strategy + Tier facade) 은 `packages/ant-cli/src/core/executionTier/` 에 둔다. agent graph 의 8축은 아니지만 phase 노드는 `getExecutionTier(state)` 를 경유해 접근한다 (R1 + D11). 매트릭스는 [18-session-redesign.md §5.1.1](./18-session-redesign.md).
>
> **축 외 함수형 헬퍼 — `common/graph/nodes/plan/`**: code 와 design 두 job 의 plan 노드가 공유하는 LLM+tools 1라운드 stream 헬퍼 (`runPlanWithTools`), plan↔tool 루프 재진입 헬퍼 (`runPlanToolLoopPhase`), `<plan>` 추출 (`extractPlanText`) 을 둠. **함수형 utilities 만 export 한다 — `PlanStrategy` 인터페이스나 `createPlanNode(strategy)` factory 는 의도적으로 만들지 않음** (code: 5단계 entry/shortcut/RAG/llm/outcome, design: lean per-doc — 두 구조가 너무 달라 abstraction layer 가 양쪽에 어색해진다). 형제 디렉토리 `triage/`, `detect/`, `resolve/` 와 달리 reusable phase node factory 가 아님은 디렉토리 README 에 명시한다. plan↔tool 루프에는 라운드 상한이 없다 — runaway 는 LangGraph `recursionLimit` 가 잡는다.

### 2.1 `tasks/{taskType}/` 내부 표준 구조

```
tasks/{taskType}/
├── index.ts        # { hooks: TaskHooks } export
├── model/          # (선택) phase를 모르는 도메인 state·outcome·snapshot·errors
│   ├── Session.ts
│   ├── snapshot.ts
│   ├── outcome.ts
│   ├── errors.ts
│   └── is.ts
└── hooks/          # phase 어댑터. model만 import, 다른 hook 간 import 금지
    ├── plan.ts
    ├── tool.ts
    ├── command.ts
    ├── check.ts
    ├── router.ts
    ├── orchestrator.ts
    ├── decompose.ts
    ├── conversations.ts
    └── scheduling.ts
```

- **깊은 구현** (verification): model + hook 전체.
- **얕은 구현** (test-code, doc, feature): 필요한 hook만 (예: `scheduling.ts` + `conversations.ts`). model 없어도 됨.
- **공통 진입**: `tasks/_shared/registry.ts` 가 `hooksIfActive(state)` (state 기반) / `hooksForTaskType(taskType)` (ctx-only) 두 엔트리 제공.

### 2.2 `nodes/{name}/` 내부 표준 구조

phase 노드 디렉토리는 **graph.addNode 대상 1개 = 1 디렉토리** 가 원칙이며, 그 안에 다음 파일 규약을 따른다.

| 파일 | 역할 | 존재 조건 |
|---|---|---|
| `index.ts` | 노드 함수 본체 — `graph.addNode` 로 전달되는 `(state) => Partial<State>` | 필수 |
| `tools.ts` | state-aware tool-set selector — `export async function getTools(state): Promise<ToolDefinition[]>` | 해당 노드가 툴을 소비 + state / 환경 기반 필터링이 필요할 때 |
| `buildMessages.ts` · `buildSystemPrompt.ts` | per-node prompt adapter — `core/prompt` PromptBuilder 소비 | 필요 시 (T6b-ι 규약) |
| `parts/` | phase-invariant 파이프라인 sub-step | 필요 시 |

**tools.ts 규약**:
- 파일명은 반드시 `tools.ts`. `toolDefinitions.ts` / `getXxxTools.ts` 같은 per-노드 커스텀 네이밍 금지.
- Export 는 **단일 엔트리** `export async function getTools(state): Promise<ToolDefinition[]>`. 각 job 의 GraphState (예: `ArchitectGraphState`, `DesignGraphState`) 를 받는다. 노드가 복수 옵션을 요구하면 (`useSourceFileTool` 등) 두 번째 옵션 인자로 수용하되, 시그니처 이름은 `getTools` 로 통일.
- state / 런타임 기반 필터링 (figma gating, reference tool 여부, explain mode 분기) 은 전부 `tools.ts` 내부에 응집한다. 호출부 (index.ts) 는 `const tools = await getTools(state, opts)` 한 줄이 되어야 한다.
- 툴을 인라인으로 고르는 패턴은 발견 즉시 `tools.ts` 로 추출한다.

### 2.3 `nodes/{phase}/helpers.ts` 안티패턴

`nodes/{phase}/helpers.ts` / `utils.ts` 에 아래 성격이 혼재하면 축 ② / ⑤ / ⑧ 이 한 파일에 겹친 것이다. 발견 즉시 분산한다.

- `saveCheckpoint` / `session.updateArtifacts` 직접 호출 → `session/{파일}.ts` (axis ⑤ SSOT)
- pure parser / sanitizer → `utils/` (axis ⑧)
- state-aware phase-공유 헬퍼 (kanban / token tracking / workflow instrument) → `nodes/_common/` (§2.4)
- phase 전용 default / fallback factory → 해당 phase 디렉토리 내 별도 파일 (`nodes/{phase}/defaults.ts` 등)

phase-local 단일 헬퍼만 남으면 `helpers.ts` 로 유지 가능.

### 2.4 `nodes/_common/`

phase 노드 아닌 **phase-공유 헬퍼 (state-aware)** 가 필요하면 `nodes/_common/` 에 둔다. 순수 함수는 `utils/` 에 둔다.

- underscore prefix 는 **"non-phase-node internal"** 을 명시 — `graph.addNode` 대상이 아니라는 점을 폴더명만으로 구분한다.
- 판정 기준: state / runtime port (session, llm, registry, orchestrator) 참조가 있으면 `_common/`, 순수 string/type 변환이면 `utils/`.
- 대표 예 (code graph):
  - `_common/`: `invokeLLMWithTools.ts`, `runToolCallsAndCollect.ts`, `errorHandler.ts`
  - `utils/`: `parseReActResponse.ts`, `violationFormatter.ts`, `responseCleaners.ts`, `codeMetrics.ts`

---

## 3. 규칙 R1 ~ R5

### R1 (phase blind) — **불변식**

phase 노드 (`nodes/`), routers, parallel, common/tool handlers 는 `task.type` 도 `task.priority` 의미적 비교도 모른다. task-specific 로직은 반드시 `tasks/{taskType}/hooks/` 훅을 통해 주입한다.

- 어떤 위치에서든 `if (task.type === '...')` / `task.type === '...'` 비교 표현식이 나오면 **R1 위반**이다.
- `task.priority === N` / `task.priority < N` / `task.priority >= TASK_PRIORITIES.X` 같은 의미적 priority 비교도 phase 코드에서 금지된다 (Three-Axis SSOT — `.cursorrules` 참고). priority 는 `TaskQueue.push()` 의 정렬 비교만 합법.
- 해당 조건은 `tasks/{taskType}/hooks/` 로 이주시킨다. **예외 없음.**
- state 없는 컨텍스트(tool handlers 등)는 `hooksForTaskType(ctx.currentTaskType)` 로 호출한다.
- **`{ currentTask: { type: '...' } } as any` 같은 fake state 캐스트 금지**. R1 우회이며 리뷰 reject 대상.
- **routers 는 순수 predicate** — `state.llmResponse = ...` 같은 state mutation 금지. phase 노드가 반환한 `Partial<State>` 를 router 가 읽기만 한다. routers 의 mutation 은 task.type 로직을 잠재하기 쉬워 R1 우회 경로가 되므로 금지한다. (이전 초안 R7 의 흡수 결과)
- **scheduling 분류 dispatch** 는 `hooksForTaskType(t.type)?.scheduling?.classify?.(t)` 한 곳으로 통일. classify 의 input 은 BaseTask 전체이며, 각 bundle 이 자기 type 의 discriminator (`task.band` for feature, `task.type` for design-system/verification/setup, `task.priority` for design-job doc) 만 읽는다. **decompose 의 `deriveBandFromPriority` 가 priority → semantic 변환의 유일한 phase 사이트** — 그 외 phase 는 어떤 priority window 도 비교하지 않는다. (Three-Axis SSOT 의 R1 확장.)

**검증 명령**:
```bash
rg "task\.type === '[a-z-]+'" \
  packages/ant-cli/src/agents/architect/graph/code \
  --glob '!packages/ant-cli/src/agents/architect/graph/code/tasks/**'
# 기대: 0 matches

# Three-Axis SSOT — phase 레이어에 의미적 priority 비교 0 보장.
# decompose responseParser (priority → band 매핑 단일 site) +
# tasks/_shared/batchSplit/process.ts (parent − 1 정렬 클램프) 만 예외.
rg -n "\.priority\s*[<>!=]=?\s*(\d+|TASK_PRIORITIES\.)" \
  packages/ant-cli/src/agents/architect/graph/code/parallel \
  packages/ant-cli/src/agents/architect/graph/code/routers \
  packages/ant-cli/src/agents/architect/graph/code/nodes/plan \
  packages/ant-cli/src/agents/architect/graph/code/nodes/execute \
  packages/ant-cli/src/agents/architect/graph/code/nodes/checkTaskStatus \
  packages/ant-cli/src/agents/architect/graph/design/nodes \
  packages/ant-cli/src/agents/architect/graph/common
# 기대: 0 matches
```

#### R1-carve-out (static type predicate 허용)

Phase layer (phase `nodes/`, `routers/`, `parallel/`, common/tool handlers) 가 `tasks/{type}/model/is.ts` 의 type predicate (`isDocTask` / `isErrorTask` / `isVerificationTask` / `isSetupTask` / `isUiTask` / `isFeatureTask` / `isDesignSystemTask` / `isTestCodeTask` / `isExplainTask`) 를 **직접 import** 하는 것은 **조건부로 허용**한다. 다음을 **모두** 충족해야 한다.

1. Predicate 가 **순수 함수** — state / ctx / 런타임 의존이 0. `task.type` 리터럴 비교만 수행.
2. `task.type === '...'` 리터럴 비교가 **predicate 구현 파일 내부에만** 존재하며, phase 파일로 새어 나가지 않는다. (phase 파일에서는 predicate 호출만 노출된다.)
3. Hook 으로 뽑아도 state context 가 필요 없는 **"static per-type fact"** 인 경우 (예: skip-planning, router discrimination, tool filter gating).

위 3조건 중 하나라도 어긋나면 반드시 `tasks/{type}/hooks/` 로 이주시킨다. 특히 "조건부 로직 + state 참조" 가 predicate 호출 근처에 섞이기 시작하면 carve-out 이 아니라 hook 누락이다.

**Regression guard**: `packages/ant-cli/tests/regression/staticPredicateCount.test.ts` 가 phase layer 의 predicate 참조 수를 pin 한다. 증가 시 CI 실패로 위 3조건 재검토를 강제한다.

**배경**: T6b-κ 결정 ([docs/tmp/verification-task-redesign-handoff.md](../tmp/verification-task-redesign-handoff.md)) 에서 `isDocTask` / `isErrorTask` 등의 phase 직접 사용을 수용하되, 무제한 확장을 막기 위해 본 조항으로 좁게 허용한다. 본 조항은 해당 결정의 SSOT.

### R2 (model phase-blind)

`tasks/{taskType}/model/` 은 phase를 모른다.

- `nodes/`, `routers/`, `parallel/` 을 import 하지 않는다.
- 의존 방향: `hooks/ → model/`, `nodes/ → hooks/`.
- model은 순수 도메인 객체(Session, Snapshot, Outcome, Errors)로만 구성.

### R3 (utils pure)

`utils/` 에 도메인 로직 금지.

- "Session" / "Tracker" / "Outcome" / "Classification" 같은 도메인 명사가 파일명에 오면 위치 오류.
- 이주 대상: `tasks/{type}/` 또는 `tasks/_shared/`.
- `utils/` 는 `codeMetrics.ts`, `responseCleaners.ts` 같은 재사용 순수 헬퍼만.

### R4 (state SSOT)

state에 새 필드 추가 충동이 생기면 먼저 "이것은 `tasks/{taskType}/model/` 안에 속하는가?"를 물어라.

- state에는 **cross-task 공통 필드만** 남긴다.
- task type별 정보는 `task.{field}` 로 응집한다 (예: `task.batchSplitCount`). VerificationSession 클래스는 폐기됨 (vast-curling-perch verify cleanup, plan §5.6.3) — gate cache / passed Set / install observation / attempts counter 모두 LLM 의 conversation history + priorErrorTasks prompt inject 로 대체.
- 검증 책임은 task type 단위가 아니라 행동 단위로 응집. `tasks/_shared/verify/` 가 SSOT 이며 verification task type 과 Tier 2 self-verify task (`selfVerifyOnDone:true`) 가 공유. 분기 predicate: `requiresVerification(task)`. phase mode 채널: `state._verifyEntered` (single writer: `markVerifyEntered.ts`).
- 새 필드 1개 추가 ⇒ 기존 필드 1개 이상 제거를 목표("Axis N+1 금지").

### R5 (cross-job promotion)

cross-job 공유 task 도메인이 생기면 `common/graph/tasks/{taskType}/` 으로 승격.

- 역방향으로, 특정 job에만 쓰이는 resumeState 필드는 그 job 쪽 TaskResumeState 에만 둔다. (예: `CodeTaskResumeState.verification` 은 design job 으로 누수 금지.)

---

## 4. 냄새 → 이주 대상 (빠른 결정표)

| 관측된 냄새 | 원인 규칙 | 이주 대상 |
|---|---|---|
| phase 노드가 `nodes/{phase}.ts` 단일 파일 (예: design 의 옛 `nodes/plan.ts`) | axis ② | `nodes/{phase}/` 디렉토리로 분해. `index.ts` 본체 + `tools.ts` + (필요 시) `prompt.ts` / `finalizeOutcome.ts` 분리 |
| phase 노드에 `if (task.type === 'x')` | R1 | `tasks/x/hooks/{phase}.ts` |
| router가 `state.llmResponse = ...` 같은 mutation | R1 | plan 노드가 `Partial<State>` 반환, router는 읽기만 |
| `utils/verificationFoo.ts` 같은 도메인명 utils | R3 | `tasks/_shared/verify/foo.ts` (verification 책임자 공통) 또는 `tasks/{type}/hooks/` (task type 고유) |
| state에 `_fooTracker`, `_fooAttempts` 등 type-local 필드 누적 | R4 | `state.foo?: FooSession` SSOT + `tasks/foo/model/` |
| tool handler가 `{ currentTask: { type } } as any` fake cast | R1 | `hooksForTaskType(ctx.currentTaskType)` |
| `TaskResumeState` 하나에 모든 job 필드가 섞임 | R5 | `BaseTaskResumeState` + `{Job}TaskResumeState` |
| verification/error 공통 판정이 여러 phase에서 중복 | R1 + R3 | 각 site 에서 `isVerificationTask(t) \|\| isErrorTask(t)` 를 명시적으로 작성 — 두 type 은 session 소유 / 명령 가드 / plan entry 경로에서 **갈라지므로** alias 로 묶지 않음 (T6b-η) |
| phase 노드 내 state-aware tool selector 가 인라인 / 이름 제각각 (`toolDefinitions.ts`, `getXxxTools.ts`, `index.ts` 인라인) | axis ② (§2.2) | `nodes/{name}/tools.ts` 로 추출, `export async function getTools(state): Promise<ToolDefinition[]>` 단일 시그니처 준수 |
| `nodes/` 바로 아래에 `graph.addNode` 대상 아닌 헬퍼 디렉토리 (`nodes/shared/`, `nodes/checkpoint/` 등) | axis ② / ⑤ | state-aware 헬퍼는 `nodes/_common/` (§2.4), 체크포인트는 `session/`, prompt adapter 는 소비 노드 내부 또는 `utils/` |
| `design/nodes/X.ts` 같은 job-A 파일이 `code/session/*` 등 job-B 의 session 을 cross-import | R5 + axis ⑤ | 대상 job 의 `session/*.ts` SSOT 를 신설하고 직접 호출. `as any` 우회 금지 |
| `nodes/{phase}/helpers.ts` 안에 `saveCheckpoint` / `session.updateArtifacts` 가 숨어있음 | axis ⑤ | `session/checkpoint.ts` 로 이관. wrapper 이름은 boundary 의미를 담는다 (`saveDecomposeCheckpoint`, `saveTaskCompleteCheckpoint` 등) |

---

## 5. 신규 그래프 작성 체크리스트

새 agent/job 그래프를 만들 때:

- [ ] `graph.ts` / `state.ts` / `runner.ts` / `routing.ts` (또는 `routers/`) 4파일 생성 (축 ①)
- [ ] phase 노드는 `nodes/{name}/` 디렉토리로 (축 ②). `nodes/{name}.ts` 단일 파일은 지양.
- [ ] phase-공유 state-aware 헬퍼는 `nodes/_common/` (§2.4). 순수 헬퍼는 `utils/`. `nodes/shared/` 같은 모호한 폴더 금지.
- [ ] session 체크포인트 write 는 `session/checkpoint.ts` SSOT 를 경유 (§2 축 ⑤). `session.updateArtifacts` 직접 호출은 session SSOT 파일 이외 금지.
- [ ] state-aware tool selector 는 `nodes/{name}/tools.ts` + `getTools(state)` 규약 준수 (§2.2).
- [ ] routers는 순수 predicate만 (축 ③). state mutation 금지.
- [ ] task.type 분기 발생 시 반드시 `tasks/{type}/hooks/` 로 이주 (축 ⑦). R1 준수.
- [ ] task type별 도메인 state는 `tasks/{type}/model/Session.ts` 에 응집. state.ts 에는 `state.{type}?: Session` 한 필드만 (R4).
- [ ] 순수 헬퍼만 `utils/` 에 (R3). 도메인 명사 파일명 금지.
- [ ] cross-job 재사용 여지가 보이면 `common/graph/tasks/{type}/` 승격 검토 (R5).
- [ ] PR 제출 전 `§4 regression guard` 명령 전부 실행해 0 결과 확인.

---

## 6. 냄새 재발 방지 6원칙

이 문서를 구현자가 모두 읽지 못하더라도 아래 6원칙만 지키면 동일 재설계 방향이 유지된다. R1~R5 의 운영 요약이며, 코드 리뷰 시 빠른 체크리스트로 쓴다.

1. **"Axis N+1" 금지** (R4 운영형): state 에 새 필드 추가 충동이 생기면 기존 필드로 파생 가능한지부터 검사. 새 필드 1개 추가 ⇒ 기존 필드 1개 이상 제거를 목표로 한다.
2. **Domain state 는 task model 에 있다** (R4): task 별 시도·gate·history·depHash·batch-split 등은 `state.ts` 에 직접 추가하지 않고 `tasks/{type}/model/` 의 Session/Snapshot 에 귀속. `state.ts` 에는 **cross-task 공통 필드만** 남긴다.
3. **Carry-over 경계 all-or-nothing**: 재큐·재시도·split 등 모든 boundary 는 동일한 `snapshotFromState + resumeState` SSOT 를 경유해야 한다. 하나의 경계만 빠져도 regression 이 재발한다. 새 boundary 추가 시 기존 3 경계(`handleInterruption` / `reportFailure transient` / `plan.processDiagnosticBatchSplit`)를 레퍼런스로 동일 API 를 호출할 것.
4. **Terminal 은 typed + single path**: terminal 종결은 `VerificationTerminalError` 같은 typed error + `classifyTerminalError` 한 경로로 통합. 새 kind 추가 시 `model/errors.ts` 와 대응 테스트 `all defined kinds` 케이스에 함께 추가한다. orchestrator 는 kind 증가에 대한 코드 수정 없이 자동 분기 처리.
5. **Phase 노드·routers·parallel·tool handlers 는 모든 task.type 에 blind** (R1): `if (task.type === '...')` 분기를 이들 축에 넣지 않는다. 분기가 필요하면 `tasks/{taskType}/hooks/` 에 hook 을 추가한다. **verification 만의 예외 없음**.
6. **`as any` fake state 캐스트 금지** (R1): state 가 없는 컨텍스트는 `hooksForTaskType(taskType)` 사용. `{ currentTask: { type: ... } } as any` 같은 shim 은 R1 우회이며 리뷰 reject 대상.

---

## 7. 참고

- **구현 레퍼런스**: `packages/ant-cli/src/agents/architect/graph/code/tasks/` (verification 가장 깊음, error/setup/ui/design-system/test-code/doc/feature 얕은 구현).
- **상세 계획/이력**: [docs/tmp/verification-task-redesign-handoff.md](../tmp/verification-task-redesign-handoff.md) — 작업 완료(T12) 후 `docs/archive/` 로 이동. 이 문서는 NODE_GRAPH_LAYOUT 의 도입 배경·의사결정 로그로만 남고, 규칙·원칙의 SSOT 는 본 NODE_GRAPH_LAYOUT 문서다.
