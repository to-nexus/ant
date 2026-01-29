# Cloud Scalability Implementation Plan

> 10-cloud-scalability-design.md 설계를 구현하기 위한 상세 실행 계획

## 1. 개요

### 1.1 목표

ant-cli를 **클라우드 서비스로 확장 가능한 구조**로 리팩토링

### 1.2 제약 조건

- 기존 로컬 모드 완전 유지 (하위 호환성)
- 점진적 마이그레이션 (Big Bang 금지)
- 각 Phase는 독립적으로 배포 가능

### 1.3 Phase 순서 및 구현 현황

| Phase | 목표 | 상태 |
|-------|------|------|
| **Phase 1** | Interface 추출, 로컬 구현체 래핑 | ✅ 완료 |
| **Phase 2** | Redis State Store, BullMQ Job Queue, JobWorker | ✅ 완료 |
| **Phase 3** | Remote Preview Orchestration | ✅ 완료 |
| **Phase 4** | Kubernetes IDE Orchestration | ✅ 완료 |

**추가 완료 항목**:
- ✅ `FileSystemAdapter` (POSIX 호환 - Local/EFS 통합)
- ✅ `WorkspaceResolver` 경로 계산 중앙집중화
- ✅ `JobWorker` featurePath 버그 수정

> **현재**: 단일 머신에서 클라우드 모드 테스트 가능

---

## 2. Phase 1: Interface 추출

### 2.1 목표

기존 로직을 인터페이스 뒤로 숨기고, 로컬 구현체로 래핑

**변경 전**:
```
ExpressServerAdapter → JobStateTracker (직접 Map 접근)
                     → InMemoryPortRegistry (직접 Map 접근)
                     → DevServerService (직접 spawn, Preview 담당)
                     → IDEService (직접 docker API)
```

**변경 후**:
```
ExpressServerAdapter → StateStorePort → InMemoryStateStore
                     → JobQueuePort → LocalJobQueue
                     → PreviewOrchestratorPort → LocalPreviewOrchestrator
                     → IDEOrchestratorPort → DockerIDEOrchestrator
```

### 2.2 작업 목록

#### 2.2.1 StateStorePort 정의 및 구현

**파일 생성**:

```
src/core/ports/stateStore.ts
src/infrastructure/state/InMemoryStateStore.ts
src/infrastructure/state/index.ts
```

**Interface 정의**:

```typescript
// src/core/ports/stateStore.ts
export interface JobStatusData {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  projectId: string;
  featureName: string;
  jobType: 'code' | 'design' | 'learn';
  userContext?: UserContext;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface StateStorePort {
  // Job Status
  setJobStatus(jobId: string, status: JobStatusData): Promise<void>;
  getJobStatus(jobId: string): Promise<JobStatusData | null>;
  deleteJobStatus(jobId: string): Promise<void>;
  listJobsByFeature(projectId: string, feature: string): Promise<JobStatusData[]>;
  
  // Job Logs
  appendJobLog(jobId: string, log: LogEntry): Promise<void>;
  getJobLogs(jobId: string): Promise<LogEntry[]>;
  clearJobLogs(jobId: string): Promise<void>;
  
  // Port Registry (기존 PortRegistryPort 통합)
  registerPreview(key: string, mapping: PortMapping): Promise<void>;
  getPreview(key: string): Promise<PortMapping | null>;
  unregisterPreview(key: string): Promise<void>;
  listPreviews(): Promise<PortMapping[]>;
  
  registerIDE(key: string, mapping: PortMapping): Promise<void>;
  getIDE(key: string): Promise<PortMapping | null>;
  unregisterIDE(key: string): Promise<void>;
  listIDEs(): Promise<PortMapping[]>;
  
  // Pub/Sub (클라우드 모드에서 사용)
  publish(channel: string, message: any): Promise<void>;
  subscribe(channel: string, callback: (message: any) => void): Promise<() => void>;
  
  // Lifecycle
  close(): Promise<void>;
}
```

**InMemoryStateStore 구현**:

```typescript
// src/infrastructure/state/InMemoryStateStore.ts
export class InMemoryStateStore implements StateStorePort {
  private jobs = new Map<string, JobStatusData>();
  private jobLogs = new Map<string, LogEntry[]>();
  private devServers = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();
  private subscribers = new Map<string, Set<(message: any) => void>>();
  
  // Implementation...
}
```

**마이그레이션 체크리스트**:

- [ ] `JobStateTracker` 로직을 `InMemoryStateStore`로 이전
- [ ] `InMemoryPortRegistry` 로직을 `InMemoryStateStore`로 통합
- [ ] `ExpressServerAdapter`가 `StateStorePort` 사용하도록 수정
- [ ] 기존 테스트 통과 확인

#### 2.2.2 JobQueuePort 정의 및 구현

**파일 생성**:

```
src/core/ports/jobQueue.ts
src/infrastructure/queue/LocalJobQueue.ts
src/infrastructure/queue/index.ts
```

**Interface 정의**:

```typescript
// src/core/ports/jobQueue.ts
export interface JobPayload {
  jobId: string;
  type: 'code' | 'design' | 'learn';
  agent: string;
  projectId: string;
  feature: string;
  userContext: UserContext;
  workspacePath: string;
  mode?: string;
  overrideDirective?: string;
  chatSource?: boolean;
}

export interface JobQueuePort {
  // Job 등록
  enqueue(payload: JobPayload): Promise<string>;
  
  // Job 상태 조회
  getStatus(jobId: string): Promise<'pending' | 'running' | 'completed' | 'failed' | null>;
  
  // Job 취소
  cancel(jobId: string): Promise<void>;
  
  // 진행 상황 콜백
  onProgress(jobId: string, callback: (progress: JobProgress) => void): () => void;
  onComplete(jobId: string, callback: (result: JobResult) => void): () => void;
  
  // Lifecycle
  close(): Promise<void>;
}
```

**LocalJobQueue 구현**:

```typescript
// src/infrastructure/queue/LocalJobQueue.ts
export class LocalJobQueue implements JobQueuePort {
  private processes = new Map<string, ChildProcess>();
  private progressCallbacks = new Map<string, Set<(progress: JobProgress) => void>>();
  
  async enqueue(payload: JobPayload): Promise<string> {
    // 기존 JobExecutionManager.runJob() 로직 이전
    const childProcess = await this.spawnChildProcess(payload);
    this.processes.set(payload.jobId, childProcess);
    return payload.jobId;
  }
  
  // Implementation...
}
```

**마이그레이션 체크리스트**:

- [ ] `JobExecutionManager.runJob()` 로직을 `LocalJobQueue.enqueue()`로 이전
- [ ] `JobExecutionManager.spawnChildProcess()` 로직 이전
- [ ] `ExpressServerAdapter`가 `JobQueuePort` 사용하도록 수정
- [ ] 기존 테스트 통과 확인

#### 2.2.3 PreviewOrchestratorPort 정의 및 구현

**파일 생성**:

```
src/core/ports/previewOrchestrator.ts
src/infrastructure/preview/LocalPreviewOrchestrator.ts
src/infrastructure/preview/index.ts
```

**Interface 정의**:

```typescript
// src/core/ports/previewOrchestrator.ts
export interface PreviewParams {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  workspacePath: string;
}

export interface PreviewInstance {
  instanceId: string;
  host: string;           // 'localhost' or remote host
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  packages?: PackageInfo[];
}

export interface PreviewOrchestratorPort {
  start(params: PreviewParams): Promise<PreviewInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<PreviewInstance | null>;
  getLogs(instanceId: string): Promise<LogEntry[]>;
  streamLogs(instanceId: string, callback: (log: LogEntry) => void): () => void;
  cleanup(): Promise<void>;
}
```

**LocalPreviewOrchestrator 구현**:

```typescript
// src/infrastructure/preview/LocalPreviewOrchestrator.ts
export class LocalPreviewOrchestrator implements PreviewOrchestratorPort {
  private devServerService: DevServerService;  // 기존 서비스 래핑
  
  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.devServerService = new DevServerService(portManager, portRegistry);
  }
  
  async start(params: PreviewParams): Promise<PreviewInstance> {
    const result = await this.devServerService.startDevServer(
      params.tenantId,
      params.userId,
      params.projectId,
      params.feature,
      params.workspacePath
    );
    
    return {
      instanceId: result.serverKey!,
      host: 'localhost',  // 로컬은 항상 localhost
      port: result.port!,
      status: 'running',
      // ...
    };
  }
  
  // Implementation...
}
```

**마이그레이션 체크리스트**:

- [ ] `LocalPreviewOrchestrator`가 기존 `DevServerService` 래핑
- [ ] `previewProxy.ts`가 `instance.host`를 동적으로 사용하도록 수정
- [ ] API 라우트가 Orchestrator 사용하도록 수정
- [ ] 기존 테스트 통과 확인

#### 2.2.4 IDEOrchestratorPort 정의 및 구현

**파일 생성**:

```
src/core/ports/ideOrchestrator.ts
src/infrastructure/ide/DockerIDEOrchestrator.ts
src/infrastructure/ide/index.ts
```

**Interface 정의**:

```typescript
// src/core/ports/ideOrchestrator.ts
export interface IDEParams {
  tenantId: string;
  userId: string;
  projectId: string;
  workspacePath: string;
  userContext: UserContext;
}

export interface IDEInstance {
  instanceId: string;
  host: string;           // 'localhost' or pod IP
  port: number;
  workspacePath: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  url: string;
}

export interface IDEOrchestratorPort {
  start(params: IDEParams): Promise<IDEInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<IDEInstance | null>;
  list(): Promise<IDEInstance[]>;
  cleanup(): Promise<void>;
  cleanupProject(userContext: UserContext, projectId: string): Promise<void>;
}
```

**DockerIDEOrchestrator 구현**:

```typescript
// src/infrastructure/ide/DockerIDEOrchestrator.ts
export class DockerIDEOrchestrator implements IDEOrchestratorPort {
  private ideService: IDEService;  // 기존 서비스 래핑
  
  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.ideService = new IDEService(portManager, portRegistry);
  }
  
  async start(params: IDEParams): Promise<IDEInstance> {
    const result = await this.ideService.startIDE(
      params.userContext,
      params.projectId,
      params.workspacePath
    );
    
    return {
      instanceId: result.containerId,
      host: 'localhost',  // Docker는 항상 localhost
      port: result.port,
      workspacePath: result.workspacePath,
      status: 'running',
      url: result.url
    };
  }
  
  // Implementation...
}
```

**마이그레이션 체크리스트**:

- [ ] `DockerIDEOrchestrator`가 기존 `IDEService` 래핑
- [ ] `ideProxy.ts`가 `instance.host`를 동적으로 사용하도록 수정
- [ ] API 라우트가 Orchestrator 사용하도록 수정
- [ ] 기존 테스트 통과 확인

#### 2.2.5 AdapterFactory 구현

**파일 생성**:

```
src/infrastructure/adapters/AdapterFactory.ts
```

**구현**:

```typescript
// src/infrastructure/adapters/AdapterFactory.ts
import { StateStorePort } from '../../core/ports/stateStore';
import { JobQueuePort } from '../../core/ports/jobQueue';
import { PreviewOrchestratorPort } from '../../core/ports/previewOrchestrator';
import { IDEOrchestratorPort } from '../../core/ports/ideOrchestrator';

import { InMemoryStateStore } from '../state/InMemoryStateStore';
import { LocalJobQueue } from '../queue/LocalJobQueue';
import { LocalPreviewOrchestrator } from '../preview/LocalPreviewOrchestrator';
import { DockerIDEOrchestrator } from '../ide/DockerIDEOrchestrator';

export class AdapterFactory {
  private static stateStore: StateStorePort;
  private static jobQueue: JobQueuePort;
  private static previewOrchestrator: PreviewOrchestratorPort;
  private static ideOrchestrator: IDEOrchestratorPort;
  
  static getStateStore(): StateStorePort {
    if (!this.stateStore) {
      // Phase 2에서 Redis 추가
      this.stateStore = new InMemoryStateStore();
    }
    return this.stateStore;
  }
  
  static getJobQueue(): JobQueuePort {
    if (!this.jobQueue) {
      // Phase 2에서 BullMQ 추가
      this.jobQueue = new LocalJobQueue(this.getStateStore());
    }
    return this.jobQueue;
  }
  
  static getPreviewOrchestrator(): PreviewOrchestratorPort {
    if (!this.previewOrchestrator) {
      // Phase 3에서 Remote 추가
      this.previewOrchestrator = new LocalPreviewOrchestrator();
    }
    return this.previewOrchestrator;
  }
  
  static getIDEOrchestrator(): IDEOrchestratorPort {
    if (!this.ideOrchestrator) {
      // Phase 4에서 K8s 추가
      this.ideOrchestrator = new DockerIDEOrchestrator();
    }
    return this.ideOrchestrator;
  }
  
  static async cleanup(): Promise<void> {
    await this.stateStore?.close();
    await this.jobQueue?.close();
    await this.previewOrchestrator?.cleanup();
    await this.ideOrchestrator?.cleanup();
  }
}
```

### 2.3 Phase 1 완료 기준

- [ ] 모든 인터페이스 정의 완료
- [ ] 모든 로컬 구현체 완료 (기존 로직 래핑)
- [ ] `ExpressServerAdapter`가 인터페이스 통해 접근
- [ ] 기존 모든 기능 정상 동작 (회귀 테스트)
- [ ] `ANT_SERVER_MODE=local`에서 기존과 동일 동작

---

## 3. Phase 2: Redis 구현

### 3.1 목표

Redis 기반 상태 저장소 및 Job Queue 구현

### 3.2 인프라 요구사항

```yaml
# docker-compose.dev.yml (개발용)
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
```

### 3.3 작업 목록

#### 3.3.1 RedisStateStore 구현

**파일 생성**:

```
src/infrastructure/state/RedisStateStore.ts
```

**Redis 스키마**:

```
# Job Status
job:{jobId}           → Hash { status, projectId, feature, ... }
job:{jobId}:logs      → List [ log1, log2, ... ]

# Port Registry
preview:{serverKey}   → Hash { host, port, registeredAt, ... }
ide:{serverKey}       → Hash { host, port, registeredAt, ... }

# Indexes
jobs:project:{projectId}:feature:{feature} → Set [ jobId1, jobId2, ... ]
previews:all          → Set [ serverKey1, serverKey2, ... ]
ides:all              → Set [ serverKey1, serverKey2, ... ]

# Pub/Sub
channel:job:{jobId}:progress → Progress updates
channel:preview:{serverKey}:logs → Preview log stream
```

**구현**:

```typescript
// src/infrastructure/state/RedisStateStore.ts
import { Redis } from 'ioredis';

export class RedisStateStore implements StateStorePort {
  private redis: Redis;
  private subscriber: Redis;
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }
  
  async setJobStatus(jobId: string, status: JobStatusData): Promise<void> {
    const key = `job:${jobId}`;
    await this.redis.hset(key, {
      ...status,
      updatedAt: new Date().toISOString()
    });
    
    // Index by project/feature
    const indexKey = `jobs:project:${status.projectId}:feature:${status.featureName}`;
    await this.redis.sadd(indexKey, jobId);
  }
  
  async getJobStatus(jobId: string): Promise<JobStatusData | null> {
    const key = `job:${jobId}`;
    const data = await this.redis.hgetall(key);
    if (!data || Object.keys(data).length === 0) return null;
    return data as JobStatusData;
  }
  
  async appendJobLog(jobId: string, log: LogEntry): Promise<void> {
    const key = `job:${jobId}:logs`;
    await this.redis.rpush(key, JSON.stringify(log));
    
    // Pub/Sub for real-time
    await this.publish(`job:${jobId}:logs`, log);
  }
  
  async publish(channel: string, message: any): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }
  
  async subscribe(channel: string, callback: (message: any) => void): Promise<() => void> {
    await this.subscriber.subscribe(channel);
    
    const handler = (ch: string, msg: string) => {
      if (ch === channel) {
        callback(JSON.parse(msg));
      }
    };
    
    this.subscriber.on('message', handler);
    
    return () => {
      this.subscriber.unsubscribe(channel);
      this.subscriber.off('message', handler);
    };
  }
  
  async close(): Promise<void> {
    await this.redis.quit();
    await this.subscriber.quit();
  }
}
```

#### 3.3.2 BullMQJobQueue 구현

**의존성 추가**:

```bash
npm install bullmq
```

**파일 생성**:

```
src/infrastructure/queue/BullMQJobQueue.ts
```

**구현**:

```typescript
// src/infrastructure/queue/BullMQJobQueue.ts
import { Queue, Worker, Job } from 'bullmq';

export class BullMQJobQueue implements JobQueuePort {
  private queue: Queue;
  private progressCallbacks = new Map<string, Set<(progress: JobProgress) => void>>();
  
  constructor(redisUrl: string) {
    this.queue = new Queue('ant-jobs', {
      connection: { url: redisUrl }
    });
  }
  
  async enqueue(payload: JobPayload): Promise<string> {
    const job = await this.queue.add('execute', payload, {
      jobId: payload.jobId,
      removeOnComplete: false,
      removeOnFail: false
    });
    return job.id!;
  }
  
  async getStatus(jobId: string): Promise<'pending' | 'running' | 'completed' | 'failed' | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    
    const state = await job.getState();
    switch (state) {
      case 'waiting':
      case 'delayed':
        return 'pending';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return null;
    }
  }
  
  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }
  
  async close(): Promise<void> {
    await this.queue.close();
  }
}
```

#### 3.3.3 Job Worker 프로세스

**파일 생성**:

```
src/workers/job-worker.ts
src/workers/worker-entrypoint.ts
```

**Worker 구현**:

```typescript
// src/workers/job-worker.ts
import { Worker, Job } from 'bullmq';
import { spawn } from 'child_process';
import * as path from 'path';

export function startWorker(redisUrl: string) {
  const worker = new Worker('ant-jobs', async (job: Job<JobPayload>) => {
    const payload = job.data;
    
    // Update progress
    await job.updateProgress({ phase: 'starting' });
    
    // Build CLI args
    const antCliSrc = path.join(process.cwd(), 'src/index.ts');
    const args = [antCliSrc, payload.agent, payload.type, payload.workspacePath];
    
    // Build environment
    const env = {
      ...process.env,
      ANT_JOB_ID: payload.jobId,
      ANT_PROJECT_ID: payload.projectId,
      ANT_FEATURE_NAME: payload.feature,
      // ...
    };
    
    // Execute
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      child.stdout?.on('data', async (data) => {
        // Stream logs via Redis pub/sub
        await job.updateProgress({
          phase: 'running',
          log: { type: 'stdout', message: data.toString() }
        });
      });
      
      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          reject(new Error(`Exit code: ${code}`));
        }
      });
    });
  }, {
    connection: { url: redisUrl },
    concurrency: 2  // 동시 2개 job
  });
  
  return worker;
}
```

**Entrypoint**:

```typescript
// src/workers/worker-entrypoint.ts
import { startWorker } from './job-worker';

const redisUrl = process.env.ANT_REDIS_URL || 'redis://localhost:6379';

console.log(`Starting Ant Job Worker (Redis: ${redisUrl})`);

const worker = startWorker(redisUrl);

process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});
```

#### 3.3.4 AdapterFactory 업데이트

```typescript
// src/infrastructure/adapters/AdapterFactory.ts
static getStateStore(): StateStorePort {
  if (!this.stateStore) {
    if (process.env.ANT_STATE_STORE === 'redis') {
      const redisUrl = process.env.ANT_REDIS_URL || 'redis://localhost:6379';
      this.stateStore = new RedisStateStore(redisUrl);
    } else {
      this.stateStore = new InMemoryStateStore();
    }
  }
  return this.stateStore;
}

static getJobQueue(): JobQueuePort {
  if (!this.jobQueue) {
    if (process.env.ANT_JOB_QUEUE === 'bullmq') {
      const redisUrl = process.env.ANT_REDIS_URL || 'redis://localhost:6379';
      this.jobQueue = new BullMQJobQueue(redisUrl);
    } else {
      this.jobQueue = new LocalJobQueue(this.getStateStore());
    }
  }
  return this.jobQueue;
}
```

### 3.4 Phase 2 완료 기준

- [ ] `RedisStateStore` 구현 완료
- [ ] `BullMQJobQueue` 구현 완료
- [ ] Job Worker 프로세스 분리 완료
- [ ] `ANT_STATE_STORE=redis ANT_JOB_QUEUE=bullmq`로 전환 가능
- [ ] 로컬 모드 여전히 정상 동작
- [ ] Worker 2개 이상 실행 시 Job 분산 처리 확인

---

## 4. Phase 3: Remote Preview

### 4.1 목표

Preview를 원격 워커에서 실행

### 4.2 아키텍처

```
┌─────────────────┐         ┌─────────────────────────────────┐
│    ant-cli      │   HTTP  │        Preview Worker           │
│                 │◀───────▶│                                 │
│ RemoteOrchest.  │   /api  │  PreviewAgent                   │
│                 │         │    └─ npm/vite processes        │
│    Proxy        │─────────│─── localhost:30001-39999        │
└─────────────────┘   HTTP  └─────────────────────────────────┘
```

### 4.3 작업 목록

#### 4.3.1 PreviewAgent (워커에서 실행)

**파일 생성**:

```
src/agents/preview/PreviewAgent.ts
src/agents/preview/agent-entrypoint.ts
```

**Agent API**:

```typescript
// src/agents/preview/PreviewAgent.ts
import express from 'express';
import { DevServerService } from '../../periphery/adapters/http/services/DevServerService/DevServerService';

export function createPreviewAgent(port: number) {
  const app = express();
  const service = new DevServerService();
  
  app.use(express.json());
  
  // Start preview
  app.post('/api/start', async (req, res) => {
    const { tenantId, userId, projectId, feature, workspacePath } = req.body;
    
    const result = await service.startDevServer(
      tenantId, userId, projectId, feature, workspacePath
    );
    
    res.json(result);
  });
  
  // Stop preview
  app.post('/api/stop', async (req, res) => {
    const { tenantId, userId, projectId, feature } = req.body;
    
    const result = await service.stopDevServer(
      tenantId, userId, projectId, feature
    );
    
    res.json(result);
  });
  
  // Get status
  app.get('/api/status', async (req, res) => {
    const { tenantId, userId, projectId, feature } = req.query;
    
    const status = service.getDevServerStatus(
      tenantId as string,
      userId as string,
      projectId as string,
      feature as string
    );
    
    res.json(status);
  });
  
  // Stream logs
  app.get('/api/logs/stream', async (req, res) => {
    const { tenantId, userId, projectId, feature } = req.query;
    
    res.setHeader('Content-Type', 'text/event-stream');
    
    service.streamDevServerLogs(
      tenantId as string,
      userId as string,
      projectId as string,
      feature as string,
      res
    );
  });
  
  return app.listen(port);
}
```

#### 4.3.2 RemotePreviewOrchestrator

**파일 생성**:

```
src/infrastructure/preview/RemotePreviewOrchestrator.ts
```

**구현**:

```typescript
// src/infrastructure/preview/RemotePreviewOrchestrator.ts
export class RemotePreviewOrchestrator implements PreviewOrchestratorPort {
  private workers: string[];  // ['preview-worker-1.internal', 'preview-worker-2.internal']
  private workerIndex = 0;    // Round-robin
  private instances = new Map<string, { worker: string; port: number }>();
  
  constructor(workers: string[]) {
    this.workers = workers;
  }
  
  private getNextWorker(): string {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }
  
  async start(params: PreviewParams): Promise<PreviewInstance> {
    const worker = this.getNextWorker();
    const instanceId = `${params.tenantId}:${params.userId}:${params.projectId}:${params.feature}`;
    
    // Call remote agent
    const response = await fetch(`http://${worker}:4200/api/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    this.instances.set(instanceId, { worker, port: result.port });
    
    return {
      instanceId,
      host: worker,          // ← 원격 호스트!
      port: result.port,
      status: 'running'
    };
  }
  
  async stop(instanceId: string): Promise<void> {
    const info = this.instances.get(instanceId);
    if (!info) return;
    
    const [tenantId, userId, projectId, feature] = instanceId.split(':');
    
    await fetch(`http://${info.worker}:4200/api/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, userId, projectId, feature })
    });
    
    this.instances.delete(instanceId);
  }
  
  // ...
}
```

#### 4.3.3 Proxy 수정

```typescript
// src/periphery/adapters/http/middleware/previewProxy.ts

// AS-IS:
const target = `http://localhost:${port}`;

// TO-BE:
export function createPreviewProxy(orchestrator: PreviewOrchestratorPort) {
  return async (req, res, next) => {
    const serverKey = extractServerKey(req.path);
    
    const instance = await orchestrator.getStatus(serverKey);
    if (!instance) {
      return res.status(404).json({ error: 'Preview not found' });
    }
    
    const target = `http://${instance.host}:${instance.port}`;
    
    // Proxy to target...
  };
}
```

### 4.4 Phase 3 완료 기준

- [ ] `PreviewAgent` 구현 완료
- [ ] `RemotePreviewOrchestrator` 구현 완료
- [ ] 프록시가 원격 호스트로 연결
- [ ] `ANT_PREVIEW_MODE=remote`로 전환 가능
- [ ] 로컬 모드 여전히 정상 동작
- [ ] 원격 워커 2개에서 Preview 분산 실행 확인

---

## 5. Phase 4: Kubernetes IDE

### 5.1 목표

IDE를 Kubernetes에서 실행

### 5.2 인프라 요구사항

- Kubernetes 클러스터 (EKS, GKE, 또는 로컬 K3s)
- PersistentVolume (AWS EFS)

### 5.3 작업 목록

#### 5.3.1 Pod 템플릿

**파일 생성**:

```
src/infrastructure/ide/templates/ide-pod.yaml
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ide-{{instanceId}}
  labels:
    app: ant-ide
    ant.org: "{{tenantId}}"
    ant.user: "{{userId}}"
    ant.project: "{{projectId}}"
spec:
  containers:
  - name: openvscode
    image: {{image}}
    ports:
    - containerPort: 3000
      name: http
    args:
    - /home/.openvscode-server/bin/openvscode-server
    - --host
    - "0.0.0.0"
    - --without-connection-token
    - --server-base-path
    - /ide/{{serverKey}}
    env:
    - name: USER_ID
      value: "{{userId}}"
    - name: ORG_ID
      value: "{{tenantId}}"
    - name: PROJECT_ID
      value: "{{projectId}}"
    - name: DEFAULT_WORKSPACE
      value: /{{projectId}}
    resources:
      limits:
        memory: "2Gi"
        cpu: "2"
      requests:
        memory: "1Gi"
        cpu: "1"
    volumeMounts:
    - name: workspace
      mountPath: /{{projectId}}
    - name: ide-home
      mountPath: /home/openvscode
  volumes:
  - name: workspace
    persistentVolumeClaim:
      claimName: workspace-{{tenantId}}-{{userId}}-{{projectId}}
  - name: ide-home
    emptyDir: {}
```

#### 5.3.2 KubernetesIDEOrchestrator

**파일 생성**:

```
src/infrastructure/ide/KubernetesIDEOrchestrator.ts
```

**구현**:

```typescript
// src/infrastructure/ide/KubernetesIDEOrchestrator.ts
import * as k8s from '@kubernetes/client-node';
import * as Mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';

export class KubernetesIDEOrchestrator implements IDEOrchestratorPort {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private namespace: string;
  private podTemplate: string;
  
  constructor(namespace: string = 'ant-ide') {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.namespace = namespace;
    
    this.podTemplate = fs.readFileSync(
      path.join(__dirname, 'templates/ide-pod.yaml'),
      'utf8'
    );
  }
  
  async start(params: IDEParams): Promise<IDEInstance> {
    const instanceId = `${params.tenantId}-${params.userId}-${params.projectId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const serverKey = `${params.tenantId}:${params.userId}:${params.projectId}`;
    
    // Render pod template
    const podYaml = Mustache.render(this.podTemplate, {
      instanceId,
      tenantId: params.tenantId,
      userId: params.userId,
      projectId: params.projectId,
      serverKey,
      image: process.env.ANT_IDE_IMAGE || 'gitpod/openvscode-server:latest'
    });
    
    const pod = k8s.loadYaml(podYaml) as k8s.V1Pod;
    
    // Create pod
    await this.coreApi.createNamespacedPod(this.namespace, pod);
    
    // Wait for pod to be running
    const runningPod = await this.waitForPodRunning(instanceId);
    
    return {
      instanceId,
      host: runningPod.status!.podIP!,
      port: 3000,
      workspacePath: `/${params.projectId}`,
      status: 'running',
      url: `/ide/${serverKey}`
    };
  }
  
  private async waitForPodRunning(name: string, timeoutMs = 60000): Promise<k8s.V1Pod> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      const { body: pod } = await this.coreApi.readNamespacedPod(name, this.namespace);
      
      if (pod.status?.phase === 'Running') {
        return pod;
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    throw new Error(`Pod ${name} did not start within ${timeoutMs}ms`);
  }
  
  async stop(instanceId: string): Promise<void> {
    await this.coreApi.deleteNamespacedPod(instanceId, this.namespace);
  }
  
  async getStatus(instanceId: string): Promise<IDEInstance | null> {
    try {
      const { body: pod } = await this.coreApi.readNamespacedPod(instanceId, this.namespace);
      
      const labels = pod.metadata?.labels || {};
      const serverKey = `${labels['ant.org']}:${labels['ant.user']}:${labels['ant.project']}`;
      
      return {
        instanceId,
        host: pod.status?.podIP || '',
        port: 3000,
        workspacePath: `/${labels['ant.project']}`,
        status: pod.status?.phase === 'Running' ? 'running' : 'starting',
        url: `/ide/${serverKey}`
      };
    } catch (e: any) {
      if (e.response?.statusCode === 404) return null;
      throw e;
    }
  }
  
  async list(): Promise<IDEInstance[]> {
    const { body } = await this.coreApi.listNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'app=ant-ide'
    );
    
    return body.items.map(pod => {
      const labels = pod.metadata?.labels || {};
      const serverKey = `${labels['ant.org']}:${labels['ant.user']}:${labels['ant.project']}`;
      
      return {
        instanceId: pod.metadata!.name!,
        host: pod.status?.podIP || '',
        port: 3000,
        workspacePath: `/${labels['ant.project']}`,
        status: pod.status?.phase === 'Running' ? 'running' : 'starting',
        url: `/ide/${serverKey}`
      };
    });
  }
  
  async cleanup(): Promise<void> {
    // Delete all IDE pods
    await this.coreApi.deleteCollectionNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'app=ant-ide'
    );
  }
}
```

#### 5.3.3 Proxy 수정

```typescript
// src/periphery/adapters/http/middleware/ideProxy.ts

// AS-IS:
const target = `http://localhost:${port}`;

// TO-BE:
export function createIDEProxy(orchestrator: IDEOrchestratorPort) {
  return async (req, res, next) => {
    const serverKey = extractServerKey(req.path);
    const instanceId = serverKeyToInstanceId(serverKey);
    
    const instance = await orchestrator.getStatus(instanceId);
    if (!instance) {
      return res.status(404).json({ error: 'IDE not found' });
    }
    
    const target = `http://${instance.host}:${instance.port}`;
    
    // Proxy to target...
  };
}
```

### 5.4 Phase 4 완료 기준

- [ ] `KubernetesIDEOrchestrator` 구현 완료
- [ ] Pod 템플릿 정의 완료
- [ ] PVC 관리 로직 구현
- [ ] 프록시가 Pod IP로 연결
- [ ] `ANT_IDE_MODE=kubernetes`로 전환 가능
- [ ] 로컬 모드 (Docker) 여전히 정상 동작
- [ ] K8s에서 IDE Pod 생성/삭제 확인

---

## 6. 테스트 전략

### 6.1 Unit Tests

각 구현체별 단위 테스트:

```
tests/
├── infrastructure/
│   ├── state/
│   │   ├── InMemoryStateStore.test.ts
│   │   └── RedisStateStore.test.ts
│   ├── queue/
│   │   ├── LocalJobQueue.test.ts
│   │   └── BullMQJobQueue.test.ts
│   ├── preview/
│   │   ├── LocalPreviewOrchestrator.test.ts
│   │   └── RemotePreviewOrchestrator.test.ts
│   └── ide/
│       ├── DockerIDEOrchestrator.test.ts
│       └── KubernetesIDEOrchestrator.test.ts
```

### 6.2 Integration Tests

모드별 통합 테스트:

```
tests/integration/
├── local-mode.test.ts        # 기존 동작 검증
├── redis-mode.test.ts        # Redis 연동 검증
├── remote-preview.test.ts    # 원격 Preview Worker 검증
└── k8s-ide.test.ts           # K8s IDE 검증
```

### 6.3 E2E Tests

전체 워크플로우 테스트:

```
tests/e2e/
├── job-execution-cloud.test.ts
├── preview-cloud.test.ts
└── ide-cloud.test.ts
```

---

## 7. 배포 체크리스트

### 7.1 로컬 모드 (기존)

```bash
# 환경변수 없음 또는
ANT_SERVER_MODE=local
```

### 7.2 클라우드 모드

```bash
# 필수
ANT_SERVER_MODE=cloud
ANT_REDIS_URL=redis://redis.internal:6379

# 선택 (기본값: local 구현체)
ANT_STATE_STORE=redis           # redis | inmemory
ANT_JOB_QUEUE=bullmq            # bullmq | local
ANT_PREVIEW_MODE=remote         # remote | local
ANT_PREVIEW_WORKERS=preview-worker-1,preview-worker-2
ANT_IDE_MODE=kubernetes         # kubernetes | docker
ANT_K8S_NAMESPACE=ant-ide
```

### 7.3 Docker Compose (개발/스테이징)

```yaml
# docker-compose.cloud.yml
version: '3.8'

services:
  ant-cli:
    build: .
    environment:
      - ANT_SERVER_MODE=cloud
      - ANT_REDIS_URL=redis://redis:6379
      - ANT_STATE_STORE=redis
      - ANT_JOB_QUEUE=bullmq
      - ANT_PREVIEW_MODE=local  # 스테이징에서는 로컬
      - ANT_IDE_MODE=docker     # 스테이징에서는 Docker
    ports:
      - "4100:4100"
    depends_on:
      - redis
  
  job-worker:
    build: .
    command: ["node", "dist/workers/job-worker-entrypoint.js"]
    environment:
      - ANT_REDIS_URL=redis://redis:6379
    deploy:
      replicas: 3
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|-------|-----|-----|
| Redis 장애 | 상태 손실 | Redis Cluster + Sentinel |
| Worker 장애 | Job 실패 | BullMQ 자동 재시도 |
| Preview Worker 장애 | Preview 중단 | Health check + 재할당 |
| K8s 장애 | IDE 중단 | Pod restart policy |
| 마이그레이션 중 버그 | 서비스 중단 | Feature flag로 점진적 롤아웃 |

---

## 9. 결론

이 실행 계획은 ant-cli를 **점진적으로** 클라우드 확장 가능한 구조로 전환합니다.

**핵심 원칙**:
1. **Interface First**: 먼저 인터페이스를 정의하고, 구현체를 교체
2. **Backward Compatible**: 기존 로컬 모드 완전 유지
3. **Incremental**: 각 Phase가 독립적으로 배포 가능
4. **Feature Flagged**: 환경변수로 모드 전환

---

## 10. 구현 완료 현황

**Phase 1-4 모두 완료됨.**

| 컴포넌트 | 파일 | 설명 |
|---------|------|-----|
| StateStorePort | `core/ports/stateStore.ts` | 상태 저장 인터페이스 |
| RedisStateStore | `infrastructure/state/RedisStateStore.ts` | Redis 구현체 |
| LocalStateStore | `infrastructure/state/LocalStateStore.ts` | 로컬 구현체 |
| JobQueuePort | `core/ports/queue.ts` | Job Queue 인터페이스 |
| BullMQJobQueue | `infrastructure/queue/BullMQJobQueue.ts` | BullMQ 구현체 |
| LocalJobQueue | `infrastructure/queue/LocalJobQueue.ts` | 로컬 구현체 |
| JobWorker | `infrastructure/worker/JobWorker.ts` | 분리된 Worker 프로세스 |
| FileSystemAdapter | `periphery/adapters/filesystem/FileSystemAdapter.ts` | POSIX 파일시스템 어댑터 |
| WorkspaceResolver | `infrastructure/workspace/WorkspaceResolver.ts` | 경로 계산 유틸리티 |

**테스트 방법**:
```bash
# 단일 머신 클라우드 모드
export ANT_SERVER_MODE=cloud
export ANT_REDIS_URL=redis://localhost:6379
export ANT_WORKSPACE_BASE_PATH=/path/to/ant-workspaces

npm run dev:server   # API Server
npm run dev:worker   # Job Worker
```

**다음 단계** (배포):
1. AWS EFS 생성 및 EKS 마운트
2. Redis ElastiCache 설정
3. 프로덕션 배포
