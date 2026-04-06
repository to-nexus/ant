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

환경 감지 결과.

| 타입 | 정의 |
|------|------|
| `JobMode` | `'generate' \| 'refactor' \| 'explain'` |
| `JobEnvironment` | `'frontend' \| 'backend' \| 'fullstack' \| 'unknown'` |
| `DesignWorkType` | `'system-design' \| 'ui-design' \| 'spec'` |
| `DesignDomain` | `'game' \| 'service'` |
| `ProjectProfile` | `language`, `framework` |
| `JobSource` | `'code' \| 'design'` |
| `DetectionReport` | `jobMode`, `jobModeReasoning`, `environment`, `environmentReasoning`, `workType`, `workTypeReasoning`, `domain`, `domainReasoning`, `targetFiles`, `profile`, `requireRag`, `sourceJob`, `detectedAt` |

### figma.ts

Figma 데이터 설정 및 MCP 연동 타입. Design Job과 Code Job 모두에서 사용.

| 타입/함수 | 정의 |
|-----------|------|
| `FigmaDataConfig` | `{ file: string \| null }` — 단일 Figma URL (inputs/figma.json 스키마) |
| `UIDesignSource` | `'figma' \| 'references' \| 'none'` |
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
