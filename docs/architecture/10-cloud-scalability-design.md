# Cloud Scalability Architecture Design

> ant-cli를 클라우드 서비스로 확장하기 위한 아키텍처 설계 문서

## 1. Executive Summary

### 1.1 현재 상태

현재 ant-cli는 **단일 머신 모노리스** 구조로, 클라우드 확장이 불가능합니다:

| 컴포넌트 | 현재 상태 | 확장성 문제 |
|---------|----------|-----------|
| **API Server** | 단일 Express 인스턴스 | 수평 확장 불가 |
| **Job 실행** | 로컬 child process spawn | CPU/Memory 제한 없음, 단일 머신 |
| **Preview** | 로컬 npm 프로세스 spawn | 단일 머신, localhost 전용 |
| **IDE** | 로컬 Docker 컨테이너 | 단일 머신, Docker 의존성 |
| **상태 저장** | In-memory (Map, Set) | 서버 재시작 시 손실, 공유 불가 |

### 1.2 목표 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Load Balancer                                   │
│                         (nginx, AWS ALB, etc.)                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
    ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
    │  ant-cli #1   │      │  ant-cli #2   │      │  ant-cli #N   │
    │  (Stateless)  │      │  (Stateless)  │      │  (Stateless)  │
    └───────┬───────┘      └───────┬───────┘      └───────┬───────┘
            │                      │                      │
            └──────────────────────┼──────────────────────┘
                                   │
    ┌──────────────────────────────┼──────────────────────────────────────────┐
    │                      Shared Infrastructure                               │
    ├─────────────────────┬────────┴───────┬──────────────────────────────────┤
    │                     │                │                                   │
    ▼                     ▼                ▼                                   │
┌─────────────┐    ┌─────────────┐   ┌─────────────┐                          │
│   Redis     │    │  Job Queue  │   │  Workspace  │                          │
│ (State/Pub) │    │ (Bull/BullMQ)│   │  Storage    │                          │
└─────────────┘    └──────┬──────┘   │  (EFS)      │                          │
                          │          └─────────────┘                          │
                          │                                                    │
    ┌─────────────────────┼───────────────────────────────────────────────────┤
    │                     │         External Workers                           │
    ├─────────────────────┼───────────────────────────────────────────────────┤
    │                     ▼                                                    │
    │  ┌──────────────────────────────────────────────────────────────────┐   │
    │  │                       Job Worker Pool                             │   │
    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐              │   │
    │  │  │ Job     │  │ Job     │  │ Job     │  │ Job     │              │   │
    │  │  │Worker #1│  │Worker #2│  │Worker #3│  │Worker #N│              │   │
    │  │  │(2C/4GB) │  │(2C/4GB) │  │(4C/8GB) │  │(4C/8GB) │              │   │
    │  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘              │   │
    │  └──────────────────────────────────────────────────────────────────┘   │
    │                                                                          │
    │  ┌──────────────────────────────────────────────────────────────────┐   │
    │  │                     Preview Worker Pool                           │   │
    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                           │   │
    │  │  │ Preview │  │ Preview │  │ Preview │                           │   │
    │  │  │Worker #1│  │Worker #2│  │Worker #N│                           │   │
    │  │  │:30001-  │  │:30001-  │  │:30001-  │                           │   │
    │  │  │ 39999   │  │ 39999   │  │ 39999   │                           │   │
    │  │  └─────────┘  └─────────┘  └─────────┘                           │   │
    │  └──────────────────────────────────────────────────────────────────┘   │
    │                                                                          │
    │  ┌──────────────────────────────────────────────────────────────────┐   │
    │  │                       IDE Pool (K8s)                              │   │
    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                           │   │
    │  │  │IDE Pod 1│  │IDE Pod 2│  │IDE Pod N│                           │   │
    │  │  │(2C/2GB) │  │(2C/2GB) │  │(2C/2GB) │                           │   │
    │  │  └─────────┘  └─────────┘  └─────────┘                           │   │
    │  └──────────────────────────────────────────────────────────────────┘   │
    │                                                                          │
    └──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 현재 구조 상세 분석

### 2.1 ExpressServerAdapter (API Server)

**위치**: `periphery/adapters/http/express/ExpressServerAdapter.ts`

```typescript
// 현재: 모든 상태가 인메모리
export class ExpressServerAdapter {
  private stateTracker: JobStateTracker;     // In-memory job state
  private jobManager: JobExecutionManager;   // Local process spawn
  private deps: ServerDependencies;          // Contains in-memory PortRegistry
}
```

**문제점**:
1. `JobStateTracker`가 인메모리 Map 사용 → 서버 간 공유 불가
2. `JobExecutionManager`가 로컬 spawn → 다른 머신에서 실행 불가
3. 서버 재시작 시 모든 상태 손실

### 2.2 JobExecutionManager (Job 실행)

**위치**: `periphery/adapters/http/express/managers/JobExecutionManager.ts`

```typescript
// 현재: 로컬 child process spawn
private async spawnChildProcess(jobId, params, args): Promise<ChildProcess> {
  return spawn('npx', ['tsx', ...args], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
}
```

**문제점**:
1. `spawn()`은 로컬 머신에서만 실행
2. CPU/Memory 제한 없음 (문서에도 "향후 개선"으로 표시)
3. Job 큐 없음 → 동시 실행 제어 불가
4. 실패 시 자동 재시도 없음

### 2.3 DevServerService (Preview)

**위치**: `periphery/adapters/http/services/DevServerService/DevServerService.ts`

```typescript
// 현재: 로컬 npm 프로세스 spawn
private async spawnDevProcess(pkg, port, serverKey, extraEnv): Promise<ChildProcess> {
  const childProcess = spawn(command, args, {
    cwd: pkg.path,
    shell: true,
    env,
    stdio: 'pipe'
  });
  return childProcess;
}
```

**문제점**:
1. 로컬에서만 preview server 실행
2. `localhost:PORT`로만 접근 가능
3. 다중 사용자 시 리소스 경쟁

### 2.4 IDEService (Cloud IDE)

**위치**: `periphery/adapters/ide/IDEService.ts`

```typescript
// 현재: 로컬 Docker API 사용
export class IDEService {
  private docker: Docker;  // dockerode - 로컬 Docker daemon만 지원
  
  async startIDE(...) {
    const container = await this.docker.createContainer({...});
    await container.start();
  }
}
```

**문제점**:
1. 로컬 Docker daemon만 지원
2. Kubernetes, Docker Swarm 미지원
3. 컨테이너가 단일 머신에 고정

### 2.5 InMemoryPortRegistry (상태 저장)

**위치**: `infrastructure/networking/InMemoryPortRegistry.ts`

```typescript
// 현재: 인메모리 Map
export class InMemoryPortRegistry implements PortRegistryPort {
  private devServers = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();
}
```

**문제점**:
1. 서버 재시작 시 데이터 손실
2. 다중 서버 인스턴스 간 공유 불가
3. 문서에도 "Limitations" 명시됨

---

## 3. 리팩토링 설계

### 3.1 핵심 원칙

| 원칙 | 설명 |
|-----|------|
| **관심사 분리** | API Gateway / Job Orchestration / Dev Server / IDE를 독립 컴포넌트로 분리 |
| **Stateless API** | 모든 상태를 외부 저장소 (Redis)로 분리 |
| **플러그인 아키텍처** | 로컬/클라우드 구현을 인터페이스 뒤에 숨김 |
| **점진적 마이그레이션** | 기존 로컬 모드를 유지하면서 클라우드 모드 추가 |
| **단일 진입점** | 프록시는 ant-cli에서 유지, 백엔드 서비스만 분산 |

### 3.2 컴포넌트별 설계

#### 3.2.1 API Server (Stateless)

**변경**: 상태를 외부로 분리

```typescript
// AS-IS: In-memory state
export class ExpressServerAdapter {
  private stateTracker: JobStateTracker;  // new Map()
}

// TO-BE: External state store
export class ExpressServerAdapter {
  private stateStore: StateStorePort;  // Redis 또는 InMemory
}

// Port Interface
export interface StateStorePort {
  // Job State
  setJobStatus(jobId: string, status: JobStatus): Promise<void>;
  getJobStatus(jobId: string): Promise<JobStatus | null>;
  
  // Port Registry (기존 PortRegistryPort 확장)
  registerDevServer(...): Promise<void>;
  registerIDE(...): Promise<void>;
  
  // Pub/Sub for real-time updates
  subscribe(channel: string, callback: (message: any) => void): Promise<void>;
  publish(channel: string, message: any): Promise<void>;
}
```

**구현체**:
- `InMemoryStateStore`: 로컬 개발용 (현재 동작 유지)
- `RedisStateStore`: 클라우드용 (새로 추가)

#### 3.2.2 Job Execution (Queue + Workers)

**변경**: 로컬 spawn → Job Queue + External Workers

```
AS-IS:
┌─────────────┐     spawn()      ┌─────────────┐
│  ant-cli    │ ───────────────▶ │ Child Proc  │
│             │                  │ (same host) │
└─────────────┘                  └─────────────┘

TO-BE:
┌─────────────┐   enqueue()    ┌─────────────┐   dequeue()   ┌─────────────┐
│  ant-cli    │ ─────────────▶ │  Job Queue  │ ────────────▶ │   Worker    │
│ (API only)  │                │  (Redis)    │               │ (any host)  │
└─────────────┘                └─────────────┘               └─────────────┘
                                     │                              │
                                     │◀─────────── status updates ──┘
```

**새로운 인터페이스**:

```typescript
// Job Queue Port
export interface JobQueuePort {
  enqueue(job: JobPayload): Promise<string>;  // Returns job ID
  getStatus(jobId: string): Promise<JobQueueStatus>;
  cancel(jobId: string): Promise<void>;
  onProgress(jobId: string, callback: (progress: JobProgress) => void): void;
}

// Job Payload
export interface JobPayload {
  jobId: string;
  type: 'code' | 'design' | 'learn';
  agent: string;
  projectId: string;
  feature: string;
  userContext: UserContext;
  workspacePath: string;  // EFS path (or local path for dev)
  overrideDirective?: string;
}

// Worker Interface (별도 프로세스로 실행)
export interface JobWorker {
  processJob(payload: JobPayload): Promise<JobResult>;
}
```

**구현체**:
- `LocalJobQueue`: 현재 동작 유지 (직접 spawn)
- `BullMQJobQueue`: 클라우드용 (Redis 기반 큐)

#### 3.2.3 Preview Orchestration

**변경**: 로컬 spawn → Remote Orchestration

```
AS-IS:
┌─────────────┐                    ┌─────────────┐
│  ant-cli    │──spawn()──────────▶│ npm run dev │
│   Proxy     │◀──localhost:PORT───│ (same host) │
└─────────────┘                    └─────────────┘

TO-BE:
┌─────────────┐                    ┌─────────────────────┐
│  ant-cli    │──createPreview()──▶│  Preview Worker #N  │
│   Proxy     │◀──remoteHost:PORT──│  (different host)   │
└─────────────┘                    └─────────────────────┘
```

**새로운 인터페이스**:

```typescript
// Preview Orchestrator Port
export interface PreviewOrchestratorPort {
  start(params: PreviewParams): Promise<PreviewInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<PreviewStatus>;
  getLogs(instanceId: string): Promise<LogEntry[]>;
}

// Preview Instance (로컬 또는 원격)
export interface PreviewInstance {
  instanceId: string;
  host: string;      // 'localhost' or 'preview-worker-1.internal'
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
```

**구현체**:
- `LocalPreviewOrchestrator`: 현재 DevServerService 래핑 (로컬 spawn)
- `RemotePreviewOrchestrator`: Agent 기반 원격 워커 관리

**프록시 변경**:

```typescript
// AS-IS: localhost only
const target = `http://localhost:${port}`;

// TO-BE: host from instance
const target = `http://${instance.host}:${instance.port}`;
```

#### 3.2.4 IDE Orchestration

**변경**: Local Docker → Kubernetes/Remote Docker

```
AS-IS:
┌─────────────┐                    ┌─────────────────────┐
│  ant-cli    │──docker.create()──▶│  Docker Container   │
│   Proxy     │◀──localhost:PORT───│  (same host)        │
└─────────────┘                    └─────────────────────┘

TO-BE:
┌─────────────┐                    ┌─────────────────────┐
│  ant-cli    │──createPod()──────▶│  K8s Pod            │
│   Proxy     │◀──podIP:PORT───────│  (any node)         │
└─────────────┘                    └─────────────────────┘
```

**새로운 인터페이스**:

```typescript
// IDE Orchestrator Port
export interface IDEOrchestratorPort {
  start(params: IDEParams): Promise<IDEInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<IDEStatus>;
}

// IDE Instance (로컬 또는 K8s)
export interface IDEInstance {
  instanceId: string;
  host: string;      // 'localhost' or 'ide-pod-xxx.default.svc'
  port: number;
  workspacePath: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
```

**구현체**:
- `DockerIDEOrchestrator`: 현재 IDEService 래핑 (로컬 Docker)
- `KubernetesIDEOrchestrator`: K8s API로 Pod 생성

---

## 4. 상세 설계

### 4.1 StateStore (Redis)

**파일 구조**:

```
src/infrastructure/state/
├── StateStorePort.ts           # Interface
├── InMemoryStateStore.ts       # 로컬용 (기존 로직 통합)
├── RedisStateStore.ts          # 클라우드용
└── index.ts
```

**Redis 스키마**:

```
# Job Status
job:{jobId}:status     → JSON { status, projectId, featureName, workspacePath, projectPath, featurePath, ... }
job:{jobId}:logs       → List of log entries

# Port Registry
devserver:{serverKey}  → JSON { host, port, registeredAt, ... }
ide:{serverKey}        → JSON { host, port, registeredAt, ... }

# Pub/Sub Channels
job:{jobId}:progress   → Progress updates
devserver:{serverKey}:logs → Dev server log stream
```

**Workspace 구조** (실제 구현):

```
<ANT_WORKSPACE_BASE_PATH>/               # 예: /mnt/efs/workspaces
└── <organizationId>/                    # 예: to.nexus
    └── <userId>/                        # 예: probe
        └── <projectId>/                 # 예: my-app
            ├── config.json              # 프로젝트 설정
            ├── codebase/                # Git 저장소 (clone)
            │   ├── src/
            │   ├── package.json
            │   └── ...
            └── features/                # Feature별 작업 공간
                └── <featureId>/         # 예: skeleton, main
                    ├── inputs/          # 입력 파일
                    │   ├── directives/  # 작업 지시
                    │   │   ├── code/directive.md
                    │   │   └── design/directive.md
                    │   ├── sources/     # PRD, 토큰 등
                    │   │   └── prd.md
                    │   └── assets/      # 이미지 등
                    ├── outputs/         # 출력 파일
                    │   ├── design/
                    │   └── evals/
                    └── sessions/        # 세션 상태
                        ├── code.json
                        └── design.json
```

> ⚠️ **주의**: tenantId 형식은 `organizationId:userId`이며, 파일시스템 경로에서는 `organizationId/userId`로 변환됩니다.

### 4.2 Job Queue (BullMQ)

**파일 구조**:

```
src/infrastructure/queue/
├── JobQueuePort.ts             # Interface
├── LocalJobQueue.ts            # 현재 동작 (직접 spawn)
├── BullMQJobQueue.ts           # Redis 기반 큐
└── index.ts

src/workers/
├── job-worker.ts               # Standalone worker process
└── worker-entrypoint.ts        # Worker 시작점
```

**Worker 프로세스**:

```typescript
// src/workers/job-worker.ts
import { Worker } from 'bullmq';

const worker = new Worker('ant-jobs', async (job) => {
  const { type, agent, workspacePath, ... } = job.data;
  
  // Execute ant-cli command
  const result = await executeAntJob(job.data);
  
  return result;
}, {
  connection: redisConnection,
  limiter: {
    max: 2,              // 동시 2개 job
    duration: 1000
  }
});
```

**리소스 제한**:

```yaml
# docker-compose.worker.yml
services:
  ant-worker:
    image: ant-cli:latest
    command: ["node", "dist/workers/worker-entrypoint.js"]
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### 4.3 Preview Orchestration

**파일 구조**:

```
src/infrastructure/preview/
├── PreviewOrchestratorPort.ts        # Interface
├── LocalPreviewOrchestrator.ts       # 현재 DevServerService 래핑
├── RemotePreviewOrchestrator.ts      # Agent 기반
├── PreviewAgent.ts                   # 원격 워커에서 실행되는 에이전트
└── index.ts
```

**원격 워커 아키텍처**:

```
┌─────────────────┐         ┌─────────────────────────────────┐
│    ant-cli      │         │        Preview Worker           │
│                 │   HTTP  │                                 │
│ RemoteOrchest.  │◀───────▶│  PreviewAgent (HTTP)            │
│                 │         │    └─ spawn npm/vite processes  │
│    Proxy        │─────────│─── localhost:30001-39999        │
└─────────────────┘   HTTP  └─────────────────────────────────┘
```

**Agent Protocol**:

```typescript
// PreviewAgent API (각 워커에서 실행)
interface PreviewAgentAPI {
  // HTTP
  StartPreview(req: StartPreviewRequest): StartPreviewResponse;
  StopPreview(req: StopPreviewRequest): StopPreviewResponse;
  GetStatus(req: GetStatusRequest): GetStatusResponse;
  StreamLogs(req: StreamLogsRequest): stream LogEntry;
}
```

### 4.4 IDE Orchestration (Kubernetes)

**파일 구조**:

```
src/infrastructure/ide/
├── IDEOrchestratorPort.ts            # Interface
├── DockerIDEOrchestrator.ts          # 현재 IDEService 래핑
├── KubernetesIDEOrchestrator.ts      # K8s API 사용
└── index.ts
```

**Kubernetes Pod Template**:

```yaml
# templates/ide-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: ide-{tenantId}-{userId}-{projectId}
  labels:
    app: ant-ide
    ant.org: "{tenantId}"
    ant.user: "{userId}"
    ant.project: "{projectId}"
spec:
  containers:
  - name: openvscode
    image: gitpod/openvscode-server:latest
    ports:
    - containerPort: 3000
    resources:
      limits:
        memory: "2Gi"
        cpu: "2"
      requests:
        memory: "1Gi"
        cpu: "1"
    volumeMounts:
    - name: workspace
      mountPath: /{projectId}
  volumes:
  - name: workspace
    persistentVolumeClaim:
      claimName: workspace-{tenantId}-{userId}-{projectId}
```

---

## 5. 마이그레이션 전략

### 5.1 Phase 1: Interface 추출

**목표**: 기존 로직을 인터페이스 뒤로 숨기고, 로컬 구현체로 래핑

```
현재:
ExpressServerAdapter → JobStateTracker (직접 사용)

Phase 1 후:
ExpressServerAdapter → StateStorePort → InMemoryStateStore (래핑)
```

**작업**:
1. `StateStorePort` 인터페이스 정의
2. 기존 `JobStateTracker`, `InMemoryPortRegistry` → `InMemoryStateStore`로 통합
3. 기존 `DevServerService` → `LocalDevServerOrchestrator`로 래핑
4. 기존 `IDEService` → `DockerIDEOrchestrator`로 래핑
5. `LocalJobQueue` 생성 (기존 spawn 로직 래핑)

### 5.2 Phase 2: Redis 구현

**목표**: Redis 기반 상태 저장소 및 Job Queue 구현

**작업**:
1. `RedisStateStore` 구현
2. `BullMQJobQueue` 구현
3. Worker 프로세스 분리 (`src/workers/`)
4. 환경변수로 모드 전환: `ANT_STATE_STORE=redis`, `ANT_JOB_QUEUE=bullmq`

### 5.3 Phase 3: Remote Preview

**목표**: Preview를 원격 워커에서 실행

**작업**:
1. `DevServerAgent` 구현 (각 노드에서 실행)
2. `RemoteDevServerOrchestrator` 구현
3. 프록시 변경 (`localhost` → `remoteHost`)
4. 노드 풀 관리 (간단한 라운드로빈 또는 리소스 기반)

### 5.4 Phase 4: Kubernetes IDE

**목표**: IDE를 Kubernetes에서 실행

**작업**:
1. `KubernetesIDEOrchestrator` 구현
2. Pod 템플릿 정의
3. PVC 관리 (workspace 볼륨)
4. 프록시 변경 (`localhost` → `podIP/serviceName`)

---

## 6. 환경 설정

### 6.1 모드 전환

```bash
# Local Mode (현재 동작)
ANT_SERVER_MODE=local

# Cloud Mode
ANT_SERVER_MODE=cloud
ANT_STATE_STORE=redis
ANT_REDIS_URL=redis://redis.internal:6379
ANT_JOB_QUEUE=bullmq
ANT_PREVIEW_MODE=remote
ANT_PREVIEW_WORKERS=preview-worker-1.internal,preview-worker-2.internal
ANT_IDE_MODE=kubernetes
ANT_K8S_NAMESPACE=ant-ide
```

### 6.2 Factory Pattern

```typescript
// src/infrastructure/adapters/AdapterFactory.ts
export class AdapterFactory {
  static createStateStore(): StateStorePort {
    if (process.env.ANT_STATE_STORE === 'redis') {
      return new RedisStateStore(process.env.ANT_REDIS_URL);
    }
    return new InMemoryStateStore();
  }
  
  static createJobQueue(): JobQueuePort {
    if (process.env.ANT_JOB_QUEUE === 'bullmq') {
      return new BullMQJobQueue(process.env.ANT_REDIS_URL);
    }
    return new LocalJobQueue();
  }
  
  static createPreviewOrchestrator(): PreviewOrchestratorPort {
    if (process.env.ANT_PREVIEW_MODE === 'remote') {
      const workers = (process.env.ANT_PREVIEW_WORKERS || '').split(',');
      return new RemotePreviewOrchestrator(workers);
    }
    return new LocalPreviewOrchestrator();
  }
  
  static createIDEOrchestrator(): IDEOrchestratorPort {
    if (process.env.ANT_IDE_MODE === 'kubernetes') {
      return new KubernetesIDEOrchestrator(process.env.ANT_K8S_NAMESPACE);
    }
    return new DockerIDEOrchestrator();
  }
}
```

---

## 7. 파일 구조 (최종)

```
src/
├── core/
│   └── ports/
│       ├── stateStore.ts           # 🆕 StateStorePort
│       ├── jobQueue.ts             # 🆕 JobQueuePort
│       ├── previewOrchestrator.ts  # 🆕 PreviewOrchestratorPort
│       ├── ideOrchestrator.ts      # 🆕 IDEOrchestratorPort
│       └── portRegistry.ts         # (기존, StateStorePort로 통합 가능)
│
├── infrastructure/
│   ├── state/                      # 🆕 State Store
│   │   ├── StateStorePort.ts
│   │   ├── InMemoryStateStore.ts
│   │   └── RedisStateStore.ts
│   │
│   ├── queue/                      # 🆕 Job Queue
│   │   ├── JobQueuePort.ts
│   │   ├── LocalJobQueue.ts
│   │   └── BullMQJobQueue.ts
│   │
│   ├── preview/                    # 🆕 Preview Orchestration
│   │   ├── PreviewOrchestratorPort.ts
│   │   ├── LocalPreviewOrchestrator.ts
│   │   └── RemotePreviewOrchestrator.ts
│   │
│   ├── ide/                        # 🆕 IDE Orchestration
│   │   ├── IDEOrchestratorPort.ts
│   │   ├── DockerIDEOrchestrator.ts
│   │   └── KubernetesIDEOrchestrator.ts
│   │
│   └── adapters/
│       └── AdapterFactory.ts       # 🆕 Factory for all adapters
│
├── workers/                        # 🆕 Standalone Workers
│   ├── job-worker.ts
│   └── worker-entrypoint.ts
│
└── periphery/
    └── adapters/
        └── http/
            ├── express/
            │   └── ExpressServerAdapter.ts  # 수정: 인터페이스 사용
            ├── services/
            │   └── PreviewService/          # 수정: Orchestrator로 위임
            └── middleware/
                ├── previewProxy.ts          # 수정: host 동적 처리
                └── ideProxy.ts              # 수정: host 동적 처리
```

---

## 8. 리소스 요구사항

### 8.1 클라우드 인프라

| 컴포넌트 | 권장 스펙 | 수량 | 비고 |
|---------|---------|-----|-----|
| **ant-cli API** | 2 CPU, 2GB RAM | 2+ | 로드밸런서 뒤 |
| **Redis** | 2 CPU, 4GB RAM | 1 (HA: 3) | State + Queue |
| **Job Worker** | 2-4 CPU, 4-8GB RAM | 2+ | Auto-scale |
| **Preview Worker** | 4 CPU, 8GB RAM | 2+ | 포트 범위 제한 |
| **IDE (K8s)** | 2 CPU, 2GB RAM per pod | Dynamic | Pod 당 1 사용자 |
| **Workspace Storage** | 100GB+ | 1 | AWS EFS (공유 스토리지) |

### 8.2 Workspace Storage (✅ 구현 완료)

**핵심 원칙**: Local과 EFS 모두 POSIX 호환이므로 **동일한 `FileSystemAdapter`** 사용.

**환경 변수** (단 하나만 필요):
```bash
ANT_WORKSPACE_BASE_PATH=/path/to/workspaces
```

| 환경 | 설정 예시 |
|-----|----------|
| 로컬 개발 | `ANT_WORKSPACE_BASE_PATH=/Users/dev/ant-workspaces` |
| 단일 머신 클라우드 테스트 | 로컬과 동일 (같은 머신이므로) |
| 분산 클라우드 (EFS) | `ANT_WORKSPACE_BASE_PATH=/mnt/efs/workspaces` |

**경로 계산 원칙** (개별 구현 금지):
```typescript
// ✅ 반드시 WorkspaceResolver 사용
const resolver = new CloudWorkspaceResolver(workspaceBase);
const featurePath = resolver.getFeaturePath(userContext, projectId, feature);

// ❌ 개별 path.join 금지
const featurePath = path.join(base, org, user, project, 'features', feature);
```

**AWS EFS 마운트 (K8s)**:
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ant-workspaces
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: efs-sc
  resources:
    requests:
      storage: 100Gi
```

### 8.3 비용 예측 (AWS 기준)

| 컴포넌트 | 인스턴스 타입 | 월 비용 (예상) |
|---------|-------------|--------------|
| API Server x2 | t3.medium | ~$60 |
| Redis (ElastiCache) | cache.t3.medium | ~$50 |
| Job Worker x2 | c5.large | ~$130 |
| Preview Worker x2 | c5.xlarge | ~$270 |
| EKS (IDE) | m5.large x3 | ~$200 |
| EFS (Storage) | 100GB | ~$30 |
| **Total** | | **~$740/월** |

---

## 9. 보안 고려사항

### 9.1 네트워크 격리

```
┌─────────────────────────────────────────────────────────────┐
│                      Public Subnet                           │
│   ┌─────────────┐                                           │
│   │ Load Balancer│                                          │
│   └──────┬──────┘                                           │
└──────────┼──────────────────────────────────────────────────┘
           │
┌──────────┼──────────────────────────────────────────────────┐
│          │          Private Subnet                           │
│   ┌──────▼──────┐   ┌─────────┐   ┌─────────┐              │
│   │  ant-cli    │───│  Redis  │───│ Workers │              │
│   └─────────────┘   └─────────┘   └─────────┘              │
│                                                              │
│   ┌─────────────┐   ┌─────────────┐                         │
│   │ Dev Nodes   │   │  K8s (IDE)  │                         │
│   └─────────────┘   └─────────────┘                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 9.2 인증/권한

- API → Worker: Job 데이터에 `userContext` 포함, Worker가 검증
- API → Dev Node: mTLS 또는 API Key
- API → K8s: ServiceAccount + RBAC

### 9.3 데이터 격리

- Workspace Storage: 테넌트별 디렉토리 분리 (현재와 동일)
- Redis: Key prefix로 테넌트 분리
- K8s: Namespace 또는 Label로 Pod 격리

---

## 10. 모니터링

### 10.1 메트릭

| 메트릭 | 수집 방법 | 알림 조건 |
|-------|---------|---------|
| Job Queue Length | BullMQ metrics | > 100 |
| Worker CPU/Memory | Container metrics | > 80% |
| Dev Server Count | Custom metrics | > capacity |
| IDE Pod Count | K8s metrics | > node capacity |
| API Response Time | Express middleware | p99 > 2s |

### 10.2 로깅

```
[API] → CloudWatch/Loki
[Worker] → CloudWatch/Loki
[Dev Server Agent] → CloudWatch/Loki
[IDE Pod] → K8s logs → CloudWatch/Loki
```

---

## 11. 결론

이 설계는 현재 ant-cli의 단일 머신 구조를 **점진적으로** 클라우드 확장 가능한 구조로 전환합니다.

**핵심 변경**:
1. **상태 외부화**: InMemory → Redis (공유 상태)
2. **Job 분리**: Local spawn → Queue + Job Worker (수평 확장)
3. **Preview 분리**: Local spawn → Preview Worker (리소스 분산)
4. **IDE 분리**: Local Docker → Kubernetes (탄력적 스케일)

**보존**:
- 기존 로컬 모드 완전 유지
- 인터페이스 기반 설계로 구현체 교체 가능
- 환경변수로 모드 전환

---

## 12. 구현 현황

| 항목 | 상태 | 비고 |
|-----|------|-----|
| **StateStorePort** | ✅ 완료 | `RedisStateStore`, `LocalStateStore` |
| **JobQueuePort** | ✅ 완료 | `BullMQJobQueue`, `LocalJobQueue` |
| **JobWorker** | ✅ 완료 | 분리된 Worker 프로세스 |
| **FileSystemAdapter** | ✅ 완료 | POSIX 호환 (Local/EFS) |
| **WorkspaceResolver** | ✅ 완료 | 경로 계산 중앙집중화 |
| **PreviewOrchestrator** | ✅ 완료 | `LocalPreviewOrchestrator`, `RemotePreviewOrchestrator` |
| **IDEOrchestrator** | ✅ 완료 | `LocalIDEOrchestrator`, `KubernetesIDEOrchestrator` |

**현재 테스트 가능 환경**:
```bash
# 단일 머신 클라우드 모드 테스트
export ANT_SERVER_MODE=cloud
export ANT_REDIS_URL=redis://localhost:6379
export ANT_WORKSPACE_BASE_PATH=/path/to/ant-workspaces

npm run dev:server   # API Server
npm run dev:worker   # Job Worker (별도 터미널)
```
