# Shared Contracts

## 개요

`@ant/shared` 패키지는 ant-cli와 ant-ui 간의 타입 계약을 정의한다. 런타임 의존성이 없으며, TypeScript 타입만 제공한다.

## 모듈 구성

### job.ts

Job 레벨 타입.

| 타입 | 정의 |
|------|------|
| `JobType` | `'code' \| 'design' \| 'learn' \| 'ask' \| 'plan' \| 'inline-ask'` |
| `DecomposableJobType` | `Exclude<JobType, 'ask' \| 'plan' \| 'inline-ask'>` |
| `SessionableJobType` | `DecomposableJobType \| 'plan'` |
| `JobTiming` | `startedAt`, `completedAt`, `totalPausedDuration`, `phaseBreakdown` |

### task.ts

태스크 및 Kanban 타입.

| 타입 | 정의 |
|------|------|
| `TaskType` | `'setup' \| 'feature' \| 'error' \| 'explain' \| 'doc'` |
| `TaskStatus` | `'todo' \| 'in-progress' \| 'completed'` |
| `BaseTask` | `id`, `name`, `type`, `priority`, `completed`, `exclusive`, `parallelGroup`, `packages` |
| `TaskTiming` | 태스크 실행 시간 |
| `TaskTokenUsage` | 태스크별 토큰 사용량 |
| `KanbanData` | `todo`, `inProgress`, `completed`, `isEstimating`, `dataSource`, `recursionCount`, `jobTiming` |

### workflow.ts

Workflow SSE 타입.

| 타입 | 정의 |
|------|------|
| `TaskInfo` | 태스크 정보 |
| `NodeHistoryEntry` | 노드 진입/퇴장 이력 |
| `ActiveWorkerNode` | 활성 워커 노드 |
| `WorkflowRealtimeState` | `jobId`, `activeNodes`, `nodeHistory`, `isCompleted` |

### interruption.ts

중단 메타데이터.

| 타입 | 정의 |
|------|------|
| `InterruptionReason` | `'recursion_limit' \| 'user_stopped' \| 'api_error' \| 'process_crash' \| 'timeout' \| ...` |
| `InterruptionDetails` | `reason`, `message`, `timestamp`, `canResume`, `metadata` |

### detection.ts

환경 감지 결과.

| 타입 | 정의 |
|------|------|
| `JobMode` | `'generate' \| 'refactor' \| 'explain'` |
| `JobEnvironment` | `'frontend' \| 'backend' \| 'fullstack' \| 'unknown'` |
| `DesignWorkType` | `'system-design' \| 'ui-design'` |
| `DesignDomain` | 설계 도메인 분류 |
| `ProjectProfile` | 프로젝트 프로파일 |
| `DetectionReport` | 코드/설계 통합 감지 결과 |

## 사용 패턴

ant-cli와 ant-ui 모두 `@ant/shared`에서 타입을 import한다. pnpm workspace 의존성으로 연결되어 빌드 없이 소스 직접 참조가 가능하다.

## 경계

- 프론트엔드에서의 사용: [14-frontend-architecture.md](14-frontend-architecture.md)
- 백엔드에서의 사용: [03-agent-architecture.md](03-agent-architecture.md)
