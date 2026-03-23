---
name: add-shared-type
description: ant-cli와 ant-ui가 공유하는 타입을 @ant/shared에 추가할 때 사용. SSE 이벤트, API 응답, 도메인 모델 등 BE↔FE 계약 타입 추가 시 자동 호출.
allowed-tools: Read, Write, Edit, Glob
---

`@ant/shared`에 새 공유 타입을 추가한다. $ARGUMENTS

## 규칙

`@ant/shared`는 **TypeScript 타입만** 포함한다. 런타임 코드(함수, 클래스, 상수) 금지.

## 1. 기존 모듈에 추가할지 새 파일을 만들지 결정

| 모듈 | 내용 |
|------|------|
| `job.ts` | JobType, 실행 흐름 타입 |
| `task.ts` | TaskType, KanbanData, BaseTask |
| `interruption.ts` | 중단 사유, InterruptionDetails |
| `detection.ts` | DetectionReport, JobMode, 환경 감지 |
| `workflow.ts` | WorkflowRealtimeState, SSE 이벤트 |

위 모듈에 속하면 해당 파일에 추가. 새 도메인이면 새 파일 생성.

## 2. 새 파일 생성 시 index.ts에 re-export 추가

**`packages/ant-shared/src/index.ts`**:

```typescript
export * from './new-module';
```

`@ant/shared`는 빌드 없이 소스 직접 참조(`"main": "./src/index.ts"`)이므로 즉시 반영된다.

## 3. 타입 작성 위치

```
packages/ant-shared/src/
  job.ts
  task.ts
  interruption.ts
  detection.ts
  workflow.ts
  index.ts        ← re-export 허브
```

## 4. 사용 예시 (양쪽 패키지)

```typescript
// ant-cli (백엔드)
import { KanbanData, TaskStatus } from '@ant/shared';

// ant-ui (프론트엔드)
import { WorkflowRealtimeState } from '@ant/shared';
```

## 5. 검증

```bash
# 타입 체크
cd packages/ant-shared && pnpm typecheck

# 양쪽 패키지에서 import 오류 없는지
pnpm build:cli
pnpm build:ui
```
