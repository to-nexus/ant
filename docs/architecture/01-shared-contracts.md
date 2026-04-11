# Shared Contracts

## 개요

`@ant/shared` 패키지는 ant-cli와 ant-ui 간의 타입 계약을 정의한다. 런타임 의존성이 없으며, TypeScript 타입과 순수 함수만 제공한다. pnpm workspace 의존성으로 연결되어 빌드 없이 소스 직접 참조가 가능하다.

## 모듈 구성

### job.ts

Job 레벨 타입.

| 타입 | 정의 |
|------|------|
| `JobType` | `'code' \| 'design' \| 'learn' \| 'ask' \| 'plan' \| 'inline-ask' \| 'visual'` |
| `DecomposableJobType` | `Exclude<JobType, 'ask' \| 'plan' \| 'inline-ask' \| 'visual'>` |
| `SessionableJobType` | `DecomposableJobType \| 'plan' \| 'visual'` |
| `JobTiming` | `startedAt`, `completedAt`, `totalPausedDuration`, `phaseBreakdown` |

### task.ts

태스크 및 Kanban 타입.

| 타입 | 정의 |
|------|------|
| `TaskType` | `'setup' \| 'feature' \| 'design-system' \| 'ui' \| 'test-code' \| 'error' \| 'verification' \| 'explain' \| 'doc'` |
| `TaskStatus` | `'todo' \| 'in-progress' \| 'completed'` |
| `BaseTask` | `id`, `name`, `type`, `priority`, `description`, `completed`, `interrupted`, `exclusive`, `parallelGroup`, `packages`, `timing`, `tokenUsage` |
| `TaskTiming` | 태스크 실행 시간 (`startedAt`, `completedAt`, `pausedAt`, `resumedAt`, `totalPausedDuration`, `elapsedTime`, `duration`) |
| `TaskTokenUsage` | 태스크별 토큰 사용량 (`inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheCreationTokens`) |
| `KanbanData` | `jobId`, `todo`, `inProgress`, `completed`, `isEstimating`, `dataSource`, `recursionCount`, `recursionLimit`, `recursionTaskName`, `tokenUsage`, `estimatingTokenUsage`, `jobType`, `jobTiming`, `interruption`, `estimatingLabel`, `estimatingStartedAt`, `estimatingNodeId` |

### workflow.ts

Workflow SSE 타입.

| 타입 | 정의 |
|------|------|
| `TaskInfo` | 태스크 정보 (`id`, `name`, `type`, `description`, `priority`) |
| `NodeHistoryEntry` | 노드 진입/퇴장 이력 (`nodeId`, `enteredAt`, `exitedAt`, `duration`) |
| `ActiveWorkerNode` | 활성 워커 노드 (`workerId`, `nodeId`, `previousNodeId`, `taskName`, `taskId`, `enteredAt`) |
| `WorkflowRealtimeState` | `jobId`, `startedAt`, `endedAt`, `isCompleted`, `activeNodes`, `nodeHistory`, `activeActors`, `kanbanCurrentTask`, `kanbanUpdate`, `recursionCount`, `recursionLimit` |

### interruption.ts

중단 메타데이터.

| 타입 | 정의 |
|------|------|
| `InterruptionReason` | `'recursion_limit' \| 'user_stopped' \| 'api_error' \| 'process_crash' \| 'server_crash' \| 'timeout' \| 'server_shutdown' \| 'figma_rate_limited' \| 'figma_connection_lost' \| 'unknown'` |
| `InterruptionDetails` | `reason`, `message`, `timestamp`, `canResume`, `metadata` |

### detection.ts

환경 감지 결과. 공통 어휘는 **Mode** / **IntentGroup**으로 통일했고, 이전 이름은 타입 별칭·필드로 하위 호환된다.

| 타입 | 정의 |
|------|------|
| `Mode` | `'generate' \| 'refactor' \| 'explain'` — 모든 Job에서 공유하는 보편 모드 어휘 |
| `JobMode` | `@deprecated` — `Mode`와 동일한 별칭 |
| `JobEnvironment` | `'frontend' \| 'backend' \| 'fullstack' \| 'unknown'` |
| `IntentGroup` | `'plan' \| 'design-system' \| 'design-ui' \| 'design-spec' \| 'code' \| 'visual' \| 'learn-codebase' \| 'ask'` — 전 Job 포괄 universal enum. `ActionId`를 대체. |
| `DesignWorkType` | `@deprecated` — `IntentGroup`과 동일한 별칭 |
| `DesignDomain` | `'game' \| 'service'` |
| `ProjectProfile` | `language`, `framework` |
| `JobSource` | `'code' \| 'design'` |
| `DetectionReport` | 아래 표 참고 |

**`DetectionReport` 필드 (이름 변경 및 하위 호환)**

| 구역 | 필드 | 비고 |
|------|------|------|
| 공통 | `detectedMode`, `detectedModeReasoning` | Code·Design 공통 |
| | `jobMode?`, `jobModeReasoning?` | `@deprecated` — 각각 `detectedMode`, `detectedModeReasoning`에 대응 |
| | `environment?`, `environmentReasoning?` | |
| Design 전용 | `detectedIntentGroup?`, `detectedIntentGroupReasoning?` | |
| | `workType?`, `workTypeReasoning?` | `@deprecated` — 각각 `detectedIntentGroup`, `detectedIntentGroupReasoning`에 대응 |
| | `domain?`, `domainReasoning?`, `targetFiles?` | |
| Code 전용 | `profile?`, `requireRag?`, `primarySources?`, `primarySourcesReasoning?` | |
| 메타 | `sourceJob`, `detectedAt?` | |

**백엔드 전용 (`packages/ant-cli/src/core/types/detection.ts`)**

| 함수 | 시그니처 | 역할 |
|------|----------|------|
| `normalizeDetectionReport` | `(raw: any) => DetectionReport` | 세션 JSON 등에서 로드한 객체의 폐기 필드명을 정규 필드로 매핑 (`jobMode`→`detectedMode`, `workType`→`detectedIntentGroup` 등). ant-cli 전용 — `@ant/shared`의 `DetectionReport` 타입과 함께 사용 |

### actions.ts

액션 및 인텐트 정의 시스템. FE ActionsPanel과 BE 에이전트 라우팅 간 계약.

| 타입/함수 | 정의 |
|-----------|------|
| `ActionId` | `@deprecated` — `IntentGroup`의 별칭. `'plan' \| 'design-system' \| 'design-ui' \| 'design-spec' \| 'code' \| 'visual' \| 'learn-codebase' \| 'ask'` |
| `ActionDefinition` | 액션 카드 정의 (`id`, `label`, `description`, `status`) |
| `ACTION_DEFINITIONS` | 전체 액션 정의 배열 |
| `IntentDefinition` | 인텐트 정의 (`id`, `intentGroup`, `label`, `description`) |
| `INTENT_DEFINITIONS` | 전체 인텐트 정의 배열 — **고유 인텐트 ID 27개** (intentGroup별 개수는 아래 표) |
| `getIntentsForAction()` | `(intentGroup: IntentGroup) => ReadonlyArray<IntentDefinition>` |
| `ActionMetadata` | `explicit?`, `intent?`, `target?`, `refs?`, `context?`, **`locale?`**, `language?` (`@deprecated`, `locale`과 동일 용도) |
| `deriveFromIntent()` | `(intent: IntentId) => { intentGroup?, mode, environment?, agent, jobType }` — 반환의 **`mode`**는 구 `jobMode`에 대응. Design 계열은 `intentGroup`으로 `design-system` \| `design-ui` \| `design-spec` 구분 |
| `ActionReadiness` | FE 액션 실행 가능 여부 (`buildReady`, `hasOutput`, `detectedMode`, `subModes?`, `namingIssues`, …) |
| `SubModeStatus` | FE 서브모드 활성 상태 (`id`, `active`, `blockReason?`) |
| `validateDesignFileName()` | 설계 출력 파일명 규칙 검증 |

**`INTENT_DEFINITIONS` intentGroup별 개수 (합계 27)**

| `intentGroup` | 개수 | 비고 |
|---------------|------|------|
| `plan` | 3 | `gen-plan`, `rev-plan`, `explain-plan` |
| `design-system` | 5 | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| `design-ui` | 5 | `gen-ui-figma`, `gen-ui-ref`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
| `design-spec` | 3 | `gen-spec`, `rev-spec`, `explain-spec` |
| `code` | 5 | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`, `rev-code`, `explain-code` |
| `visual` | 2 | `gen-visual`, `explain-visual` |
| `learn-codebase` | 1 | `gen-learn` |
| `ask` | 3 | `ask-evaluate`, `ask-ant`, `ask-general` |

**교차 도메인 explain 인텐트 (6개)** — 위 intentGroup별 집계에 이미 포함: `explain-code`, `explain-ui`, `explain-sys`, `explain-spec`, `explain-plan`, `explain-visual`.

### rac.ts

ResolvedActionContext (RAC) — Intent-Centric 프롬프트 시스템의 SSOT. resolve/detect 노드에서 생성, ModeController와 프롬프트 템플릿에서 소비.

| 타입/함수 | 정의 |
|-----------|------|
| `InferWorkspaceState` | infer 경로 보조: `hasFigmaConfig?`, `hasScreens?`, `hasComponents?`, `hasPrd?`, `hasDesignDoc?`, `hasSpecDocs?`, `targetFiles?`, `primarySources?` |
| `ResolvedActionContext` | `intent?`, **`intentGroup?`** (`IntentGroup`), **`mode`** (`Mode`), `tech`, `target?`, `refs?`, `context?`, `documents?`, `domain?`, `intentDescription?`, `source`, `hasExplicitFields` — 구 필드명 `workType`/`jobMode`는 각각 **`intentGroup`** / **`mode`** 로 정렬 |
| `ResolvedDocument` | role-labeled 문서 (`path`, `content`, `role: 'ref' \| 'context'`, `label?`) |
| `TechContext` | `language`, `framework`, `environment`, `runtime` |
| `resolveFromExplicit()` | `(actionMetadata, codebaseProfile?, fallbackHints?) => ResolvedActionContext` |
| `resolveFromInfer()` | `(report, actionMetadata?, codebaseProfile?, fallbackHints?, synthesizedIntent?, workspaceState?) => ResolvedActionContext` — `target`/`refs`는 메타데이터 우선, 없으면 `report.targetFiles` / `report.primarySources`. `context`는 메타데이터에서 병합 |
| `synthesizeDesignIntent()` | `(report, hints: { figmaPopulated?, hasReferences? }) => IntentId` |
| `synthesizeCodeIntent()` | `(report, workspaceState?) => IntentId` |
| `synthesizePlanIntent()` | `(mode: string) => IntentId` — `explain`→`explain-plan`, `refine`→`rev-plan`, 그 외→`gen-plan` |
| `synthesizeVisualIntent()` | `(jobMode: string) => IntentId` — `explain`→`explain-visual`, 그 외→`gen-visual` |
| `synthesizeAskIntent()` | `(subType?: 'evaluate' \| 'ant' \| 'general') => IntentId` — `ask-evaluate` / `ask-ant` / `ask-general`(기본) |
| `synthesizeLearnIntent()` | `() => IntentId` — 항상 `'gen-learn'` |
| `isFigmaPipeline()` | `(intent, figmaPopulated) => boolean` |
| `buildTechContext()` | profile + env + hints → `TechContext` |

**인텐트 합성 함수**: `synthesize*` 계열은 **`IntentId`**를 반환한다 (`@ant/shared/actions`의 유효 인텐트 ID 유니온).

**RAC 커버리지**: design, code, plan, visual, learn에 더해 **ask** Job도 triage 등에서 `synthesizeAskIntent`·`resolveFromExplicit`/`resolveFromInfer` 경로와 맞물려 RAC를 사용한다.

### action-config-matrix.ts

인텐트 → (refs, context, target) 매핑. FE(`ActionConfigView`)와 BE(`resolve` 노드)의 SSOT.

| 타입 | 정의 |
|------|------|
| `ConfigSlots` | `refs: SlotDef[]`, `context: SlotDef[]`, `target: TargetDef`, `chatRequiresRefs?` |
| `SlotDef` | `path`, `label`, `type: 'dir'\|'file'`, `defaultSelected`, `locked?`, `excludeSelectedRefs?`, `createIntent?`, `humanLabel?`, `codebase?`, `excludeFiles?`, `maxSelection?` |
| `TargetDef` | `dir?`, `expectedFiles?`, `codebase?`, `mirrorRefs?`, `emptyHint?` |
| `ExpectedFile` | `prefix`, `ext`, `label`, `warnIfExists`, `isPattern` |

#### Target 결정 규칙 (explicit)

UI(`ActionConfigView`)가 intent 선택 시점에 `actionMetadata.target`을 세팅한다. explicit에서 target이 없으면 시스템 오류 (codebase/emptyHint 제외).

| TargetDef 패턴 | `actionMetadata.target` | 시점 |
|---|---|---|
| `mirrorRefs: true` | refs 배열과 동일 | refs 선택 시 |
| `dir` + `expectedFiles` | `["{dir}/{prefix}{ext}"]` | intent 선택 시 |
| `dir` only | `["{dir}"]` | intent 선택 시 |
| `codebase: true` | 없음 (해당 없음) | — |
| `emptyHint` only | 없음 (채팅 응답) | — |

`maxSelection`: `SlotDef`에 지정 시 해당 슬롯의 선택 수를 제한 (예: rev-plan refs → `maxSelection: 1`).

### 인텐트·모드 철학 (Phase 6+)

| 개념 | 설명 |
|------|------|
| **Intent** | 불투명한 문자열 키(인텐트 ID). 파이프라인 분기·템플릿 선택의 1차 축. `INTENT_DEFINITIONS`가 SSOT. |
| **Mode (`Mode`)** | `generate` \| `refactor` \| `explain` — **보편 어휘**이지 Job마다 다른 계약이 아니다. 모든 Job이 세 모드를 구현하는 것은 아니다. |
| **`intentGroup` (`IntentGroup`)** | 전 Job 포괄 universal enum: `plan`, `design-system`, `design-ui`, `design-spec`, `code`, `visual`, `learn-codebase`, `ask`. `ActionId`를 대체. RAC·감지 리포트의 `detectedIntentGroup`과 대응. |
| **인텐트 네이밍** | **접두 패턴**: `gen-*`(생성), `rev-*`(수정), `explain-*`, `ask-*` 등. Code는 산출 경로별 `gen-code-sys` / `gen-code-spec` / `gen-code-directive`로 구분. |

**전체 인텐트 ID 목록 (`INTENT_DEFINITIONS` 기준 27개)**

| intentGroup | 인텐트 ID |
|-------------|-----------|
| plan (3) | `gen-plan`, `rev-plan`, `explain-plan` |
| design-system (5) | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| design-ui (5) | `gen-ui-figma`, `gen-ui-ref`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
| design-spec (3) | `gen-spec`, `rev-spec`, `explain-spec` |
| code (5) | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`, `rev-code`, `explain-code` |
| visual (2) | `gen-visual`, `explain-visual` |
| learn-codebase (1) | `gen-learn` |
| ask (3) | `ask-evaluate`, `ask-ant`, `ask-general` |

**모드(`Mode`) vs 계약**: `Mode`는 크로스잡 용어로 문서·프롬프트·감지에 쓰이며, 실제 지원 조합은 `deriveFromIntent()` 및 각 Job 그래프 구현에 따른다.

**개수 정리**: intentGroup별 인텐트 수는 plan 3 · design-system 5 · design-ui 5 · design-spec 3 · code 5 · visual 2 · learn-codebase 1 · ask 3이며, 합계 **`INTENT_DEFINITIONS` 고유 인텐트 ID 27개**다. 교차 explain 6개(`explain-*`)는 위 표의 해당 intentGroup 행에 이미 포함된다.

### figma.ts

Figma 데이터 설정 및 MCP 연동 타입. Design Job과 Code Job 모두에서 사용.

| 타입/함수 | 정의 |
|-----------|------|
| `FigmaDataConfig` | `{ file: string \| null }` — 단일 Figma URL (inputs/figma.json 스키마) |
| `FigmaMCPTool` | `'get_metadata' \| 'get_design_context' \| 'get_screenshot' \| 'get_variable_defs'` |
| `MCPToolResult` | MCP 도구 실행 결과 (`content`, `isError`) |
| `FigmaExplorationResult` | `variationMatrix`, `annotations`, `componentStateMatrix`, `variableDefs`, `totalFrameCount`, `downloadedAssets`, `nodeSummary`, `explorationErrors` |
| `FigmaNodeSummary` | 노드 요약 (`nodeId`, `name`, `type`, `depth`, `childCount`, `dimensions`, `isComponent`) |
| `VariationMatrixEntry` | 섹션별 프레임 변형 매트릭스 |
| `ComponentStateEntry` | 컴포넌트 상태/변형 매트릭스 |
| `createEmptyFigmaData()` | 빈 FigmaDataConfig 생성 |
| `isFigmaDataPopulated()` | Figma URL 존재 여부 판정 |
| `migrateFigmaConfig()` | 레거시 `files: string[]` → `file: string \| null` 마이그레이션 |
| `extractFigmaUrlParts()` | URL에서 fileKey/nodeId 추출 |

### bridge.ts

Ant Desktop 브리지 프로토콜. ant-cli(클라우드), ant-ui(프론트엔드), ant-desktop(데스크톱 앱) 간 WebSocket 통신 계약.

| 타입/상수 | 정의 |
|-----------|------|
| `BRIDGE_WS_PATH` | `/bridge/ws` |
| `BRIDGE_HEARTBEAT_INTERVAL_MS` | 30,000ms |
| `BRIDGE_HEARTBEAT_TIMEOUT_MS` | 90,000ms |
| `BRIDGE_MCP_REQUEST_TIMEOUT_MS` | 30,000ms |
| `BridgeCapability` | `'figma-mcp'` |
| `BridgeMessage` | Register, Heartbeat, Disconnect, StatusProbe, MCPRequest, MCPResponse 유니온 |
| `BridgeSessionStatus` | `'detected' \| 'connected' \| 'disconnected'` |
| `BridgeSession` | `userId`, `machineId`, `capabilities`, `connectedAt`, `lastPingAt`, `status`, `figmaDesktopReachable` |
| `BridgeStatusResponse` | `connected`, `detected`, `session`, `figmaDesktopReachable` |

### canonical.ts

Feature 디렉토리 구조의 SSOT. 모든 정규 디렉토리/파일이 visibility 태그(`ui:inputs`, `ui:outputs`, `internal`)와 함께 한 곳에 정의되며, 파생 상수는 이 배열에서 계산된다.

| 타입/함수 | 정의 |
|-----------|------|
| `CANONICAL_FEATURE_DIRS` | 모든 정규 디렉토리 경로 배열 |
| `CANONICAL_FEATURE_FILE_PATHS` | 정규 파일 경로 배열 (`inputs/figma.json`) |
| `UI_VISIBLE_INPUT_DIRS` | ArtifactsPanel Inputs 섹션에 표시할 디렉토리 이름 |
| `UI_VISIBLE_OUTPUT_DIRS` | ArtifactsPanel Outputs 섹션에 표시할 디렉토리 이름 |
| `UI_VISIBLE_INPUT_FILES` | ArtifactsPanel Inputs 섹션에 표시할 파일 이름 |
| `isCanonicalDir()` | 상대 경로가 정규 디렉토리인지 O(1) 판정 |

## 경계

- 프론트엔드에서의 사용: [30-frontend-architecture.md](30-frontend-architecture.md)
- 백엔드에서의 사용: [11-agent-architecture.md](11-agent-architecture.md)
- Feature 디렉토리 구조: [20-workspace-isolation.md](20-workspace-isolation.md)
- Figma 연동 인프라: [26-figma-integration-infra.md](26-figma-integration-infra.md)
