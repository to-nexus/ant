# Workspace Multi-Tenancy 리팩토링 계획

## 1. 현재 구조 분석

### 1.1 물리적 구조
```
workspaces/
├── local/user/<project>/               # Local 모드 (개발용)
│   ├── config.json
│   ├── codebase/                       # repoType='cloud'인 경우만
│   └── features/<feature>/
└── <org>/<user>/<project>/            # Cloud 모드 (프로덕션)
    ├── config.json
    ├── codebase/                       # Git 저장소
    └── features/<feature>/
```

### 1.2 현재 문제점

#### ⚠️ CRITICAL: GitPort의 책임 혼재
**GitPort가 Git 작업과 파일 I/O를 모두 담당:**
```typescript
export interface GitPort {
  // Git operations
  createBranch(name: string, base: string): Promise<void>;
  getChangedFiles(): Promise<string[]>;
  clone(url: string, targetPath: string): Promise<void>;
  // ...
  
  // ❌ File system operations (잘못된 설계)
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  readDirectory(path: string): Promise<Array<{...}>>;
  listFiles(path: string, exclude?: string[]): Promise<string[]>;
}
```

**문제:**
1. **단일 책임 원칙(SRP) 위반**: Git과 File I/O는 서로 다른 관심사
2. **테스트 어려움**: Git 없이 파일 작업만 테스트 불가
3. **추상화 누수**: SimpleGitAdapter가 fs 모듈 직접 사용
4. **확장성 제약**: S3/NFS 등 다른 스토리지 지원 불가
5. **의존성 강제**: 파일 작업만 필요해도 Git 인스턴스 필요

**실제 사용 예:**
```typescript
// code/nodes/tool.ts
async function handleReadFile(state, args) {
  const gitPort = state.deps?.git;  // ❌ 파일 읽기에 GitPort 사용
  const content = await gitPort.readFile(filePath);
}

async function handleEditFile(state, args) {
  const gitPort = state.deps?.git;  // ❌ 파일 쓰기에 GitPort 사용
  await gitPort.writeFile(filePath, content);
}
```

#### A. 물리적 혼재

#### A. 물리적 혼재
- **프로젝트 소스와 작업공간이 동일 파일시스템**: `workspaces/` 디렉토리가 ant 소스 트리 내부에 위치
- **확장성 제약**: 단일 머신의 디스크/메모리 한계
- **보안 위험**: 모든 사용자 코드가 같은 파일시스템에 존재

#### B. 프로세스 아키텍처 문제
```
ExpressServerAdapter (Port 4100)
└── Child Process (tsx)
    └── orchestrator()
        └── architectAgent()
            ├── Git operations (codebase/)
            ├── File operations (features/)
            └── run_command()
                └── User dev server (Port 3000-9999)
```

**문제:**
1. **Child process가 부모와 같은 머신에서 실행**: 사용자 코드 실행이 시스템 안정성에 직접 영향
2. **런타임 프로세스가 workspaces 내에서 직접 실행**: 
   - DevServerService가 `codebase/` 내에서 `npm run dev` 직접 spawn
   - 악의적 코드 실행 시 시스템 전체 위험
3. **파일 접근 권한 미분리**: Child process가 전체 workspaces에 접근 가능

#### C. Git 연동 문제
- **SimpleGitAdapter가 로컬 파일시스템 직접 의존**: `workspaces/<org>/<user>/<project>/codebase`
- **GitHub 인증이 프로세스별 분리 안됨**: 환경변수/파일 기반 PAT 관리
- **Clone/Pull/Push가 동기적**: 대용량 저장소에서 타임아웃

#### D. IDE 통합 문제
- **ant-ui가 ant-cli HTTP API만 호출**: 직접적인 파일 접근 없음 (양호)
- **ant-ide 패키지 미완성**: VSCode/Cursor 확장 통합 불완전

### 1.3 현재 동작 방식

#### 작업 실행 흐름
```
1. ant-ui → HTTP POST /api/projects/:project/features/:feature/jobs
2. ExpressServerAdapter.executeJob()
3. spawn('npx', ['tsx', 'cli/command.ts', ...])
   환경변수:
   - ANT_JOB_ID
   - ANT_CLI_PORT=4100
   - ANT_PROJECT_PATH=/path/to/workspaces/<org>/<user>/<project>
   - ANT_FEATURE_PATH=/path/to/workspaces/<org>/<user>/<project>/features/<feature>
4. Child process:
   - orchestrator() 호출
   - Git operations on codebase/
   - File I/O on features/
   - HTTP callback to parent (Kanban updates, SSE)
5. run_command() 실행:
   - 사용자 빌드: npm install, npm run build
   - 사용자 서버: npm run dev (10초 모니터링 후 kill)
```

#### Git 작업 흐름
```
1. ant-ui → Git button (clone/pull/push)
2. ProjectService.cloneGitHubRepo()
3. SimpleGitAdapter.clone(url, projectPath/codebase)
4. GitHub PAT: CredentialStore (encrypted file)
5. Git operations: simpleGit library (동기)
```

---

## 2. 목표 아키텍처

### 2.1 물리적 분리

```
┌─────────────────────────────────────────────────────────────┐
│ Control Plane (ant-cli, ant-ui)                             │
│ - Express Server (Port 4100)                                │
│ - Static UI serving                                         │
│ - Job orchestration                                         │
│ - Metadata management                                       │
└─────────────────────────────────────────────────────────────┘
                    │ HTTP/gRPC API
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Workspace Service (별도 서비스)                              │
│ - Tenant workspace 관리                                      │
│ - File storage abstraction                                  │
│ - S3/NFS/Local FS 지원                                       │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Storage Layer                                               │
│ ┌─────────────────┐  ┌─────────────────┐                  │
│ │ Workspace Store │  │ Git Service     │                  │
│ │ (S3/NFS)        │  │ (GitLab/GitHub) │                  │
│ └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Execution Plane (Sandboxed)                                │
│ - Job Executors (container/VM per job)                     │
│ - User code runtime isolation                              │
│ - Resource limits (CPU/Memory/Network)                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 핵심 설계 원칙

1. **완전한 물리적 분리**: Control Plane과 Workspace Storage 분리
2. **Sandboxed Execution**: 사용자 코드는 격리된 환경에서만 실행
3. **Storage Abstraction**: 로컬 파일시스템 직접 의존 제거
4. **비동기 작업**: Git clone/pull/push는 백그라운드 작업으로 처리

---

## 3. 리팩토링 상세 설계

### 3.1 Port 분리: GitPort와 FileSystemPort

#### 현재 문제 해결
GitPort에서 파일 I/O 책임을 완전히 분리합니다.

```typescript
// ✅ 순수한 Git 작업만
export interface GitPort {
  // Repository info
  getRepoRoot(): Promise<string>;
  getRepoName(): Promise<string>;
  
  // Branch operations
  createBranch(name: string, base: string): Promise<void>;
  getCurrentBranch(): Promise<string>;
  checkoutBranch(branch: string, options?: { create?: boolean }): Promise<void>;
  getBranches(options?: { remote?: boolean }): Promise<string[]>;
  
  // Working tree
  getChangedFiles(): Promise<string[]>;
  hasChanges(): Promise<boolean>;
  status(): Promise<{ files: Array<{ path: string }> }>;
  
  // Staging
  stage(files: string[]): Promise<void>;
  unstage(files: string[]): Promise<void>;
  commit(message: string, files?: string[]): Promise<void>;
  
  // Remote operations
  clone(url: string, targetPath: string, options?: { depth?: number }): Promise<void>;
  fetch(remote?: string): Promise<void>;
  pull(remote?: string, branch?: string): Promise<void>;
  push(remote?: string, branch?: string, options?: { setUpstream?: boolean }): Promise<void>;
  getRemotes(): Promise<Array<{ name: string; url: string }>>;
  addRemote(name: string, url: string): Promise<void>;
  
  // History
  getCurrentCommit(): Promise<string>;
  getHeadFile(path: string): Promise<string | null>;  // Git history에서 파일 내용 가져오기
}

// ✅ 새로운 FileSystemPort (파일 I/O 전담)
export interface FileSystemPort {
  // File operations
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  
  // Directory operations
  readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  createDirectory(path: string): Promise<void>;
  listFiles(path: string, exclude?: string[]): Promise<string[]>;
}
```

#### 의존성 주입 변경
```typescript
// Before (잘못된 설계)
interface ArchitectDeps {
  git: GitPort;  // Git + File I/O 모두 담당
}

// After (올바른 설계)
interface ArchitectDeps {
  git: GitPort;           // Git 작업만
  fileSystem: FileSystemPort;  // 파일 I/O만
}
```

### 3.2 Workspace Service 신규 구축

#### 목적
- 테넌트별 workspace 물리적 격리
- 파일 스토리지 추상화 (S3, NFS, Local FS)
- Control Plane과 Storage Layer 분리
- FileSystemPort의 실제 구현 제공

#### 인터페이스
```typescript
interface WorkspaceServicePort {
  // Workspace CRUD
  createWorkspace(tenantId: string, projectId: string): Promise<WorkspaceHandle>;
  deleteWorkspace(tenantId: string, projectId: string): Promise<void>;
  
  // FileSystemPort factory (핵심: 각 workspace에 대한 FileSystemPort 생성)
  getFileSystem(handle: WorkspaceHandle): FileSystemPort;
  
  // Metadata
  getWorkspaceInfo(handle: WorkspaceHandle): Promise<WorkspaceInfo>;
  
  // Volume mounting (for job execution)
  mountWorkspace(handle: WorkspaceHandle): Promise<MountPoint>;
  unmountWorkspace(mountPoint: MountPoint): Promise<void>;
}

interface WorkspaceHandle {
  tenantId: string;      // org:user
  projectId: string;
  storageType: 'local' | 's3' | 'nfs';
  storagePath: string;   // 실제 저장 위치 (opaque)
}

interface MountPoint {
  path: string;          // 마운트된 로컬 경로 (read-only for jobs)
  expiresAt: Date;       // 자동 언마운트 시간
}
```

#### 구현체
```typescript
// Local filesystem adapter (FileSystemPort 구현)
class LocalFileSystemAdapter implements FileSystemPort {
  constructor(private basePath: string) {}
  
  async readFile(path: string): Promise<string | null> {
    try {
      const fullPath = this.resolve(path);
      return await fs.promises.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolve(path);
    await fs.promises.mkdir(dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }
  
  async fileExists(path: string): Promise<boolean> {
    const fullPath = this.resolve(path);
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
  
  // ... 나머지 구현
  
  private resolve(path: string): string {
    const fullPath = join(this.basePath, path);
    // Path traversal 방어
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error('Path traversal detected');
    }
    return fullPath;
  }
}

// Local workspace service (개발/테스트용)
class LocalWorkspaceService implements WorkspaceServicePort {
  private basePath: string; // /mnt/workspaces (ant 소스 외부)
  
  constructor(basePath: string) {
    this.basePath = basePath;
  }
  
  async createWorkspace(tenantId: string, projectId: string): Promise<WorkspaceHandle> {
    const workspacePath = path.join(this.basePath, tenantId, projectId);
    await fs.promises.mkdir(workspacePath, { recursive: true });
    
    return {
      tenantId,
      projectId,
      storageType: 'local',
      storagePath: workspacePath
    };
  }
  
  getFileSystem(handle: WorkspaceHandle): FileSystemPort {
    // ✅ 핵심: 각 workspace별 격리된 FileSystemPort 반환
    return new LocalFileSystemAdapter(handle.storagePath);
  }
  
  // ... 나머지 구현
}

// S3 filesystem adapter (FileSystemPort 구현)
class S3FileSystemAdapter implements FileSystemPort {
  constructor(
    private s3Client: S3Client,
    private bucketName: string,
    private prefix: string  // tenantId/projectId
  ) {}
  
  async readFile(path: string): Promise<string | null> {
    try {
      const s3Key = `${this.prefix}/${path}`;
      const result = await this.s3Client.getObject({
        Bucket: this.bucketName,
        Key: s3Key
      });
      return await result.Body.transformToString();
    } catch {
      return null;
    }
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    const s3Key = `${this.prefix}/${path}`;
    await this.s3Client.putObject({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: content
    });
  }
  
  // ... 나머지 구현
}

// S3 workspace service (프로덕션)
class S3WorkspaceService implements WorkspaceServicePort {
  private s3Client: S3Client;
  private bucketName: string;
  private localCache: string; // /tmp/workspace-cache
  
  constructor(bucketName: string, cacheDir: string) {
    this.s3Client = new S3Client({});
    this.bucketName = bucketName;
    this.localCache = cacheDir;
  }
  
  getFileSystem(handle: WorkspaceHandle): FileSystemPort {
    // ✅ S3 기반 FileSystemPort 반환
    const prefix = `${handle.tenantId}/${handle.projectId}`;
    return new S3FileSystemAdapter(this.s3Client, this.bucketName, prefix);
  }
  
  async mountWorkspace(handle): Promise<MountPoint> {
    // S3 → Local cache sync (job execution용)
    const localPath = path.join(
      this.localCache,
      handle.tenantId,
      handle.projectId,
      Date.now().toString()
    );
    
    await this.syncToCache(handle, localPath);
    
    return {
      path: localPath,
      expiresAt: new Date(Date.now() + 3600000) // 1시간
    };
  }
  
  private async syncToCache(handle: WorkspaceHandle, localPath: string): Promise<void> {
    // S3 prefix로 모든 객체 다운로드
    const prefix = `${handle.tenantId}/${handle.projectId}/`;
    const objects = await this.s3Client.listObjectsV2({
      Bucket: this.bucketName,
      Prefix: prefix
    });
    
    for (const obj of objects.Contents || []) {
      const relativePath = obj.Key!.substring(prefix.length);
      const localFile = path.join(localPath, relativePath);
      
      // Download from S3
      const result = await this.s3Client.getObject({
        Bucket: this.bucketName,
        Key: obj.Key!
      });
      
      await fs.promises.mkdir(path.dirname(localFile), { recursive: true });
      await fs.promises.writeFile(localFile, await result.Body.transformToByteArray());
    }
  }
  
  // ... 나머지 구현
}
```

### 3.3 Git Service 분리

#### 현재 문제
- SimpleGitAdapter가 로컬 파일시스템 직접 의존
- Git 작업이 동기적 (HTTP 타임아웃 위험)
- GitHub 인증이 프로세스별 분리 안됨

#### 새로운 설계
```typescript
interface GitServicePort {
  // Repository management
  cloneRepository(tenantId: string, projectId: string, repoUrl: string): Promise<JobId>;
  pullChanges(tenantId: string, projectId: string): Promise<JobId>;
  pushChanges(tenantId: string, projectId: string, branch: string): Promise<JobId>;
  
  // Job status
  getJobStatus(jobId: JobId): Promise<GitJobStatus>;
  
  // File operations (through workspace)
  getFileContent(tenantId: string, projectId: string, path: string): Promise<string>;
  commitChanges(tenantId: string, projectId: string, files: string[], message: string): Promise<void>;
}

interface GitJobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number; // 0-100
  error?: string;
}
```

#### 구현 전략
```typescript
class GitService implements GitServicePort {
  constructor(
    private workspaceService: WorkspaceServicePort,
    private jobQueue: JobQueuePort,
    private credentialStore: CredentialStorePort
  ) {}
  
  async cloneRepository(tenantId, projectId, repoUrl): Promise<JobId> {
    const jobId = generateId();
    
    // 비동기 작업 큐에 등록
    await this.jobQueue.enqueue({
      jobId,
      type: 'git-clone',
      params: { tenantId, projectId, repoUrl },
      handler: async () => {
        // Workspace handle 획득
        const handle = await this.workspaceService.createWorkspace(tenantId, projectId);
        
        // Workspace mount (temporary)
        const mount = await this.workspaceService.mountWorkspace(handle);
        
        try {
          // Git clone (격리된 프로세스에서)
          const git = simpleGit();
          const codebasePath = path.join(mount.path, 'codebase');
          
          // PAT 획득
          const pat = await this.credentialStore.getPAT(tenantId);
          const authUrl = repoUrl.replace('https://', `https://${pat}@`);
          
          await git.clone(authUrl, codebasePath, ['--depth', '1']);
          
          // S3인 경우 sync back
          if (handle.storageType === 's3') {
            await (this.workspaceService as S3WorkspaceService).syncFromCache(handle, mount);
          }
        } finally {
          await this.workspaceService.unmountWorkspace(mount);
        }
      }
    });
    
    return jobId;
  }
}
```

### 3.4 Job Execution 격리

#### 현재 문제
- Child process가 부모와 같은 머신에서 실행
- 사용자 코드(`run_command`)가 시스템에 직접 영향
- 리소스 제한 없음

#### 새로운 설계

##### Phase 1: Process Isolation (단기)
```typescript
class SandboxedJobExecutor implements JobExecutionPort {
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    // Workspace mount (read-only)
    const mount = await this.workspaceService.mountWorkspace(params.workspaceHandle);
    
    try {
      // Spawn in isolated process with restrictions
      const child = spawn('node', [
        '--max-old-space-size=2048',  // 2GB heap limit
        'dist/cli/command.js',
        ...args
      ], {
        cwd: mount.path,
        env: {
          // Only pass whitelisted env vars
          PATH: '/usr/bin:/bin',
          HOME: '/tmp/sandbox',
          ANT_CLI_PORT: '4100',
          ANT_JOB_ID: jobId,
          // NO access to parent env vars
        },
        // Resource limits
        timeout: 3600000, // 1 hour
        uid: 1001,        // Non-root user
        gid: 1001,
      });
      
      // ... handle execution
    } finally {
      await this.workspaceService.unmountWorkspace(mount);
    }
  }
}
```

##### Phase 2: Container Isolation (중기)
```typescript
class ContainerJobExecutor implements JobExecutionPort {
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    // Docker container per job
    const container = await docker.createContainer({
      Image: 'ant-executor:latest',
      Cmd: ['tsx', 'cli/command.js', ...args],
      Env: [
        'ANT_CLI_PORT=4100',
        'ANT_JOB_ID=' + jobId,
      ],
      HostConfig: {
        Memory: 2147483648,        // 2GB
        MemorySwap: 2147483648,
        CpuQuota: 100000,          // 1 CPU
        NetworkMode: 'none',       // No network (except API callback)
        ReadonlyRootfs: true,
        Binds: [
          `${mount.path}:/workspace:ro`,  // Read-only mount
        ],
      },
    });
    
    await container.start();
    
    // ... monitor and cleanup
  }
}
```

##### Phase 3: VM Isolation (장기 - 옵션)
- Firecracker microVM per job
- 완전한 커널 격리
- 밀리초 단위 cold start

### 3.5 런타임 프로세스(Dev Server) 분리

#### 현재 문제
```typescript
// DevServerService.ts (현재)
const child = spawn('npm', ['run', 'dev'], {
  cwd: localPath,  // workspaces/<org>/<user>/<project>/codebase
  env: { PORT: '3000' }
});
```
→ 사용자 dev server가 ant-cli와 같은 머신에서 실행

#### 새로운 설계

##### Option A: 별도 Execution Cluster
```
Control Plane (ant-cli)  →  Workspace Service  →  Storage
         ↓
    Job Queue
         ↓
┌─────────────────────────┐
│ Execution Cluster       │
│ ┌────────────────────┐ │
│ │ Job Executor 1     │ │  ← Agent job (design/code)
│ │ Job Executor 2     │ │  ← Agent job
│ │ Dev Server Runner 3│ │  ← User dev server (npm run dev)
│ └────────────────────┘ │
└─────────────────────────┘
```

**장점:**
- Control Plane과 Execution 완전 분리
- 독립적 스케일링
- 보안 강화

**단점:**
- 복잡도 증가
- Network latency (SSE 업데이트)

##### Option B: Control Plane 내 격리 (권장)
```
Control Plane
├── Express Server (Port 4100)
├── Workspace Service Client
└── Sandboxed Executors
    ├── Job Executor (container)
    └── Dev Server Runner (container)
```

**장점:**
- 구조 단순
- SSE 업데이트 low latency
- 개발 환경과 프로덕션 일관성

**단점:**
- Control Plane 리소스 사용 증가

#### 구현
```typescript
class DevServerService {
  async startDevServer(projectId: string, port: number): Promise<DevServerHandle> {
    // Workspace mount
    const mount = await this.workspaceService.mountWorkspace(handle);
    
    // Container로 dev server 실행
    const container = await docker.createContainer({
      Image: 'node:20',
      Cmd: ['npm', 'run', 'dev'],
      WorkingDir: '/workspace/codebase',
      Env: ['PORT=' + port],
      HostConfig: {
        NetworkMode: 'bridge',
        PortBindings: {
          [`${port}/tcp`]: [{ HostPort: port.toString() }]
        },
        Binds: [
          `${mount.path}/codebase:/workspace/codebase:rw`,
        ],
        Memory: 1073741824,  // 1GB
      },
    });
    
    await container.start();
    
    return {
      containerId: container.id,
      port,
      url: `http://localhost:${port}`
    };
  }
  
  async stopDevServer(handle: DevServerHandle): Promise<void> {
    await docker.getContainer(handle.containerId).stop();
    await docker.getContainer(handle.containerId).remove();
  }
}
```

### 3.6 Agent Tool 노드 리팩토링

#### 현재 코드 (잘못된 설계)
```typescript
// code/nodes/tool.ts
async function handleReadFile(state, args) {
  const gitPort = state.deps?.git;  // ❌ 파일 읽기에 Git 사용
  const content = await gitPort.readFile(filePath);
  return content;
}

async function handleWriteFile(state, args) {
  const gitPort = state.deps?.git;  // ❌ 파일 쓰기에 Git 사용
  await gitPort.writeFile(filePath, content);
}
```

#### 리팩토링 후
```typescript
// code/nodes/tool.ts
async function handleReadFile(state, args) {
  const fs = state.deps?.fileSystem;  // ✅ FileSystemPort 사용
  const content = await fs.readFile(filePath);
  return content;
}

async function handleWriteFile(state, args) {
  const fs = state.deps?.fileSystem;  // ✅ FileSystemPort 사용
  await fs.writeFile(filePath, content);
}

// Git은 실제 Git 작업에만 사용
async function handleGitStatus(state, args) {
  const git = state.deps?.git;  // ✅ Git 작업에만 GitPort 사용
  const status = await git.status();
  return status;
}
```

#### 의존성 주입 변경
```typescript
// orchestrator.ts
async function orchestrator(params) {
  // Workspace handle 획득
  const handle = await workspaceService.createWorkspace(tenantId, projectId);
  
  // FileSystemPort 생성 (workspace별 격리)
  const fileSystem = workspaceService.getFileSystem(handle);
  
  // GitPort 생성 (codebase용)
  const git = new PureGitAdapter(
    path.join(handle.storagePath, 'codebase')
  );
  
  // Agent 실행
  await architectAgent(input, project, jobType, inputFile, {
    fileSystem,  // ✅ 파일 I/O용
    git,         // ✅ Git 작업용
    // ... 기타 deps
  });
}
```

### 3.7 레거시 제거

#### 완전 삭제 대상
```
packages/ant-cli/src/
├── core/ports/
│   └── git.ts                       [REFACTOR → GitPort와 FileSystemPort 분리]
├── infrastructure/workspace/
│   ├── LocalWorkspaceResolver.ts    [DELETE]
│   ├── WorkspaceResolver.ts         [DELETE]
│   └── WorkspaceService.ts          [DELETE]
├── periphery/adapters/
│   ├── git/
│   │   ├── SimpleGitAdapter.ts      [REFACTOR → PureGitAdapter + 파일 I/O 제거]
│   │   └── gitUtils.ts              [REFACTOR → GitService로 이동]
│   └── session/
│       └── FileSessionAdapter.ts    [REFACTOR - FileSystemPort 사용]

workspaces/                          [MOVE to /mnt/workspaces]
```

#### 호환성 제거
- `repoType: 'local'` 제거 (모든 프로젝트는 cloud 타입)
- `localPath` config 제거
- Local/Cloud mode 구분 제거 (단일 아키텍처)
- GitPort의 파일 I/O 메서드 완전 제거

---

## 4. 마이그레이션 전략

### 4.1 데이터 마이그레이션

#### 기존 데이터 폐기
```bash
# 기존 workspaces 백업 후 삭제
mv workspaces workspaces.backup
```

#### 새로운 구조 초기화
```bash
# 별도 마운트 포인트 사용 (프로덕션)
mkdir -p /mnt/ant-workspaces

# 또는 S3 bucket 생성
aws s3 mb s3://ant-workspaces-prod
```

### 4.2 코드 마이그레이션 순서

#### Step 1: Port 분리 및 Workspace Service 구현
1. `FileSystemPort` 인터페이스 정의
2. `GitPort`에서 파일 I/O 메서드 제거
3. `LocalFileSystemAdapter` 구현
4. `S3FileSystemAdapter` 구현
5. `WorkspaceServicePort` 인터페이스 정의
6. `LocalWorkspaceService` 구현
7. `S3WorkspaceService` 구현
8. Unit tests (FileSystem, Workspace CRUD, path traversal)

#### Step 2: Git Service 분리
1. `GitServicePort` 인터페이스 정의
2. `GitService` 구현 (비동기 작업 큐 기반)
3. SimpleGitAdapter 제거
4. Integration tests

#### Step 3: Job Execution 격리
1. `SandboxedJobExecutor` 구현 (process isolation)
2. Child process spawn 로직 교체
3. Resource limits 적용
4. ExpressServerAdapter 리팩토링

#### Step 4: Dev Server 격리
1. `DevServerService` 컨테이너 기반 재구현
2. Port management 로직 간소화
3. Workspace mount 통합

#### Step 5: 레거시 제거
1. LocalWorkspaceResolver 삭제
2. repoType='local' 지원 제거
3. 사용하지 않는 환경변수 제거 (ANT_PROJECT_PATH, ANT_FEATURE_PATH → WorkspaceHandle로 대체)

### 4.3 배포 전략

#### 개발 환경
```bash
# Local filesystem 기반 테스트
ANT_WORKSPACE_STORAGE=local
ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces
ANT_EXECUTION_MODE=process  # process | container
```

#### 프로덕션 환경
```bash
# S3 기반
ANT_WORKSPACE_STORAGE=s3
ANT_WORKSPACE_S3_BUCKET=ant-workspaces-prod
ANT_WORKSPACE_S3_REGION=us-west-2
ANT_EXECUTION_MODE=container
```

---

## 5. 아키텍처 결정 사항

### 5.1 런타임 분리: Option B 선택 (Control Plane 내 격리)

**이유:**
- 개발 초기 단계에서 복잡도 최소화
- SSE 실시간 업데이트 latency 중요
- Kubernetes 등 orchestration layer 불필요
- 추후 Execution Cluster 분리 가능 (확장 경로 열어둠)

### 5.2 Storage: S3 우선, Local fallback

**이유:**
- 멀티 테넌시에 S3가 가장 적합
- Local FS는 개발/테스트용으로만 사용
- NFS는 성능 이슈로 제외

### 5.3 Isolation: Container 기반 (Docker)

**이유:**
- Firecracker microVM은 over-engineering
- Docker가 성숙하고 생태계 풍부
- 충분한 격리 수준 제공
- 로컬 개발 환경과 일관성

---

## 6. 핵심 구현 체크리스트

### Phase 1: Port 분리 및 FileSystem 구현
- [ ] FileSystemPort 인터페이스 정의
- [ ] GitPort에서 파일 I/O 메서드 제거
- [ ] LocalFileSystemAdapter 구현
- [ ] S3FileSystemAdapter 구현
- [ ] Unit tests (FileSystem operations, path traversal)

### Phase 2: Workspace Service 구현
- [ ] WorkspaceServicePort 인터페이스 정의
- [ ] LocalWorkspaceService 구현 (FileSystemPort 통합)
- [ ] S3WorkspaceService 구현 (FileSystemPort 통합)
- [ ] Unit tests (workspace CRUD, mount/unmount)

### Phase 3: Agent 리팩토링
- [ ] PureGitAdapter 구현 (파일 I/O 제거)
- [ ] ArchitectDeps 인터페이스 업데이트 (git + fileSystem)
- [ ] code/nodes/tool.ts 리팩토링 (FileSystemPort 사용)
- [ ] design/nodes/tool.ts 리팩토링
- [ ] orchestrator.ts 의존성 주입 변경
- [ ] Integration tests

### Phase 4: Git Service 분리
- [ ] GitServicePort 인터페이스 정의
- [ ] GitService 구현 (비동기 job queue)
- [ ] CredentialStore refactoring (tenant별 격리)
- [ ] ProjectService Git 작업 리팩토링
- [ ] Integration tests (clone/pull/push)

### Phase 5: Execution Isolation
- [ ] SandboxedJobExecutor 구현 (Docker 기반)
- [ ] ExpressServerAdapter refactoring (Workspace Service 사용)
- [ ] orchestrator.ts 리팩토링 (환경변수 → WorkspaceHandle)
- [ ] Child process spawn 로직 교체

### Phase 6: Dev Server Isolation
- [ ] DevServerService 컨테이너 기반 재구현
- [ ] Port management 간소화
- [ ] Workspace mount 통합

### Phase 7: Cleanup
- [ ] LocalWorkspaceResolver 삭제
- [ ] WorkspaceResolver/WorkspaceService 삭제
- [ ] SimpleGitAdapter 삭제 (PureGitAdapter로 완전 대체)
- [ ] repoType='local' 지원 제거
- [ ] 사용하지 않는 환경변수 제거
- [ ] 문서 업데이트 (README, CLI_GUIDE)

### Phase 8: Production
- [ ] S3 배포 테스트
- [ ] 성능 테스트 (1000+ workspaces)
- [ ] 보안 감사 (container escape, path traversal)
- [ ] 모니터링 설정 (workspace usage, job metrics)

---

## 7. 핵심 메트릭

### 성능 목표
- Workspace mount latency: < 100ms (Local), < 500ms (S3)
- Git clone: 백그라운드 작업 (no HTTP timeout)
- Job execution overhead: < 2s (container start)
- Dev server start: < 5s

### 보안 목표
- 테넌트 간 완전한 파일 격리 (path traversal 불가)
- Job execution 샌드박싱 (container/VM)
- PAT 암호화 저장 (tenant별 key)
- Resource limits 강제 (CPU/Memory/Disk)

### 확장성 목표
- 동시 workspace: 10,000+
- 동시 job execution: 100+
- Storage: unlimited (S3)
- Execution cluster: 수평 확장 가능 (future)

