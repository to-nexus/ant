# Decompose Resume: Additional Directive Replan 구현

## 🚨 문제 상황

### 사용자 리포트

```
작업 중단 후 다음과 같은 추가 지시를 했는데, decompose에서 태스크를 새로 갱신하지 않고 기존 태스크를 그대로 작업하는 문제가 있다.

추가 지시:
"NEXT_PUBLIC_BACKEND_URL 이런 환경변수로 서빙하는 url을 파악하려하지말고, 실제 서빙주는 현재의 호스트와 포트를 바탕으로 판단하도록 해라. 그렇게 해야 외부에서 주입된 포트로 개발서버를 띄울때 문제가 없다. 환경변수로 직접 호스트와 포트를 넣게 하지말아라. 또한 http api, ws 모두 실제 서버기 기동될떄 결정된 호스트와 포트를 base url로 사용하게 하라. 코드가 설계원칙대로 mece하게 작성되었는지 파악해서 문제가 있다면 리팩토링해라."

기대: 이 정도의 지시는 태스크를 재구성할 것을 기대
실제: 기존 태스크를 그대로 실행
```

### 로그 분석

```log
📝 Merging 2 directive(s) (newest first):
   1. NEXT_PUBLIC_BACKEND_URL 이런 환경변수로 서빙하는 url을 파악하려하지말고...
   2. api 서비스 파일도 ws 서비스 파일과 같은 형태로 리팩토링해라...
   ✅ Structured 2 directive(s) with labels

📊 Resuming existing project:
   Progress: 0/2 tasks (0%)
   Setup:   ✅ 0 remaining
   Feature: ⬜ 1 remaining  # ❌ 기존 태스크 그대로!
   Error:   ✅ 0 remaining
   Final:   ⬜ 1 remaining
```

**문제**: Directive는 merge되었지만, task queue는 재구성되지 않고 기존 것을 복원!

---

## 🔍 근본 원인

### Resume 로직 분석

```typescript
// decompose/index.ts (Before Fix)

// Line 196-220: Directive merge는 됨
if (session.state.directives.length > 0) {
  // Multiple directives: label them clearly
  mergedDirective = parts.join('\n\n---\n\n');
  console.log(`   ✅ Structured ${session.state.directives.length} directive(s) with labels`);
}

// Line 128-142: 하지만 task queue는 무조건 복원!
// Normal resume - restore queue and return
const taskQueue = new TaskQueue();
session.state.taskQueue.forEach((task: Task) => {
  taskQueue.push(task);  // ❌ 기존 queue 그대로 복원
});

return resumedState;  // ❌ 즉시 return - decomposition 로직 실행 안됨
```

### 설계 결함

1. **Directive merge**: ✅ 잘 됨 (newest first, labeled)
2. **Additional directive 감지**: ❌ 없음
3. **Replan 트리거**: ❌ 없음
4. **Task queue 재구성**: ❌ 항상 기존 queue 복원

**결과**: 사용자가 추가 directive를 제공해도 기존 task를 그대로 실행!

---

## ✅ 해결 방안

### 1. Additional Directive 감지

```typescript
// decompose/index.ts (New)

// ✅ Variables needed across multiple scopes
let hasAdditionalDirective = false;
let mergedDirective = state.directive;
let jobId: string;
let jobTiming: any;

// ✅ Build merged directive and detect additional directive
if (session.state.directives && session.state.directives.length > 0) {
  // ✅ Detect additional directive: more than 1 directive = user added feedback
  hasAdditionalDirective = session.state.directives.length > 1;
  
  if (session.state.directives.length === 1) {
    mergedDirective = session.state.directives[0];
  } else {
    // Multiple directives: label them clearly
    const [initial, ...feedbacks] = session.state.directives.slice().reverse();
    const parts = [`[Initial Request]\n${initial}`];
    
    feedbacks.forEach((feedback, idx) => {
      parts.push(`[Additional Feedback ${idx + 1}]\n${feedback}`);
    });
    
    mergedDirective = parts.join('\n\n---\n\n');
    console.log(`   ✅ Structured ${session.state.directives.length} directive(s) with labels`);
    console.log(`   🔄 Additional directive detected → Will REPLAN tasks\n`);
  }
}
```

### 2. Replan 분기 처리

```typescript
// ✨ Handle jobId and jobTiming for Resume (BEFORE any conditional logic)
const existingJobId = session.state.jobId || state._httpJobId || 'unknown-job';
const resumeResult = JobTimingManager.resumeJob(existingJobId, session.state.jobTiming);
jobId = resumeResult.jobId;
jobTiming = resumeResult.jobTiming;

// If reset detected, skip queue restoration and fall through to decomposition
if (shouldResetAndDecompose) {
  // Fall through to decomposition logic
} else if (hasAdditionalDirective) {
  // ✅ NEW: Additional directive detected → REPLAN tasks
  console.log('🔄 [Replan] Additional directive detected - decomposing into NEW tasks');
  console.log(`   Existing queue: ${session.state.taskQueue.length} task(s)`);
  console.log(`   Completed: ${session.state.completedTasks?.length || 0} task(s)`);
  console.log(`   Action: Will create new task queue based on merged directives\n`);
  
  // ✅ Preserve completed tasks and timing
  state = {
    ...state,
    directive: mergedDirective,
    completedTasks: session.state.completedTasks || [],
    completedTasksDetails: session.state.completedTasksDetails || [],
    retries: 0,  // Reset retries for new tasks
    previousAttempts: [],
    enforcementHistory: [],
    lastViolations: [],
    resolvedCategories: []
  } as any;
  
  // ✅ Save jobId and jobTiming for later use
  (state as any)._replanJobId = jobId;
  (state as any)._replanJobTiming = jobTiming;
  
  // Fall through to decomposition logic below
} else {
  // Normal resume - restore queue and return
  // ...
}
```

### 3. Replan vs New Project 구분

```typescript
// ✅ Check if this is a replan (additional directive) vs new project
const isReplan = (state as any)._replanJobId && (state as any)._replanJobTiming;
const useJobId = isReplan ? (state as any)._replanJobId : newJobId;
const useJobTiming = isReplan ? (state as any)._replanJobTiming : newJobTiming;

if (isReplan) {
  console.log('🔄 Replan mode detected - using existing jobId and timing');
  console.log(`   JobId: ${useJobId}`);
  console.log(`   Previous completed tasks: ${state.completedTasks?.length || 0}\n`);
}

// Starting fresh or replanning
if (isReplan) {
  console.log('🔄 Replanning project based on additional directive...\n');
} else {
  console.log('🆕 Starting new project - decomposing into tasks...\n');
}
```

### 4. JobId/JobTiming 처리

```typescript
// ✨ Calculate estimating duration (decompose completed)
const finalJobTiming = isReplan 
  ? useJobTiming  // Replan: use existing timing
  : JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);  // New: finalize

const newState = {
  ...state,
  jobId: useJobId,  // ✨ Initialize or preserve jobId
  jobTiming: finalJobTiming,  // ✨ Initialize or preserve jobTiming
  taskQueue,
  featureTasks,
  completedTasks: state.completedTasks || [],  // ✅ Preserve for replan
  completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve for replan
  overrideDirective: state.overrideDirective,
  chatSource: state.chatSource,
  _httpJobId: state._httpJobId
};
```

---

## 📊 Replan Flow

### Before (문제)

```
Resume:
  └─ Load session
      └─ Merge directives (✅)
      └─ Restore task queue (❌ 기존 것)
      └─ Return immediately (❌ decomposition 안함)
          └─ Plan node
              └─ Execute task (❌ 낡은 task)
```

### After (해결)

```
Resume:
  └─ Load session
      └─ Merge directives (✅)
      └─ Detect additional directive (✅ NEW)
      └─ hasAdditionalDirective = true (✅)
      └─ Preserve completed tasks (✅)
      └─ Fall through to decomposition (✅ NEW)
          └─ LLM decompose call
              └─ Create NEW task queue (✅)
              └─ Preserve completed tasks (✅)
              └─ Preserve jobId/timing (✅)
          └─ Plan node
              └─ Execute NEW task (✅)
```

---

## 🎯 핵심 변경사항

### 1. Additional Directive 감지

```typescript
// ✅ Detection logic
hasAdditionalDirective = session.state.directives.length > 1;

if (hasAdditionalDirective) {
  console.log(`   🔄 Additional directive detected → Will REPLAN tasks\n`);
}
```

**기준**: `directives.length > 1` = 사용자가 피드백 추가

### 2. Replan 분기

```typescript
if (shouldResetAndDecompose) {
  // Project deleted - full reset
} else if (hasAdditionalDirective) {
  // ✅ NEW: Additional directive - replan
  // Preserve completed tasks
  // Fall through to decomposition
} else {
  // Normal resume - restore queue
  return resumedState;
}
```

### 3. Completed Tasks 보존

```typescript
// Replan 시:
completedTasks: state.completedTasks || [],
completedTasksDetails: state.completedTasksDetails || [],

// ✅ 이전에 완료한 task는 유지
// ✅ 새로운 task queue만 생성
```

### 4. JobId/Timing 재사용

```typescript
// Replan:
const useJobId = (state as any)._replanJobId;  // Existing
const useJobTiming = (state as any)._replanJobTiming;  // Existing

// New project:
const useJobId = newJobId;  // New
const useJobTiming = JobTimingManager.finalizeEstimatingPhase(...);  // New
```

---

## 📋 예상 동작

### Scenario: 추가 Directive 제공

```
1. Initial directive:
   "api 서비스 파일도 ws 서비스 파일과 같은 형태로 리팩토링해라"
   
   Task Queue:
   - Task 1: Refactor API Service to Match WebSocket Service Structure
   - Task 2: Final Integration & Verification

2. User stops job

3. Additional directive:
   "NEXT_PUBLIC_BACKEND_URL 이런 환경변수로 서빙하는 url을 파악하려하지말고, 
    실제 서빙주는 현재의 호스트와 포트를 바탕으로 판단하도록 해라. 
    환경변수로 직접 호스트와 포트를 넣게 하지말아라."

4. Resume:
   ✅ Detect: hasAdditionalDirective = true
   ✅ Merge directives with labels
   ✅ Preserve completed tasks (0개)
   ✅ Call LLM decompose with merged directive
   ✅ Generate NEW task queue:
      - Task 1: Implement Dynamic Host/Port Resolution
      - Task 2: Refactor API Service to Use Dynamic URLs
      - Task 3: Refactor WebSocket Service to Use Dynamic URLs
      - Task 4: Remove Environment Variable Dependencies
      - Task 5: Verify MECE Compliance
      - Task 6: Final Integration & Verification

5. Execute NEW tasks with additional requirements
```

---

## 🎓 설계 원칙

### 1. Additional Directive Detection

```
Single directive (length = 1):
  → Normal resume
  → Restore existing queue

Multiple directives (length > 1):
  → Additional directive detected
  → Replan: create new queue
```

### 2. Completed Tasks Preservation

```
Replan이어도:
  ✅ completedTasks 유지
  ✅ completedTasksDetails 유지
  ✅ jobId 재사용
  ✅ jobTiming 재사용

새로 생성:
  ✅ taskQueue (NEW from LLM)
  ✅ featureTasks (NEW from LLM)
```

### 3. Directive Merge Strategy

```
[Initial Request]
api 서비스 파일도 ws 서비스 파일과 같은 형태로 리팩토링해라

---

[Additional Feedback 1]
NEXT_PUBLIC_BACKEND_URL 이런 환경변수로 서빙하는 url을 파악하려하지말고...

# ✅ Structured format with clear labels
# ✅ Newest feedback last (most visible to LLM)
```

### 4. State Management

```
Replan 경로:
1. hasAdditionalDirective = true 설정
2. Preserve completed tasks
3. Save jobId/jobTiming to state._replan*
4. Fall through to decomposition
5. isReplan flag 감지
6. useJobId/useJobTiming 사용
7. completedTasks 유지
```

---

## ✅ 테스트 시나리오

### Test 1: 단순 Resume (No Additional Directive)

```
1. Start job with directive
2. Complete 2 tasks
3. Stop job
4. Resume WITHOUT new directive

Expected:
  ✅ hasAdditionalDirective = false
  ✅ Restore existing queue
  ✅ Continue from where stopped
  ✅ No replan
```

### Test 2: Additional Directive (Replan)

```
1. Start job with directive
2. Complete 2 tasks
3. Stop job
4. Resume WITH new directive

Expected:
  ✅ hasAdditionalDirective = true
  ✅ Merge directives with labels
  ✅ Preserve 2 completed tasks
  ✅ Call LLM decompose
  ✅ Create NEW task queue
  ✅ Execute new tasks
```

### Test 3: Multiple Additional Directives

```
1. Start job
2. Stop, add directive 1, resume
3. Stop, add directive 2, resume

Expected:
  ✅ directives.length = 3
  ✅ hasAdditionalDirective = true
  ✅ All directives merged with labels
  ✅ Replan with all feedback
```

---

## 🔧 Implementation Details

### 파일 변경

**`packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts`**

#### Change 1: Variable Scope (Line 68-80)

```typescript
// ✅ Variables needed across multiple scopes
let hasAdditionalDirective = false;
let mergedDirective = state.directive;
let jobId: string;
let jobTiming: any;
```

#### Change 2: Early JobId/Timing Assignment (Line 130-168)

```typescript
// ✨ Handle jobId and jobTiming for Resume (BEFORE any conditional logic)
const existingJobId = session.state.jobId || state._httpJobId || 'unknown-job';
const resumeResult = JobTimingManager.resumeJob(existingJobId, session.state.jobTiming);
jobId = resumeResult.jobId;
jobTiming = resumeResult.jobTiming;

// ✅ Build merged directive from directives array (BEFORE any conditional logic)
mergedDirective = state.directive;
hasAdditionalDirective = false;

if (session.state.directives && session.state.directives.length > 0) {
  hasAdditionalDirective = session.state.directives.length > 1;
  
  if (session.state.directives.length > 1) {
    // ... merge with labels
    console.log(`   🔄 Additional directive detected → Will REPLAN tasks\n`);
  }
}
```

#### Change 3: Replan Branch (Line 168-196)

```typescript
if (shouldResetAndDecompose) {
  // Fall through to decomposition logic
} else if (hasAdditionalDirective) {
  // ✅ NEW: Additional directive detected → REPLAN tasks
  console.log('🔄 [Replan] Additional directive detected - decomposing into NEW tasks');
  
  state = {
    ...state,
    directive: mergedDirective,
    completedTasks: session.state.completedTasks || [],
    completedTasksDetails: session.state.completedTasksDetails || [],
    // ... reset other fields
  } as any;
  
  (state as any)._replanJobId = jobId;
  (state as any)._replanJobTiming = jobTiming;
  
  // Fall through to decomposition logic below
} else {
  // Normal resume
}
```

#### Change 4: Replan Detection (Line 408-424)

```typescript
const isReplan = (state as any)._replanJobId && (state as any)._replanJobTiming;
const useJobId = isReplan ? (state as any)._replanJobId : newJobId;
const useJobTiming = isReplan ? (state as any)._replanJobTiming : newJobTiming;

if (isReplan) {
  console.log('🔄 Replan mode detected');
  console.log('🔄 Replanning project based on additional directive...\n');
} else {
  console.log('🆕 Starting new project - decomposing into tasks...\n');
}
```

#### Change 5: Job State Usage (Multiple locations)

```typescript
// All decomposition success paths:
const finalJobTiming = isReplan 
  ? useJobTiming
  : JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);

const newState = {
  ...state,
  jobId: useJobId,  // ✨ Use preserved or new
  jobTiming: finalJobTiming,
  taskQueue,
  featureTasks,
  completedTasks: state.completedTasks || [],  // ✅ Preserve
  completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve
  // ...
};
```

---

## 📊 Impact Analysis

### 긍정적 영향

1. **Replan 지원**: 사용자가 추가 directive 제공 시 task 재구성
2. **Completed Tasks 보존**: 이전 작업 내역 유지
3. **명확한 피드백**: "Will REPLAN tasks" 로그
4. **JobId 일관성**: 동일한 job으로 계속 진행

### 주의사항

1. **LLM 호출 증가**: Replan 시 decompose LLM 호출 (비용/시간)
2. **Task 중복 가능성**: LLM이 유사한 task 재생성 가능
3. **Progress Reset**: Task queue가 새로 생성되므로 진행률 초기화 (단, completedTasks는 보존)

---

## 🎯 결론

### 문제 요약

- **Before**: 추가 directive 제공 시 무시, 기존 task 그대로 실행
- **After**: 추가 directive 감지 → task queue 재구성 → 새로운 요구사항 반영

### 핵심 변경

1. ✅ **Additional directive 감지** (`directives.length > 1`)
2. ✅ **Replan 분기 추가** (`hasAdditionalDirective` branch)
3. ✅ **Completed tasks 보존** (replan 시에도 유지)
4. ✅ **JobId/Timing 재사용** (일관성 유지)

### 효과

- ⚡ **더 나은 UX**: 사용자 피드백 즉시 반영
- ✅ **정확한 구현**: 최신 요구사항 기반 task 생성
- 🎯 **명확한 의도**: Replan vs Resume 구분

---

**수정 완료**: 2025-11-29
**파일 변경**: 1개 (`decompose/index.ts`)
**빌드 상태**: ✅ 성공
**다음 단계**: 서버 재시작 후 테스트

