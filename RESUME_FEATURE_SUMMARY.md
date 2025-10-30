# Recursion Limit 재개 기능 구현 완료

## 📋 구현 내용

### 목적
Recursion limit 도달 시 실행 state를 저장하고, 재실행 시 끊긴 지점부터 이어서 진행할 수 있도록 구현

### 구현된 기능

1. **Session State 저장**
   - TaskQueue (남은 태스크들)
   - CurrentTask (현재 실행 중인 태스크)
   - CompletedTasks (완료된 태스크 ID 목록)
   - Retry 정보 및 히스토리

2. **Session State 복원**
   - Decompose 노드에서 이전 state 체크
   - 있으면 복원, 없으면 새로 decompose
   - 진행 상황 출력 (완료/남은 태스크)

3. **RecursionLimit 증가**
   - 25 → 50으로 증가하여 더 복잡한 워크플로우 허용

## 📁 수정된 파일

### 1. `src/core/types.ts`
```typescript
// ✅ SessionState 인터페이스 추가
export interface SessionState {
  taskQueue?: any[];
  currentTask?: any;
  completedTasks?: string[];
  retries?: number;
  maxRetries?: number;
  previousAttempts?: any[];
  enforcementHistory?: any[];
  lastViolations?: any[];
  previousFileCount?: number;
  resolvedCategories?: string[];
}

// ✅ Session에 state 필드 추가
export interface Session {
  // ... existing fields
  state?: SessionState;  // ✅ 추가
}
```

### 2. `src/core/schemas/session.schema.ts`
```typescript
// ✅ SessionStateSchema 추가
export const SessionStateSchema = z.object({
  taskQueue: z.array(z.any()).optional(),
  currentTask: z.any().optional(),
  // ... 기타 필드들
}).passthrough();

// ✅ SessionSchema에 state 추가
export const SessionSchema = z.object({
  // ... existing fields
  state: SessionStateSchema.optional(),  // ✅ 추가
});
```

### 3. `src/agents/architect/graph/code/nodes/learn.ts`
```typescript
// ✅ state snapshot 저장
await state.deps.session.updateArtifacts(
  state.context.project,
  state.context.featureFolder || 'default',
  {
    activeBranch: branch,
    state: {  // ✅ 추가
      taskQueue: state.taskQueue?.getAll() || [],
      currentTask: state.currentTask,
      completedTasks: state.completedTasks || [],
      // ... 기타 state 필드들
    }
  }
);
```

### 4. `src/agents/architect/graph/code/nodes/decompose.ts`
```typescript
export async function decompose(state: ArchitectGraphState) {
  // ✅ 이전 state 복원 로직 추가
  if (state.deps?.session) {
    const session = await state.deps.session.load(...);
    
    if (session.state?.taskQueue?.length > 0) {
      console.log('🔄 Resuming from previous session...');
      
      // TaskQueue 복원
      const taskQueue = new TaskQueue();
      session.state.taskQueue.forEach(task => taskQueue.push(task));
      
      // State 복원
      return {
        ...state,
        taskQueue,
        completedTasks: session.state.completedTasks,
        retries: session.state.retries,
        // ... 기타 state 필드들
      };
    }
  }
  
  // 새로운 decompose (기존 로직)
  // ...
}
```

### 5. `src/agents/architect/graph/code/runner.ts`
```typescript
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const state = await (app as any).invoke(initial, {
    recursionLimit: 50,  // ✅ 25 → 50으로 증가
  });
  // ...
}
```

### 6. `src/periphery/adapters/session/FileSessionAdapter.ts`
```typescript
async updateArtifacts(
  project: string,
  feature: string,
  artifacts: Partial<SessionArtifacts> & { state?: any }  // ✅ state 타입 추가
): Promise<void> {
  const session = await this.load(project, feature);
  
  // ✅ state 추출 및 저장
  const { state, ...actualArtifacts } = artifacts as any;
  session.artifacts = { ...session.artifacts, ...actualArtifacts };
  
  if (state !== undefined) {
    session.state = state;  // ✅ state 저장
  }
  
  await this.save(session);
}
```

## 🔄 동작 방식

### 첫 실행 (Recursion Limit 도달)
1. Decompose → 15개 태스크 생성
2. Task 실행 중 recursion limit 도달
3. Learn 노드에서 state snapshot 저장
4. `session.json`에 저장:
   ```json
   {
     "state": {
       "taskQueue": [...],
       "completedTasks": ["task-1", "task-2"],
       "retries": 3
     }
   }
   ```

### 재실행 (동일한 directive)
1. Decompose → session에서 state 체크
2. State 발견 → 복원
3. 출력:
   ```
   🔄 Resuming from previous session...
   
   📊 Restored state:
      ✅ 2 tasks completed
      ⏳ 13 tasks remaining
      🔁 Retry count: 3/3
   ```
4. 남은 13개 태스크부터 이어서 진행

## ✅ 테스트 방법

```bash
# 1차 실행 (recursion limit 도달까지)
cd /Users/probe/dev/ant
npm run dev -- architect code workspace/test-app/skeleton

# state가 저장됨:
# workspace/test-app/skeleton/outputs/session.json

# 2차 실행 (재개)
npm run dev -- architect code workspace/test-app/skeleton

# "🔄 Resuming from previous session..." 메시지 확인
# 끊긴 지점부터 이어서 진행됨
```

## 📊 성공 기준

- ✅ Recursion limit 도달 시 state 저장
- ✅ 재실행 시 state 복원
- ✅ TaskQueue 순서 유지
- ✅ 완료된 태스크 스킵
- ✅ Retry 카운트 유지
- ✅ 끊긴 지점부터 정확히 재개

## 💡 추가 개선 가능 사항

1. **State 정리 기능**
   - 모든 태스크 완료 시 state 자동 삭제
   - 또는 명시적인 "reset" 커맨드

2. **Progress Bar**
   - 전체 태스크 대비 진행률 표시

3. **State 버전 관리**
   - State 스키마 변경 시 마이그레이션

4. **RecursionLimit 동적 조정**
   - 프로젝트 복잡도에 따라 자동 조정

## 🎉 완료

모든 구현이 완료되었고 빌드도 성공했습니다!

