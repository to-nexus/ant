---
name: add-agent-node
description: LangGraph 에이전트 그래프에 새 노드를 추가할 때 사용. 새 phase 추가, 기존 그래프 수정, 노드 간 엣지 변경 시 자동 호출.
allowed-tools: Read, Write, Edit, Glob, Grep
---

ANT LangGraph 그래프에 새 노드를 추가한다. $ARGUMENTS

## 1. 그래프 파일 위치 파악

```
packages/ant-cli/src/agents/
  architect/graph/
    code/      graph.ts, state.ts, nodes/, routers/
    design/    graph.ts, state.ts, nodes/, routers/
    learn/     graph.ts, state.ts
  planner/     graph.ts, state.ts, nodes/
  common/nodes/triage/   (공통 triage 노드)
```

## 2. 노드 함수 시그니처

```typescript
// nodes/{nodeName}.ts
export async function myNode(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  const phaseStart = Date.now();

  // ── Workflow 계측: 노드 진입 ──────────────────────────────
  state.recursionCount = (state.recursionCount || 0) + 1;
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'myNode',
      0,           // workerIndex (병렬 워커가 아니면 0)
      undefined,   // taskInfo
      undefined,   // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }

  // ── 실제 로직 ────────────────────────────────────────────
  // ...

  // ── Phase 타이밍 기록 ────────────────────────────────────
  const timings = { ...(state._phaseTimings || {}), myNode: Date.now() - phaseStart };

  // ── Workflow 계측: 노드 퇴장 ──────────────────────────────
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'myNode', 0);
  }

  return { ...state, _phaseTimings: timings };
}
```

**중요**: `state`를 직접 mutate하지 않고 항상 `Partial<State>`를 반환한다.

## 3. graph.ts에 노드 등록

```typescript
// graph.ts
import { myNode } from './nodes/myNode';

const graph = new StateGraph<ArchitectGraphState>({ channels: stateSchema });

graph.addNode('myNode', myNode);

// 엣지 추가 (선형)
graph.addEdge('prevNode', 'myNode');
graph.addEdge('myNode', 'nextNode');

// 조건부 엣지 (라우터)
graph.addConditionalEdges('myNode', routeAfterMyNode, {
  pathA: 'nodeA',
  pathB: 'nodeB',
  [END]: END,
});
```

## 4. 라우터 패턴

```typescript
// routers/myNodeRouter.ts
export function routeAfterMyNode(state: ArchitectGraphState): string {
  if (state.someCondition) return 'pathA';
  if (state.otherCondition) return 'pathB';
  return END;
}
```

## 5. State에 새 필드 추가 시

`state.ts`의 `ArchitectGraphState` 인터페이스에 필드 추가:

```typescript
export interface ArchitectGraphState {
  // ... 기존 필드
  myNewField?: string;   // optional이 기본
}
```

LangGraph channels 스키마도 함께 업데이트해야 한다 (같은 파일 내 `channels` 객체).

## 6. 실시간 Kanban 상태 업데이트가 필요하면

```typescript
if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
  state.deps.kanbanUpdate.setEstimatingActivity('처리 중...', 'myNode');
}
```

## 7. 검증

```bash
pnpm test:cli
cd packages/ant-cli && pnpm dev:server   # 실제 노드 진입/퇴장 로그 확인
```
