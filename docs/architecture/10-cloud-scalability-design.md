# Cloud Scalability Architecture Design

> Architecture design document for scaling ant-cli to cloud service

## 1. Executive Summary

### 1.1 Previous State (Before Refactoring)

Previously, ant-cli was a **single-machine monolith** that couldn't scale to cloud:

| Component | Previous State | Scalability Issue |
|---------|----------|-----------|
| **API Server** | Single Express instance | No horizontal scaling |
| **Job Execution** | Local child process spawn | No CPU/Memory limits, single machine |
| **Preview** | Local npm process spawn | Single machine, localhost only |
| **IDE** | Local Docker container | Single machine, Docker dependency |
| **State Storage** | In-memory (Map, Set) | Lost on restart, not shareable |

### 1.2 Current Architecture (After Refactoring)

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

## 2. Previous Structure Analysis (Historical)

### 2.1 ExpressServerAdapter (API Server)

**Location**: `periphery/adapters/http/express/ExpressServerAdapter.ts`

```typescript
// Previous: All state in-memory
export class ExpressServerAdapter {
  private stateTracker: JobStateTracker;     // In-memory job state
  private jobManager: JobExecutionManager;   // Local process spawn
  private deps: ServerDependencies;          // Contains in-memory PortRegistry
}
```

**Issues (now resolved)**:
1. `JobStateTracker` used in-memory Map → not shareable across servers
2. `JobExecutionManager` used local spawn → couldn't run on other machines
3. All state lost on server restart

### 2.2 JobExecutionManager (Job Execution)

**Location**: `periphery/adapters/http/express/managers/JobExecutionManager.ts`

```typescript
// Previous: Local child process spawn
private async spawnChildProcess(jobId, params, args): Promise<ChildProcess> {
  return spawn('npx', ['tsx', ...args], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
}
```

**Issues (now resolved)**:
1. `spawn()` only executed on local machine
2. No CPU/Memory limits
3. No job queue → no concurrency control
4. No automatic retry on failure

### 2.3 DevServerService (Preview)

**Location**: `periphery/adapters/http/services/DevServerService/DevServerService.ts`

```typescript
// Previous: Local npm process spawn
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

**Issues (now resolved)**:
1. Preview server only ran locally
2. Only accessible via `localhost:PORT`
3. Resource contention with multiple users

### 2.4 IDEService (Cloud IDE)

**Location**: `periphery/adapters/ide/IDEService.ts`

```typescript
// Previous: Local Docker API
export class IDEService {
  private docker: Docker;  // dockerode - local Docker daemon only
  
  async startIDE(...) {
    const container = await this.docker.createContainer({...});
    await container.start();
  }
}
```

**Issues (now resolved)**:
1. Only supported local Docker daemon
2. No Kubernetes, Docker Swarm support
3. Container fixed to single machine

### 2.5 Port Registry (State Storage) - RESOLVED

**Previous**: `InMemoryPortRegistry` (now deleted)

**Current**: `RedisStateStore` implements both `StateStorePort` and `PortRegistryPort`

```typescript
// Current: Redis-based storage
export class RedisStateStore implements StateStorePort, PortRegistryPort {
  // All state stored in Redis - persistent and shareable
}
```

**Resolution**:
1. ✅ Data persists across server restarts
2. ✅ Shared across multiple server instances
3. ✅ Single implementation for all environments

---

## 3. Architecture Design

### 3.1 Core Principles

| Principle | Description |
|-----|------|
| **Separation of Concerns** | API Gateway / Job Orchestration / Preview / IDE as independent components |
| **Stateless API** | All state externalized to Redis |
| **Unified Architecture** | Same infrastructure for local and cloud (only auth differs) |
| **Single Entry Point** | Proxy remains in ant-cli, only backend services are distributed |
| **Required Infrastructure** | Redis and Preview Worker are mandatory for all environments |

### 3.2 Component Design

#### 3.2.1 API Server (Stateless)

**Change**: Externalize state

```typescript
// AS-IS: In-memory state
export class ExpressServerAdapter {
  private stateTracker: JobStateTracker;  // new Map()
}

// TO-BE: External state store
export class ExpressServerAdapter {
  private stateStore: StateStorePort;  // Redis (required)
}

// Port Interface
export interface StateStorePort {
  // Job State
  setJobStatus(jobId: string, status: JobStatus): Promise<void>;
  getJobStatus(jobId: string): Promise<JobStatus | null>;
  
  // Port Registry (extends PortRegistryPort)
  registerDevServer(...): Promise<void>;
  registerIDE(...): Promise<void>;
  
  // Pub/Sub for real-time updates
  subscribe(channel: string, callback: (message: any) => void): Promise<void>;
  publish(channel: string, message: any): Promise<void>;
}
```

**Implementation**:
- `RedisStateStore`: Single implementation for all environments (required)

#### 3.2.2 Job Execution (Queue + Workers)

**Change**: Local spawn → Job Queue + External Workers

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

**Interface**:

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

// Worker Interface (runs as separate process)
export interface JobWorker {
  processJob(payload: JobPayload): Promise<JobResult>;
}
```

**Implementation**:
- `BullMQJobQueue`: Single implementation for all environments (Redis-based queue, required)

#### 3.2.3 Preview Orchestration

**Change**: Local spawn → Remote Orchestration

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

**Interface**:

```typescript
// Preview Orchestrator Port
export interface PreviewOrchestratorPort {
  start(params: PreviewParams): Promise<PreviewInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<PreviewStatus>;
  getLogs(instanceId: string): Promise<LogEntry[]>;
}

// Preview Instance (local or remote)
export interface PreviewInstance {
  instanceId: string;
  host: string;      // 'localhost' or 'preview-worker-1.internal'
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
```

**Implementation**:
- `RemotePreviewOrchestrator`: Single implementation for all environments (worker-based, required)

**Proxy change**:

```typescript
// AS-IS: localhost only
const target = `http://localhost:${port}`;

// TO-BE: host from instance
const target = `http://${instance.host}:${instance.port}`;
```

#### 3.2.4 IDE Orchestration

**Change**: Local Docker → Kubernetes/Remote Docker

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

**Interface**:

```typescript
// IDE Orchestrator Port
export interface IDEOrchestratorPort {
  start(params: IDEParams): Promise<IDEInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<IDEStatus>;
}

// IDE Instance (local or K8s)
export interface IDEInstance {
  instanceId: string;
  host: string;      // 'localhost' or 'ide-pod-xxx.default.svc'
  port: number;
  workspacePath: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
```

**Implementation**:
- `LocalIDEOrchestrator`: Docker-based (default when ANT_K8S_NAMESPACE not set)
- `KubernetesIDEOrchestrator`: K8s-based (when ANT_K8S_NAMESPACE is set)

---

## 4. Detailed Design

### 4.1 StateStore (Redis)

**File structure**:

```
src/infrastructure/state/
├── index.ts
└── RedisStateStore.ts          # Single implementation (required)
```

**Redis schema**:

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

**Workspace structure** (current implementation):

```
<ANT_WORKSPACE_BASE_PATH>/               # e.g., /mnt/efs/workspaces
└── <organizationId>/                    # e.g., to.nexus
    └── <userId>/                        # e.g., probe
        └── <projectId>/                 # e.g., my-app
            ├── config.json              # Project config
            ├── codebase/                # Git repository (clone)
            │   ├── src/
            │   ├── package.json
            │   └── ...
            └── features/                # Feature workspaces
                └── <featureId>/         # e.g., skeleton, main
                    ├── inputs/          # Input files
                    │   ├── directives/  # Task directives
                    │   │   ├── code/directive.md
                    │   │   └── design/directive.md
                    │   ├── sources/     # PRD, tokens, etc.
                    │   │   └── prd.md
                    │   └── assets/      # Images, etc.
                    ├── outputs/         # Output files
                    │   ├── design/
                    │   └── evals/
                    └── sessions/        # Session state
                        ├── code.json
                        └── design.json
```

> ⚠️ **Note**: tenantId format is `organizationId:userId`, which translates to `organizationId/userId` in filesystem paths.

### 4.2 Job Queue (BullMQ)

**File structure**:

```
src/infrastructure/queue/
├── index.ts
└── BullMQJobQueue.ts           # Single implementation (required)

src/infrastructure/worker/
├── JobWorker.ts                # BullMQ worker process
└── start-job-worker.ts         # Worker entry point
```

**Worker process**:

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
    max: 2,              // max 2 concurrent jobs
    duration: 1000
  }
});
```

**Resource limits**:

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

**File structure**:

```
src/infrastructure/preview/
├── index.ts
├── RemotePreviewOrchestrator.ts      # Single implementation (required)
└── PreviewWorkerService.ts           # Runs on worker nodes
```

**Remote worker architecture**:

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
// PreviewAgent API (runs on each worker)
interface PreviewAgentAPI {
  // HTTP
  StartPreview(req: StartPreviewRequest): StartPreviewResponse;
  StopPreview(req: StopPreviewRequest): StopPreviewResponse;
  GetStatus(req: GetStatusRequest): GetStatusResponse;
  StreamLogs(req: StreamLogsRequest): stream LogEntry;
}
```

### 4.4 IDE Orchestration (Kubernetes)

**File structure**:

```
src/infrastructure/ide/
├── index.ts
├── LocalIDEOrchestrator.ts           # Docker-based (default)
└── KubernetesIDEOrchestrator.ts      # K8s-based (when ANT_K8S_NAMESPACE set)
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

## 5. Migration Status (COMPLETED)

### 5.1 Phase 1: Interface Extraction ✅

- `StateStorePort` interface defined
- `JobQueuePort` interface defined
- `PreviewOrchestratorPort` interface defined
- `IDEOrchestratorPort` interface defined

### 5.2 Phase 2: Unified Implementation ✅

- Local implementations removed (`LocalStateStore`, `LocalJobQueue`, `LocalPreviewOrchestrator`)
- `RedisStateStore` as single StateStore implementation
- `BullMQJobQueue` as single JobQueue implementation
- `RemotePreviewOrchestrator` as single Preview implementation

### 5.3 Phase 3: WorkspaceResolver Unification ✅

- `LocalWorkspaceResolver` and `CloudWorkspaceResolver` merged into `UnifiedWorkspaceResolver`
- Path resolution is now mode-agnostic (uses userContext from auth layer)

### 5.4 Phase 4: Environment Configuration ✅

- `ANT_SERVER_MODE` now only affects authentication (local:local vs OAuth)
- `ANT_REDIS_URL` and `ANT_PREVIEW_WORKERS` are required for all environments
- `ANT_K8S_NAMESPACE` determines IDE runtime (Docker vs Kubernetes)

---

## 6. Environment Configuration

### 6.1 Unified Architecture

Local and cloud servers use **identical architecture**.
The only difference is **authentication mode**:
- `local`: Skip auth, auto-set tenant to `local:local`
- `cloud`: Explicit authentication required (OAuth, etc.)

```bash
# ===========================================
# Local Server (.env)
# ===========================================
ANT_SERVER_MODE=local                      # Auth mode (local/cloud)
ANT_REDIS_URL=redis://localhost:6379       # Redis (required)
ANT_PREVIEW_WORKERS=http://localhost:8080  # Preview Worker (required)
# ANT_K8S_NAMESPACE=                        # Not set: Docker

# ===========================================
# Cloud Server (.env)
# ===========================================
ANT_SERVER_MODE=cloud                      # Auth mode (local/cloud)
ANT_REDIS_URL=redis://redis.internal:6379  # Redis (required)
ANT_PREVIEW_WORKERS=http://preview-1.internal:8080,http://preview-2.internal:8080
ANT_K8S_NAMESPACE=ant-ide                  # Set: Kubernetes
```

### 6.2 Infrastructure Summary

| Component | Local | Cloud | Implementation |
|---------|------|---------|-------|
| **Auth** | local:local (auto) | OAuth, etc. | AuthService |
| **State Store** | localhost Redis | cloud Redis | RedisStateStore |
| **Job Queue** | localhost Redis | cloud Redis | BullMQJobQueue |
| **Preview** | localhost Worker | remote Worker | RemotePreviewOrchestrator |
| **IDE** | Docker | Kubernetes | LocalIDEOrchestrator / KubernetesIDEOrchestrator |

### 6.3 InfrastructureFactory

```typescript
// src/infrastructure/adapters/InfrastructureFactory.ts
export class InfrastructureFactory {
  // Validate required environment variables
  private loadConfig(): InfrastructureConfig {
    const authMode = process.env.ANT_SERVER_MODE || 'local';
    const redisUrl = process.env.ANT_REDIS_URL;
    const previewWorkers = process.env.ANT_PREVIEW_WORKERS?.split(',');
    
    if (!redisUrl) {
      throw new Error('ANT_REDIS_URL is required');
    }
    if (!previewWorkers?.length) {
      throw new Error('ANT_PREVIEW_WORKERS is required');
    }
    
    return { authMode, redisUrl, previewWorkers, k8sNamespace: process.env.ANT_K8S_NAMESPACE };
  }
  
  // Always use Redis
  getStateStore(): StateStorePort {
    return new RedisStateStore({ url: this.config.redisUrl });
  }
  
  // Always use BullMQ
  getJobQueue(): JobQueuePort {
    return new BullMQJobQueue({ redisUrl: this.config.redisUrl }, this.getStateStore());
  }
  
  // Always use Remote Worker
  getPreviewOrchestrator(): PreviewOrchestratorPort {
    return new RemotePreviewOrchestrator({ workers: this.config.previewWorkers }, this.getStateStore());
  }
  
  // Determined by ANT_K8S_NAMESPACE
  getIDEOrchestrator(): IDEOrchestratorPort {
    if (this.config.k8sNamespace) {
      return new KubernetesIDEOrchestrator({ namespace: this.config.k8sNamespace }, this.getStateStore());
    }
    return new LocalIDEOrchestrator(this.portManager, this.portRegistry);
  }
}
```

---

## 7. File Structure (Current)

```
src/
├── core/
│   └── ports/
│       ├── stateStore.ts           # StateStorePort
│       ├── queue.ts                # JobQueuePort
│       ├── previewOrchestrator.ts  # PreviewOrchestratorPort
│       ├── ideOrchestrator.ts      # IDEOrchestratorPort
│       └── portRegistry.ts         # PortRegistryPort (integrated in RedisStateStore)
│
├── infrastructure/
│   ├── state/
│   │   └── RedisStateStore.ts      # Single StateStore implementation
│   │
│   ├── queue/
│   │   └── BullMQJobQueue.ts       # Single JobQueue implementation
│   │
│   ├── preview/
│   │   ├── RemotePreviewOrchestrator.ts  # Single Preview implementation
│   │   └── PreviewWorkerService.ts       # Runs on worker nodes
│   │
│   ├── ide/
│   │   ├── LocalIDEOrchestrator.ts       # Docker-based
│   │   └── KubernetesIDEOrchestrator.ts  # K8s-based
│   │
│   ├── workspace/
│   │   └── WorkspaceResolver.ts    # UnifiedWorkspaceResolver
│   │
│   ├── worker/
│   │   └── JobWorker.ts            # BullMQ Worker process
│   │
│   └── adapters/
│       └── InfrastructureFactory.ts  # Factory for all adapters
│
└── periphery/
    └── adapters/
        └── http/
            ├── express/
            │   └── ExpressServerAdapter.ts  # Uses interfaces
            ├── services/
            │   └── PreviewService/          # Delegates to Orchestrator
            └── middleware/
                ├── previewProxy.ts          # Dynamic host handling
                └── ideProxy.ts              # Dynamic host handling
```

---

## 8. Resource Requirements

### 8.1 Cloud Infrastructure

| Component | Recommended Spec | Count | Notes |
|---------|---------|-----|-----|
| **ant-cli API** | 2 CPU, 2GB RAM | 2+ | Behind load balancer |
| **Redis** | 2 CPU, 4GB RAM | 1 (HA: 3) | State + Queue |
| **Job Worker** | 2-4 CPU, 4-8GB RAM | 2+ | Auto-scale |
| **Preview Worker** | 4 CPU, 8GB RAM | 2+ | Port range limited |
| **IDE (K8s)** | 2 CPU, 2GB RAM per pod | Dynamic | 1 user per pod |
| **Workspace Storage** | 100GB+ | 1 | AWS EFS (shared storage) |

### 8.2 Workspace Storage (✅ Implemented)

**Core Principle**: Both local and EFS are POSIX-compliant, so same `FileSystemAdapter` is used.

**Environment Variable** (only one needed):
```bash
ANT_WORKSPACE_BASE_PATH=/path/to/workspaces
```

| Environment | Example |
|-----|----------|
| Local Dev | `ANT_WORKSPACE_BASE_PATH=/Users/dev/ant-workspaces` |
| Single Machine Cloud Test | Same as local (same machine) |
| Distributed Cloud (EFS) | `ANT_WORKSPACE_BASE_PATH=/mnt/efs/workspaces` |

**Path Calculation Principle** (no ad-hoc implementation):
```typescript
// ✅ Always use WorkspaceResolver
const resolver = new UnifiedWorkspaceResolver(workspaceBase);
const featurePath = resolver.getFeaturePath(userContext, projectId, feature);

// ❌ No ad-hoc path.join
const featurePath = path.join(base, org, user, project, 'features', feature);
```

**AWS EFS Mount (K8s)**:
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

### 8.3 Cost Estimate (AWS)

| Component | Instance Type | Monthly Cost (Est.) |
|---------|-------------|--------------|
| API Server x2 | t3.medium | ~$60 |
| Redis (ElastiCache) | cache.t3.medium | ~$50 |
| Job Worker x2 | c5.large | ~$130 |
| Preview Worker x2 | c5.xlarge | ~$270 |
| EKS (IDE) | m5.large x3 | ~$200 |
| EFS (Storage) | 100GB | ~$30 |
| **Total** | | **~$740/month** |

---

## 9. Security Considerations

### 9.1 Network Isolation

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

### 9.2 Authentication/Authorization

- API → Worker: Job data includes `userContext`, Worker validates
- API → Dev Node: mTLS or API Key
- API → K8s: ServiceAccount + RBAC

### 9.3 Data Isolation

- Workspace Storage: Directory separation by tenant (same as before)
- Redis: Tenant separation via key prefix
- K8s: Pod isolation via Namespace or Labels

---

## 10. Monitoring

### 10.1 Metrics

| Metric | Collection Method | Alert Condition |
|-------|---------|---------|
| Job Queue Length | BullMQ metrics | > 100 |
| Worker CPU/Memory | Container metrics | > 80% |
| Dev Server Count | Custom metrics | > capacity |
| IDE Pod Count | K8s metrics | > node capacity |
| API Response Time | Express middleware | p99 > 2s |

### 10.2 Logging

```
[API] → CloudWatch/Loki
[Worker] → CloudWatch/Loki
[Dev Server Agent] → CloudWatch/Loki
[IDE Pod] → K8s logs → CloudWatch/Loki
```

---

## 11. Conclusion

**Local and cloud servers use identical architecture.**

Only differences:
- **Auth**: local uses `local:local` auto, cloud requires explicit auth
- **IDE**: local uses Docker, cloud uses Kubernetes (optional)

**Benefits of unified architecture**:
1. Test distributed environment locally
2. Simplified server code maintenance (minimal conditional branches)
3. No gradual infrastructure migration needed (distributed from start)

---

## 12. Implementation Status

| Item | Status | Notes |
|-----|------|-----|
| **StateStorePort** | ✅ Done | `RedisStateStore` (single) |
| **JobQueuePort** | ✅ Done | `BullMQJobQueue` (single) |
| **JobWorker** | ✅ Done | Separate Worker process |
| **FileSystemAdapter** | ✅ Done | POSIX-compliant (Local/EFS) |
| **WorkspaceResolver** | ✅ Done | `UnifiedWorkspaceResolver` |
| **PreviewOrchestrator** | ✅ Done | `RemotePreviewOrchestrator` (single) |
| **IDEOrchestrator** | ✅ Done | `LocalIDEOrchestrator` (Docker), `KubernetesIDEOrchestrator` (K8s) |

**Local Test Environment**:
```bash
# 1. Start Redis
docker run -d -p 6379:6379 redis

# 2. Set environment variables
export ANT_SERVER_MODE=local
export ANT_REDIS_URL=redis://localhost:6379
export ANT_PREVIEW_WORKERS=http://localhost:8080

# 3. Start server & workers (each in separate terminal)
npm run dev:server          # API Server
npm run dev:worker          # Job Worker
npm run dev:preview-worker  # Preview Worker
```
