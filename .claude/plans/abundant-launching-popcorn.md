# Fix: Verification task duplicated in done when batch-split

## Context

Verification task가 batch split할 때 (에러 발견 → 에러 서브태스크 생성 + 자신을 todo로 재등록), done에도 추가되고 todo에도 재등록되어 중복이 발생한다. 최근 커밋(`4b146790`)에서 `_batchSplitCompleted` 플래그와 `reportBatchSplit()` 도입으로 수정 시도했으나 여전히 재현됨.

## Root Cause: 2개의 child process가 동시에 실행됨

### 증거: 디버그 로그 elapsed time 분석

`log-final-mending-marsh.json`의 events-page 이중 완료:

```
14:10:26.553Z | task_complete | events-page | elapsed=5019961ms
  → startedAt = 14:10:26 - 5019s = 12:46:46 (세션2 시작시간) ✓

14:10:30.909Z | task_complete | events-page | elapsed=6084518ms
  → startedAt = 14:10:30 - 6084s = 12:29:06 (세션1 시작시간) ✓
```

→ **세션1(12:29:06 시작)의 child process가 살아있는 상태에서 세션2(12:46:46)의 child process가 시작됨.**
이 패턴은 verification만이 아닌 **세션2의 모든 task에서** 동일하게 나타남.

### 프로세스 중복의 실제 시나리오: Mac Sleep → BullMQ Stalled Job

사용자 증언: 로컬머신에서 작업을 시킨 후 장시간 방치 → Mac이 sleep/유휴 상태 진입 → 프로세스 기동 멈춤 → Mac 활성화 후 잠시 뒤 진행 재개. **명시적 Stop/Resume 없었음.**

#### 타임라인

```
T=0       : 세션1 실행 중 (4개 worker, task 처리 중)
T=?       : Mac sleep 진입 → 모든 프로세스 동결 (Node.js, Docker Redis 포함)
            ↓ (장시간 경과)
T=wake    : Mac 활성화 → Docker Redis 먼저 깨어남
            → Redis 내부 시계가 wall clock과 동기화됨
            → BullMQ lock이 이미 만료된 상태 (30s TTL, 수십분 경과)
T=wake+~30s: BullMQ stalledInterval 체크 → lock 없는 job 감지 → stalled event 발생
            → stalled handler: status='paused' 설정
            → maxStalledCount=1 → BullMQ가 job을 재처리(re-process)
T=wake+~31s: processJob() 재호출 → 새 child process 스폰
            ⚠️ 이 시점에서 old child process도 깨어나서 실행 재개
            → 2개의 child process가 동시 실행
```

#### 왜 old child가 죽지 않는가?

1. **stalled handler** (JobWorker.ts:107-166): job status만 'paused'로 변경. **child process를 kill하지 않음.**
2. **processJob()** (JobWorker.ts:243-300): 기존 runningProcesses에 같은 jobId가 있는지 **확인하지 않음.** 바로 spawnJobProcess() 호출.
3. **runningProcesses.set(jobId, newChild)** (spawnJobProcess 내): old child 참조를 덮어씀 → old child는 orphaned zombie가 됨.
4. **checkCancellation** (1초 폴링): isUserStopped(jobId)를 체크하지만, 아무도 markUserStopped를 호출하지 않았으므로 항상 false.

#### 네트워크 끊김 시 명시적 중단이 되어야 하는가?

**맞다.** stalled handler가 status='paused'로 설정하는 것까지는 정상 동작이지만, **old child를 kill하는 코드가 없다**는 것이 핵심 버그. stalled 감지 시 해당 jobId의 child process를 SIGTERM해야 한다.

### Stop → Resume 시나리오도 동일한 버그

명시적 Stop → Resume 시에도 같은 문제가 발생할 수 있음:
- `BullMQJobQueue.enqueue()` (line 352)에서 `clearUserStopped(jobId)`를 즉시 호출
- Old child의 `checkCancellation` 폴링(1초 간격)이 flag를 확인하기 전에 flag가 지워짐
- Redis pub/sub 메시지도 fire-and-forget으로 유실 가능
- 결과: old child가 stop을 감지 못하고 계속 실행

### Verification이 done에 들어가는 직접적 경로

```
세션1 Worker: verification 실행 → 정상 완료 → reportCompletion() → done에 추가
세션2 Worker: verification 실행 → batch split → reportBatchSplit() → todo로 재등록
결과: verification이 done에도 있고 todo에도 있음
```

## Fix Strategy: 근본 원인 + 방어

### Fix 1 (근본 원인): processJob()에서 기존 child process 강제 종료

두 시나리오(stalled re-processing, Stop→Resume) 모두 processJob()이 같은 jobId로 재호출될 때 old child를 kill하지 않는 것이 원인. processJob() 시작부에서 기존 child를 확실히 죽인다.

**파일**: `packages/ant-cli/src/infrastructure/worker/JobWorker.ts` (line 243)

```typescript
private async processJob(job: Job<JobPayload>): Promise<any> {
    const payload = job.data;
    const jobId = payload.jobId;

    // ✅ Kill any existing child process for the same jobId
    // Covers: (a) BullMQ stalled job re-processing after Mac sleep
    //         (b) Stop → Resume race condition
    const existingChild = this.runningProcesses.get(jobId);
    if (existingChild && existingChild.pid) {
      logger.warn(`Killing existing child for re-processed job: ${jobId} (PID: ${existingChild.pid})`, { component: 'JobWorker', jobId });
      try {
        existingChild.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3000);
          existingChild.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
        try {
          process.kill(existingChild.pid, 0); // check alive
          process.kill(existingChild.pid, 'SIGKILL');
        } catch { /* already exited */ }
      } catch (err: any) {
        logger.warn(`Failed to kill existing child: ${err.message}`, { component: 'JobWorker', jobId });
      }
      this.runningProcesses.delete(jobId);
    }

    try {
      // ... existing code ...
```

### Fix 1b: stalled handler에서도 child process kill

**파일**: `packages/ant-cli/src/infrastructure/worker/JobWorker.ts` (line 107-166)

stalled handler에서 status 업데이트 전에 해당 jobId의 child를 종료:

```typescript
this.worker.on('stalled', async (jobId: string) => {
  logger.warn(`Job stalled (worker crash detected): ${jobId}`, { component: 'JobWorker', jobId });

  // ✅ Kill the child process for this stalled job (if running in this pod)
  const stalledChild = this.runningProcesses.get(jobId);
  if (stalledChild && stalledChild.pid) {
    logger.warn(`Killing stalled child process: ${jobId} (PID: ${stalledChild.pid})`, { component: 'JobWorker', jobId });
    try {
      stalledChild.kill('SIGTERM');
      // Don't wait long — stalled handler should be fast
      setTimeout(() => {
        try { process.kill(stalledChild.pid!, 'SIGKILL'); } catch { /* ok */ }
      }, 2000);
    } catch { /* already dead */ }
    this.runningProcesses.delete(jobId);
  }

  // ... existing idempotency lock + status update code ...
});
```

### Fix 1c: `BullMQJobQueue.enqueue()`에서 `clearUserStopped` 제거

**파일**: `packages/ant-cli/src/infrastructure/queue/BullMQJobQueue.ts` (line 350-353)

```typescript
// BEFORE:
await this.stateStore.clearUserStopped(jobId);

// AFTER: 제거. clearUserStopped는 JobWorker.processJob()에서
// 기존 child kill 후에 수행 (processJob 시작부에 추가).
```

processJob()에서 기존 child kill 후 clearUserStopped 호출 추가:

```typescript
    // (after killing existing child, before try block)
    await this.stateStore.clearUserStopped(jobId);
```

### Fix 2 (방어): `reportCompletion` 중복 ID guard

**파일**: `packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts`

`reportCompletion()` (line 245-291)에서 `completedTasks.push(task)` 전에:

```typescript
      this.runningTasks.delete(workerId);

      // ✅ Guard: Prevent duplicate completion (defense against process overlap)
      const alreadyCompleted = this.completedTasks.some(t => t.id === task.id);
      const reEnqueued = this.taskQueue.getAll().some(t => t.id === task.id);
      if (alreadyCompleted || reEnqueued) {
        console.warn(`[Orchestrator] Task "${task.name}" skipped completion (worker ${workerId}): alreadyCompleted=${alreadyCompleted}, reEnqueued=${reEnqueued}`);
        this.broadcastKanban();
        this.spawnAvailableWorkers();
        this.checkAllDone();
        return;
      }

      task.completed = true;
      // ... rest unchanged
```

### Fix 3 (방어): `reportBatchSplit`에서 checkpoint 저장

**파일**: `packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts`

`reportBatchSplit()` (line 297-307)에 checkpoint 저장 추가:

```typescript
      this.runningTasks.delete(workerId);
      this.broadcastKanban();

      // ✅ Save checkpoint after batch split (ensures re-enqueued state persists)
      try {
        await this.saveCheckpoint();
      } catch (err) {
        console.warn(`[Orchestrator] Post-batch-split checkpoint failed:`, err);
      }

      this.spawnAvailableWorkers();
```

### Fix 4 (방어): `onTaskComplete`에서 verification 중복 생성 방지

**파일**: `packages/ant-cli/src/agents/architect/graph/code/graph.ts`

`onTaskComplete` callback (line 499-516)에서 running/completed 검사 추가:

```typescript
    const hasFinalInQueue = taskQueue.getAll().some((t: CodeTask) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
    const hasFinalRunning = orchestrator.getRunningTasks().some((t: any) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
    const hasFinalCompleted = orchestrator.getCompletedTasks().some((t: any) => t.type === 'verification');
    if (!hasFinalInQueue && !hasFinalRunning && !hasFinalCompleted) {
```

## Files to modify

1. `packages/ant-cli/src/infrastructure/worker/JobWorker.ts` — Fix 1 (processJob old child kill) + Fix 1b (stalled handler child kill)
2. `packages/ant-cli/src/infrastructure/queue/BullMQJobQueue.ts` — Fix 1c (clearUserStopped 제거)
3. `packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts` — Fix 2 & 3
4. `packages/ant-cli/src/agents/architect/graph/code/graph.ts` — Fix 4

## Verification

```bash
cd packages/ant-cli && pnpm vitest run tests/
```

수동 테스트:
1. **Stalled 시나리오**: code job 실행 중 Mac sleep 시뮬레이션 (또는 Redis lock 수동 삭제) → 로그에서 "Killing stalled child process" 메시지 확인
2. **Stop→Resume 시나리오**: code job 실행 중 Stop → 즉시 Resume → 로그에서 "Killing existing child for re-processed job" 메시지 확인
3. 이후 verification batch-split 시 done에 중복 없는지 확인
