# Parallel Task Execution

> 병렬 태스크 실행 아키텍처: TaskOrchestrator, TaskWorker, 동시성 제어, 체크포인트, 에러 처리

---

## 1. 개요

Code/Design job은 decompose 단계에서 다수의 task로 분해된다.
기존에는 task를 순차적으로 실행(pop → plan → codeGen → learn → pop …)했으나,
서로 의존성이 없는 task들은 **병렬 실행**하여 전체 job 완료 시간을 단축할 수 있다.

병렬 실행은 `ANT_TASK_CONCURRENCY > 1`일 때 활성화되며, 기본값은 3이다.
`ANT_TASK_CONCURRENCY=1`이면 기존 순차 경로로 fallback한다.

```
decompose → [taskQueue]
              │
              ├─ ANT_TASK_CONCURRENCY=1 → plan → codeGen → ... (순차 루프)
              │
              └─ ANT_TASK_CONCURRENCY>1 → parallelOrchestrator (이 문서의 범위)
                                            ├─ Worker 0: plan → codeGen → ... → learn
                                            ├─ Worker 1: plan → codeGen → ... → learn
                                            └─ Worker 2: plan → codeGen → ... → learn
```

---

## 2. 핵심 개념

### 2.1 BaseTask 확장 필드

| 필드 | 타입 | 설정 주체 | 역할 |
|------|------|-----------|------|
| `exclusive` | `boolean?` | decompose | true면 단독 실행 (다른 task와 동시 불가) |
| `parallelGroup` | `string?` | decompose LLM | 같은 그룹은 동시 실행 불가, 다른 그룹은 병렬 가능 |
| `packages` | `string[]?` | decompose LLM | task가 속한 패키지 (split injection용) |

### 2.2 exclusive vs parallelGroup

```
exclusive=true:  barrier 역할. 앞의 모든 task 완료 후 단독 실행, 완료 후 다음 진행.
                 setup, error, final-verification task에 사용.

exclusive=false + parallelGroup:
  - 같은 parallelGroup → 동시 실행 불가 (리소스 충돌 방지)
  - 다른 parallelGroup → 동시 실행 가능
  - parallelGroup 미지정 → 보수적으로 단독 실행

예시:
  Task A (parallelGroup="be-layer") ─┐
  Task B (parallelGroup="fe-layer") ─┼─ 동시 실행 가능
  Task C (parallelGroup="be-layer") ─┘─ A와 충돌, A 완료 후 실행
```

### 2.3 priority 기반 정렬

TaskQueue는 priority 오름차순으로 정렬된다.
낮은 priority가 먼저 실행된다.

| priority | 용도 |
|----------|------|
| 100 | setup task |
| 200-300 | feature task (패키지/레이어별) |
| 1000 | final-verification |

---

## 3. 컴포넌트 아키텍처

### 3.1 전체 구조

```
graph.ts (parallelOrchestrator 노드)
  │
  ├── TaskOrchestrator<T>     : 중앙 조정자, task 할당, 생명주기 관리
  │     ├── taskQueue          : priority 기반 task 큐
  │     ├── runningTasks       : 현재 실행 중인 task Map<workerId, task>
  │     ├── completedTasks     : 완료된 task 목록
  │     ├── failedTasks        : 영구 실패한 task 목록
  │     └── AsyncMutex (lock)  : 공유 상태 보호
  │
  ├── TaskWorker<T> (N개)     : 독립적 task 실행기
  │     ├── requestTask()      : orchestrator에서 task 요청
  │     ├── executeTask()      : worker subgraph invoke
  │     └── reportCompletion() / reportFailure()
  │
  └── WorkerSubgraph          : LangGraph StateGraph (task 1개 실행)
        plan → codeGen ↔ tool → checkTaskStatus → enforce/learn → END
```

### 3.2 TaskOrchestrator

단일 프로세스 내 async/await 병렬성을 관리한다.
Worker Thread나 child process를 사용하지 않는다.

**주요 메서드:**

| 메서드 | 역할 |
|--------|------|
| `run()` | 모든 task 완료까지 대기, 결과 반환 |
| `requestTask(workerId)` | 충돌 없는 다음 task 할당 |
| `reportCompletion(workerId, task)` | 완료 처리 + 체크포인트 |
| `reportFailure(workerId, task, error)` | 에러 분류 + 재시도/영구실패 |
| `handleInterruption(reason)` | graceful 중단 (아래 상세 참조) |
| `saveCheckpoint()` | 현재 상태를 세션 파일에 저장 |

**handleInterruption 내부 흐름:**

```
handleInterruption(reason)
  └─ lock.runExclusive:
       1. drain()              — draining=true, 주기적 체크포인트 중지
       2. signalWorkersToStop() — 모든 worker에 requestStop() 호출
       3. saveCheckpoint()     — running task를 interrupted로 마킹, 큐에 복원
       4. checkAllDone()       — running task가 0이면 run() resolve
```

`drain()`과 `signalWorkersToStop()`은 private 헬퍼 메서드로 분리되어 있다.
`gracefulShutdown.ts`에서 SIGTERM 수신 시 등록된 orchestrator의 `handleInterruption()`을 호출한다.

### 3.3 TaskWorker

각 worker는 무한 루프로 동작:

```
while (true) {
  task = orchestrator.requestTask(workerId)
  if (!task) break  // 큐 비었거나 draining
  try {
    result = workerSubgraph.invoke(workerState)
    orchestrator.reportCompletion(workerId, result)
  } catch (error) {
    orchestrator.reportFailure(workerId, task, error)
  }
}
```

Worker는 `sharedContext`(읽기 전용 공유 상태)와 per-task state를 조합하여
독립적인 workerState를 생성한다.

### 3.4 Worker Subgraph

메인 그래프의 경량 버전. 차이점:

| 항목 | 메인 그래프 | Worker Subgraph |
|------|------------|-----------------|
| task 관리 | taskQueue.pop() | orchestrator가 currentTask 지정 |
| checkpoint | 전역 saveCheckpoint() | orchestrator 위임 |
| Kanban UI | plan 노드에서 직접 업데이트 | orchestrator가 일괄 업데이트 |
| installDeps | 항상 포함 | exclusive task만 포함 |
| learn → 다음 task | 루프 | learn → END (worker 종료) |

두 가지 variant:
- **Standard**: plan → codeGen ↔ tool → checkTaskStatus → learn → END
- **With install/validate**: installDeps → runtimeValidate 경로 추가 (exclusive task용)

---

## 4. Task 할당 알고리즘

### 4.1 findAndAssignNonConflictingTask

```
1. 현재 실행 중인 parallelGroup 목록 수집
2. taskQueue 순회:
   a. exclusive task → barrier, 순회 중단
   b. parallelGroup 미지정 → running이 0일 때만 할당
   c. parallelGroup이 running과 충돌 → skip
   d. 충돌 없음 → 할당
```

### 4.2 Worker 생성 규칙

```
spawnAvailableWorkers():
  1. draining 상태면 생성 안함
  2. 현재 worker 수 < maxWorkers 확인
  3. 병렬 실행 가능한 task 수 계산 (running과 비충돌 그룹)
  4. 필요한 worker 수 = 가능한 task - idle worker
  5. min(필요한 수, 남은 슬롯) 만큼 생성
```

---

## 5. 체크포인트 & 상태 영속성

### 5.1 저장 시점

| 시점 | 트리거 |
|------|--------|
| task 완료 | `reportCompletion()` → `saveCheckpoint()` |
| task 실패 | `reportFailure()` → `saveCheckpoint()` |
| 주기적 | 60초 interval timer |
| 사용자 중단 | `handleInterruption()` → drain + signalStop + saveCheckpoint + checkAllDone |
| 병렬 실행 완료 (실패 존재) | `parallelOrchestrator` → `updateArtifacts()` |

### 5.2 체크포인트 내용

```typescript
{
  taskQueue: [...runningTasks(interrupted), ...pendingTasks],
  completedTasks: [...],
  completedTasksDetails: [...],
  failedTasks: [{ taskId, taskName, error, timestamp }],
  tokenUsage: { inputTokens, outputTokens, ... },
  parallelMode: true,
  interruption?: { reason, canResume }
}
```

Running task는 `interrupted: true`로 마킹하여 큐 앞에 배치한다.
resume 시 plan 노드의 canSkipPlan 로직으로 이어서 실행 가능.

### 5.3 세션 파일 동시 쓰기 보호

`FileSessionAdapter`에 두 가지 보호 메커니즘:

**Per-job FileMutex**: `updateArtifacts()`, `addTurn()` 등 read-modify-write 작업을
job 타입별로 직렬화한다. 다수 worker가 동시에 `saveCheckpoint()`을 호출해도
하나씩 순차적으로 처리된다.

**Atomic write**: temp 파일에 먼저 쓴 후 `fs.rename()`으로 원본을 교체한다.
POSIX 시스템에서 같은 파일시스템 내 rename은 atomic이므로,
프로세스 kill 시에도 partial JSON이 남지 않는다.

```
write → .code.json.{pid}.tmp → rename → code.json
```

---

## 6. 에러 처리

### 6.1 에러 분류

| 분류 | 예시 | 재시도 |
|------|------|--------|
| **결정적 (deterministic)** | prompt too long, 400, 401, 403, auth error | 즉시 failedTasks |
| **일시적 (transient)** | timeout, rate limit, 5xx, 네트워크 | 최대 2회 재시도 |

`isDeterministicError(error)` 함수가 에러 메시지를 패턴 매칭하여 분류한다.

### 6.2 실패 흐름

```
task 실패
  ├─ 결정적 에러 → failedTasks에 즉시 추가
  │                (재시도해도 같은 결과이므로 토큰 낭비 방지)
  │
  └─ 일시적 에러
       ├─ attempts < MAX_TASK_RETRIES → 재큐잉 (interrupted=true)
       └─ attempts >= MAX_TASK_RETRIES → failedTasks에 추가

drain하지 않음 → 다른 running task는 계속 완료 허용
모든 task 종료 후:
  failedTasks 존재 → job을 "interrupted" 상태로 마킹
  failedTasks 없음 → 정상 완료
```

### 6.3 Interrupted Job

병렬 실행 종료 후 failedTasks가 있으면:
- 실패한 task를 `_failed: true` 플래그와 함께 큐에 넣음
- `interruption.reason = 'tasks_failed'` 저장
- `canResume: true` → 재시도 가능

---

## 7. 프롬프트 주입 설계

### 7.1 Design Doc Split Injection

task.packages에 따라 필요한 설계 문서만 주입:

```
task.packages = ['fe'] → fe-system-design + api-contract
task.packages = ['be'] → be-system-design + api-contract
task.packages = ['fe', 'be'] → 모두 포함
```

구현: `buildDesignDocForTask()` in `designSelector.ts`

### 7.2 Plan 노드: 파일 경로만 주입

Plan 노드는 전략적 플래너 역할이며, 실제 파일 읽기는 CodeGen이 `read_file` 도구로 수행한다.
따라서 RAG 결과는 **파일 경로 목록만** 주입한다 (파일 전문 아님).

```
❌ 이전 (버그): 파일 전문 주입 → 495K chars → 203K tokens 초과
✅ 현재: 파일 경로만 주입 → ~수K chars

Plan: "이 파일들이 관련된다" (경로)
CodeGen: read_file()로 실제 내용 확인 후 작업
```

### 7.3 recursionLimit

각 worker subgraph는 독립적인 recursionLimit을 가진다.
LangGraph `invoke()` 호출 시 `recursionLimit` config를 명시적으로 전달한다.

```typescript
graph.invoke(workerState, {
  recursionLimit: workerState.recursionLimit || 800,
});
```

메인 그래프의 recursionLimit과 별개로 per-worker 적용된다.

---

## 8. 설정

| 환경변수 | 기본값 | 역할 |
|----------|--------|------|
| `ANT_TASK_CONCURRENCY` | 3 | 최대 동시 worker 수 |
| `RECURSION_LIMIT` | 800 | worker subgraph의 LangGraph recursion limit |

---

## 9. Code Job vs Design Job

두 job 타입 모두 동일한 TaskOrchestrator + TaskWorker 인프라를 사용한다.
차이점은 worker subgraph 구성:

| 항목 | Code Job | Design Job |
|------|----------|------------|
| Worker subgraph | plan → codeGen ↔ tool → check → learn | plan → docGen → tool → check → learn |
| exclusive task | setup, error, final-verification | api-contract |
| parallelGroup | 패키지/레이어 기반 | 문서 타입 기반 |
| split injection | 설계 문서 (package 기반) | N/A |

---

## 10. 관련 파일

| 파일 | 역할 |
|------|------|
| `graph/code/parallel/TaskOrchestrator.ts` | 중앙 조정자, task 할당/완료/실패 관리 |
| `graph/code/parallel/TaskWorker.ts` | 독립 task 실행기, subgraph invoke |
| `graph/code/parallel/workerGraph.ts` | code job worker subgraph 빌더 |
| `graph/code/parallel/types.ts` | 타입 정의 (OrchestratorResult, FailedTask 등) |
| `graph/code/parallel/AsyncMutex.ts` | 단일 프로세스 async mutex |
| `graph/code/graph.ts` | parallelOrchestrator 노드 정의 |
| `graph/design/graph.ts` | design job parallelOrchestrator 노드 |
| `periphery/adapters/session/FileSessionAdapter.ts` | 세션 파일 I/O (FileMutex + atomic write) |
| `core/prompt/engine/PromptEngine.ts` | Plan 프롬프트 빌더 (경로만 주입) |
| `nodes/detectEnvironment/designSelector.ts` | 설계 문서 split injection |
| `ant-shared/src/task.ts` | BaseTask 타입 (exclusive, parallelGroup) |
