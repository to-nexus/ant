---
name: add-job-type
description: ANT에 새 Job 타입을 추가할 때 사용. 새 에이전트 워크플로우, 신규 JobType 값 추가 시 자동 호출.
allowed-tools: Read, Write, Edit, Glob, Grep
---

ANT에 새 Job 타입을 추가한다. $ARGUMENTS

새 JobType은 여러 패키지에 걸쳐 변경이 필요하다. 순서대로 진행한다.

## 1. @ant/shared — 타입 계약 추가

**`packages/ant-shared/src/job.ts`**

```typescript
export type JobType = 'code' | 'design' | 'learn' | 'ask' | 'plan' | 'inline-ask' | 'NEW_TYPE';

// 태스크 분해가 있는 Job이라면:
export type DecomposableJobType = Exclude<JobType, 'ask' | 'plan' | 'inline-ask'>;  // 기존 유지 또는 수정

// 세션 파일을 가지는 Job이라면:
export type SessionableJobType = DecomposableJobType | 'plan' | 'NEW_TYPE';
```

`packages/ant-shared/src/index.ts`는 `export * from './job'`으로 이미 re-export 중 — 별도 수정 불필요.

## 2. composition/orchestrator.ts — 라우팅 추가

`packages/ant-cli/src/composition/orchestrator.ts`의 `switch (agent)` 블록에 케이스 추가:

```typescript
case "new-agent": {
  // 1. 어댑터 인스턴스 생성 (AdapterFactory 사용)
  // 2. LLM 클라이언트 생성: createLLMClient('new-agent', ...)
  // 3. Redis 있으면 broadcaster 초기화 (kanban, fileTree, workflow)
  // 4. 에이전트 함수 호출
  return await newAgent(input, project || "default", { ... });
}
```

기존 `architect` 케이스의 `if (jobType === 'code')` 블록 패턴을 참고한다.

## 3. composition/job-runner.ts — 환경변수 화이트리스트

새 JobType에 필요한 환경변수가 있다면 `job-runner.ts`의 화이트리스트에 추가.
`...process.env` spread는 절대 사용 금지.

## 4. 에이전트 구현 — agents/ 디렉토리

```
packages/ant-cli/src/agents/new-agent/
  index.ts          # 진입점: export async function newAgent(...)
  graph/
    graph.ts        # StateGraph 정의
    state.ts        # State 인터페이스 + channels
    runner.ts       # compile + invoke
    nodes/          # 각 노드 파일
    routers/        # 조건부 라우터
```

`add-agent-node` 스킬의 노드 패턴을 따른다.

## 5. 세션 파일 경로 (SessionableJobType인 경우)

체크포인트 저장 경로: `{featurePath}/sessions/{agent}/{jobType}.json`

`FileSessionAdapter`를 초기화할 때 agent 이름과 jobType을 일치시켜야 한다.

## 6. API 엔드포인트 (필요한 경우)

`packages/ant-cli/src/periphery/adapters/http/express.ts` 또는 라우터 파일에서
새 JobType을 받는 엔드포인트 추가.

## 7. 검증 체크리스트

- [ ] `@ant/shared` 타입 변경 후 ant-ui에서 import 오류 없는지 확인
- [ ] orchestrator에서 새 agent/jobType 조합이 라우팅되는지 확인
- [ ] `pnpm test:cli` 통과
- [ ] `pnpm build` 통과 (prebuild=test)
