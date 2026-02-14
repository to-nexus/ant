# @ant/shared

ant-cli와 ant-ui 간의 공유 타입 패키지. 런타임 의존성 없이 TypeScript 타입만 제공한다.

## 모듈

| 파일 | 내용 |
|------|------|
| `job.ts` | JobType, DecomposableJobType, SessionableJobType, JobTiming |
| `task.ts` | TaskType, TaskStatus, BaseTask, KanbanData, TaskTiming, TaskTokenUsage |
| `workflow.ts` | WorkflowRealtimeState, NodeHistoryEntry, ActiveWorkerNode |
| `interruption.ts` | InterruptionReason, InterruptionDetails |
| `detection.ts` | JobMode, JobEnvironment, DesignWorkType, DetectionReport, ProjectProfile |
| `index.ts` | 전체 re-export |

## 사용

pnpm workspace 의존성으로 연결되어 빌드 없이 소스 직접 참조가 가능하다.

```typescript
import { JobType, KanbanData } from '@ant/shared';
```
