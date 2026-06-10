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

Detect 파이프라인의 공통 어휘와 LLM 추론 출력 타입.

| 타입 | 정의 |
|------|------|
| `Mode` | `'generate' \| 'refactor' \| 'explain'` — 모든 Job에서 공유하는 보편 모드 어휘 |
| `IntentGroup` | `'plan' \| 'design-system' \| 'design-ui' \| 'design-spec' \| 'code' \| 'visual' \| 'learn-codebase' \| 'ask'` |
| `DesignDomain` | `'game' \| 'service'` |
| `InferredAction` | `strategy.run()` 출력 (infer 경로). 아래 표 참고 |

**`InferredAction` 필드**

| 필드 | 타입 | 비고 |
|------|------|------|
| `intentId` | `string` | 반드시 유효한 IntentId. 무효 시 재시도 + hard fail |
| `target?` | `string[]` | 출력 대상 파일 경로 |
| `refs?` | `string[]` | LLM이 식별한 참조 파일 |
| `context?` | `string[]` | LLM이 식별한 컨텍스트 파일 |
| `domain?` | `DesignDomain` | design-system 전용 |
| `reasoning?` | `{ intent?, domain? }` | 채팅 표시 전용. RAC에 저장 안 함 |
| `sourceJob` | `string` | 원래 job 식별자 |

**제거된 타입**: `DetectionReport`, `DetectionSummary`, `ProjectProfile`, `JobEnvironment`, `JobMode`, `DesignWorkType`, `JobSource` — RAC 단일 파이프라인 전환으로 폐기.

**백엔드 전용 (`packages/ant-cli/src/core/types/detection.ts`)**

| 함수 | 역할 |
|------|------|
| `formatRACForChat()` | RAC + transient reasoning → 채팅 마크다운 |
| `resolveDesignTargetFiles()` | intentId → target files (system-design용) |
| `parseInferredActionFromLLM()` | `<detect>` XML 태그 → InferredAction |

### actions.ts

액션 및 인텐트 정의 시스템. FE ActionsPanel과 BE 에이전트 라우팅 간 계약.

| 타입/함수 | 정의 |
|-----------|------|
| `ActionDefinition` | 액션 카드 정의 (`id`, `label`, `description`, `status`) |
| `ACTION_DEFINITIONS` | 전체 액션 정의 배열 |
| `IntentDefinition` | 인텐트 정의 (`id`, `intentGroup`, `label`, `description`) |
| `INTENT_DEFINITIONS` | 전체 인텐트 정의 배열 — **고유 인텐트 ID 27개** (intentGroup별 개수는 아래 표) |
| `IntentId` | `INTENT_DEFINITIONS`에서 파생된 유효 인텐트 ID 유니온 타입 |
| `getIntentsForAction()` | `(intentGroup: IntentGroup) => ReadonlyArray<IntentDefinition>` |
| `ActionMetadata` | `explicit?`, `intent?`, `target?`, `refs?`, `context?`, `locale?`, `basis?: Basis` |
| `deriveFromIntent()` | `(intent: IntentId) => { intentGroup?, mode, agent, jobType, targetTier? }` — mode/intentGroup은 항상 intentId에서 파생 |
| `ActionReadiness` | FE 액션 실행 가능 여부 (`buildReady`, `hasOutput`, `detectedMode`, `subModes?`, `namingIssues`, …) |
| `SubModeStatus` | FE 서브모드 활성 상태 (`id`, `active`, `blockReason?`) |
| `validateDesignFileName()` | 설계 출력 파일명 규칙 검증 |

**`INTENT_DEFINITIONS` intentGroup별 개수 (합계 27)**

| `intentGroup` | 개수 | 비고 |
|---------------|------|------|
| `plan` | 3 | `gen-plan`, `rev-plan`, `explain-plan` |
| `design-system` | 5 | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| `design-ui` | 4 | `gen-ui-figma`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
| `design-spec` | 3 | `gen-spec`, `rev-spec`, `explain-spec` |
| `code` | 5 | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`, `rev-code`, `explain-code` |
| `visual` | 2 | `gen-visual`, `explain-visual` |
| `learn-codebase` | 1 | `gen-learn` |
| `ask` | 3 | `ask-evaluate`, `ask-ant`, `ask-general` |

**교차 도메인 explain 인텐트 (6개)** — 위 intentGroup별 집계에 이미 포함: `explain-code`, `explain-ui`, `explain-sys`, `explain-spec`, `explain-plan`, `explain-visual`.

### rac.ts

ResolvedActionContext (RAC) — Detect 노드의 불변 출력. 단일 `resolveToRAC()` 퍼널로 explicit/infer 경로 모두 생성.

**단일 파이프라인 구조:**
```
Explicit: metadata → intentId + slots → resolveToRAC() → RAC
Infer:    strategy.run() → InferredAction → mergeWithMetadata() → resolveToRAC() → RAC
```

| 타입/함수 | 정의 |
|-----------|------|
| `ResolvedActionContext` | `intent?`, `intentGroup?`, `mode`, `target?`, `refs?`, `context?`, `artifacts?`, `documents?`, `domain?`, `intentDescription?`, `basis?`, `source`, `hasExplicitFields` |
| `ResolvedArtifact` | role-labeled 문서 (`path`, `content`, `role: 'ref' \| 'context' \| 'directive'`, `mediaType?`, `mimeType?`, `base64?`) |
| `TechTier` | `language?`, `framework?`, `stack?`, `runtime?`, `packageManager?` — RAC.basis.techTier에 배치. decompose가 채우거나 explicit preset |
| `VisualTier` | `designSystem?` — 향후 확장 예정 |
| `Basis` | `techTier?: TechTier`, `visualTier?: VisualTier` — progressive basis (detect → decompose 구간에서 점진 확정) |
| `BasisOption` | `id`, `label: { en, ko }` — UI 드롭다운 옵션 |
| `TECH_TIER_LANGUAGES` | `BasisOption[]` — 언어 선택 상수 (typescript, go) |
| `TECH_TIER_FRAMEWORKS` | `Record<string, BasisOption[]>` — 언어별 프레임워크 선택 상수 |
| `VISUAL_TIER_DESIGN_SYSTEMS` | `BasisOption[]` — 디자인 시스템 선택 상수 (현재 빈 배열) |
| `buildBasisPreset()` | `(opts) => Basis` — UI에서 basis preset 생성 |
| `InferWorkspaceState` | infer 경로 보조: `hasFigmaConfig?`, `hasPrd?`, `hasDesignDoc?`, `hasSpecDocs?`, `targetFiles?` |
| `resolveToRAC()` | `(intentId, slots?, source?, basis?) => ResolvedActionContext` — mode/intentGroup은 `deriveFromIntent()`로 파생 |
| `mergeWithMetadata()` | `(inferred, metadata?) => { intentId, target?, refs?, context?, domain?, basis? }` — infer 경로에서 metadata 보충 |
| `mergeTechTier()` | `(preset?, inferred?) => TechTier` — preset 필드 우선, 빈 필드는 inferred에서 채움 |
| `getTechTier()` | `(state) => TechTier \| undefined` — RAC.basis.techTier 읽기 헬퍼 |
| `getBasis()` | `(state) => Basis \| undefined` — RAC.basis 읽기 헬퍼 |
| `buildTechTier()` | `(profile?, stack?, taskProfile?) => TechTier` — decompose에서 사용 |
| `isFigmaPipeline()` | `(intent, figmaPopulated) => boolean` |

**RAC 필드 상세**

| 필드 | 타입 | 비고 |
|------|------|------|
| `intent` | `IntentId?` | 유효 인텐트 ID |
| `intentGroup` | `IntentGroup?` | `deriveFromIntent()`에서 파생 |
| `mode` | `Mode` | `deriveFromIntent()`에서 파생 |
| `target`, `refs`, `context` | `string[]?` | 파일 슬롯 |
| `artifacts` | `ResolvedArtifact[]?` | role-labeled 아티팩트 (preferred) |
| `documents` | `ResolvedArtifact[]?` | @deprecated — `artifacts` 사용 |
| `basis` | `Basis?` | progressive basis — techTier(decompose/preset), visualTier(reserved) |
| `domain` | `DesignDomain?` | design-system 전용 |
| `source` | `'explicit' \| 'infer'` | 생성 경로 |

**제거된 항목**: `resolveFromExplicit()`, `resolveFromInfer()`, `synthesize*()` 6개, `TechContext`, `ResolvedDocument`, `buildTechContext()` — 단일 `resolveToRAC()` 퍼널과 `TechTier` 분리로 대체.

### action-config-matrix.ts

인텐트 → (refs, context, target) 매핑. FE(`ActionConfigView`)와 BE(`resolve` 노드)의 SSOT.

| 타입 | 정의 |
|------|------|
| `ConfigSlots` | `refs: SlotDef[]`, `context: SlotDef[]`, `target: TargetDef`, `basis?: BasisSlotConfig`, `chatRequiresRefs?`, `buildRequiresRefs?`, `buildRequiresContext?`, `buildDisabled?`, `refsSingleSelect?` |
| `BasisSlotConfig` | `techTier?: boolean`, `visualTier?: boolean` — BasisWizard 렌더링 조건 |
| `SlotDef` | `path`, `label`, `type: 'dir'\|'file'`, `required`, `locked?`, `excludeSelectedRefs?`, `createIntent?`, `humanLabel?`, `codebase?`, `excludeFiles?` |
| `TargetDef` | `kind: 'generate'\|'revise'\|'codebase'\|'chat-only'` + kind별 필드 |
| `OutputSpec` | `prefix`, `ext`, `label`, `isPattern`, `warnIfExists?` |

#### Activation Policy

`deriveChatNeedsRefs`: 기본값 = `deriveBuildNeedsRefs`. `chatRequiresRefs`로 오버라이드.
`deriveBuildNeedsRefs`: real ref slots 존재 시 true. `buildRequiresRefs: false`로 opt-out.

Resolved 매트릭스 (30개 intent 전체)는 [32-action-activation-policy.md](./32-action-activation-policy.md) 참조.

#### Target 결정 규칙 (explicit)

UI(`ActionConfigView`)가 intent 선택 시점에 `actionMetadata.target`을 세팅한다. explicit에서 target이 없으면 시스템 오류 (codebase/chat-only 제외).

| TargetDef kind | `actionMetadata.target` | 시점 |
|---|---|---|
| `revise` | refs 배열과 동일 (toggleFile 동기화) | refs 선택 시 |
| `generate` | `["{dir}/{prefix}{ext}"]` | intent 선택 시 |
| `codebase` | 없음 (해당 없음) | — |
| `chat-only` | 없음 (채팅 응답) | — |

`refsSingleSelect`: `ConfigSlots`에 true로 지정 시 refs를 하나만 선택 가능 (예: rev-plan). `required`: `SlotDef` 필드로, true면 파일 있을 때 자동 선택 + 없을 때 amber 경고, false면 수동 선택 + gray 표시.

### 인텐트·모드 철학 (Phase 6+)

| 개념 | 설명 |
|------|------|
| **Intent** | 불투명한 문자열 키(인텐트 ID). 파이프라인 분기·템플릿 선택의 1차 축. `INTENT_DEFINITIONS`가 SSOT. |
| **Mode (`Mode`)** | `generate` \| `refactor` \| `explain` — **보편 어휘**이지 Job마다 다른 계약이 아니다. 모든 Job이 세 모드를 구현하는 것은 아니다. |
| **`intentGroup` (`IntentGroup`)** | 전 Job 포괄 universal enum: `plan`, `design-system`, `design-ui`, `design-spec`, `code`, `visual`, `learn-codebase`, `ask`. `deriveFromIntent()`에서 파생. |
| **인텐트 네이밍** | **접두 패턴**: `gen-*`(생성), `rev-*`(수정), `explain-*`, `ask-*` 등. Code는 산출 경로별 `gen-code-sys` / `gen-code-spec` / `gen-code-directive`로 구분. |

**전체 인텐트 ID 목록 (`INTENT_DEFINITIONS` 기준 27개)**

| intentGroup | 인텐트 ID |
|-------------|-----------|
| plan (3) | `gen-plan`, `rev-plan`, `explain-plan` |
| design-system (5) | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| design-ui (4) | `gen-ui-figma`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
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
| `FigmaDataConfig` | `{ file: string \| null }` — 단일 Figma URL (canonical 경로: `visual/ui/figma/figma.json`; 스키마는 URL 만 포함하며 탐색 결과는 저장하지 않음) |
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

Feature 디렉토리 구조의 SSOT. 모든 정규 디렉토리/파일이 도메인 visibility 태그(`ui:plan`, `ui:architecture`, `ui:visual`, `ui:assets`, `ui:meta`, `internal`)와 함께 한 곳에 정의되며, 파생 상수는 이 배열에서 계산된다.

| 타입/함수 | 정의 |
|-----------|------|
| `CANONICAL_FEATURE_DIRS` | 모든 정규 디렉토리 경로 배열 (`plan` / `architecture/{system,spec}` / `visual/{ui,game-art}/...` / `assets/...` / `meta/{directives,evals}/...` / `sessions/...`) |
| `CANONICAL_FEATURE_FILE_PATHS` | 정규 파일 경로 배열 (`visual/ui/figma/figma.json`). `UiSource` enum (`ant` \| `figma` \| `handoff`), `ARTIFACT_PREFIX.UI_ANT / UI_FIGMA / UI_HANDOFF / UI_ANT_SPEC`, `FIGMA_CONFIG_PATH`, `uiSourceOfPath()` 도 이 모듈에서 export. |
| `UI_VISIBLE_TOP_LEVEL_DIRS` | ArtifactsPanel 에 표시할 도메인 1단계 디렉토리(`{ name, visibility }` 튜플; 1차 분류 축이 도메인 의미라 단일 export 로 통합). |
| `UI_VISIBLE_FILES` | ArtifactsPanel 에 표시할 파일 이름 (CANONICAL_FILE_DEFS 의 `ui:*` 항목에서 파생). |
| `isCanonicalDir()` | 상대 경로가 정규 디렉토리인지 O(1) 판정 |

### org.ts

Org 모델 공유 타입. `OrganizationKind` (`local` \| `individual` \| `team`), `INDIVIDUAL_ORG_ID` / `LOCAL_ORG_ID` / `LOCAL_USER_ID` 상수, `deriveKindFromOrgId(orgId)` (kind 부재 토큰용 fallback 분류기). FE/BE 가 kind 분기 + 매직 스트링 정합을 공유한다. 전체 모델: [40-org-model.md](40-org-model.md).

### deploy.ts

배포 공유 타입. `DeployPhase` / `DeployFramework` / `DeployStatus` / `DeployStatusPackage` / `DeployLogEntry` + `DeployVisibility` (`public` \| `private`, 부재=public). visibility 는 `DeployStatus` 집계 레벨에만 존재한다 (per-package 아님).

## 경계

- 프론트엔드에서의 사용: [30-frontend-architecture.md](30-frontend-architecture.md)
- 백엔드에서의 사용: [11-agent-architecture.md](11-agent-architecture.md)
- Feature 디렉토리 구조: [20-workspace-isolation.md](20-workspace-isolation.md)
- Figma 연동 인프라: [26-figma-integration-infra.md](26-figma-integration-infra.md)
