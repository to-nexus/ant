# Cloud Mode 구현 계획서

**작성일**: 2025-11-14  
**버전**: 1.0  
**상태**: 승인 대기

---

## 📋 목차

1. [개요](#개요)
2. [현재 시스템 분석](#현재-시스템-분석)
3. [요구사항](#요구사항)
4. [아키텍처 설계](#아키텍처-설계)
5. [디렉토리 구조](#디렉토리-구조)
6. [구현 계획](#구현-계획)
7. [마이그레이션](#마이그레이션)
8. [테스트 계획](#테스트-계획)
9. [향후 확장](#향후-확장)

---

## 개요

### 목표

ANT Works를 **Local Mode**와 **Cloud Mode**를 모두 지원하는 멀티 테넌트 시스템으로 확장합니다.

### 주요 변경사항

- ✅ Local/Cloud 모드 분리
- ✅ 다중 사용자/조직 지원
- ✅ Job Queue 기반 비동기 처리
- ✅ 사용자별 작업 공간 격리
- ✅ 간단한 이메일 기반 인증

---

## 현재 시스템 분석

### Local Mode (현재)

```
workspace/
├─ <project>/
│   ├─ config.json
│   ├─ features/
│   │   └─ <feature>/
│   │       ├─ artifacts/
│   │       │   ├─ inputs/
│   │       │   ├─ outputs/
│   │       │   └─ sessions/
│   │       └─ kanban.json
│   └─ codebase/
```

**특징:**
- 단일 사용자
- 즉시 실행 (child process spawn)
- 인증 없음
- 로컬 파일 시스템 직접 접근

### 문제점

1. **다중 사용자 지원 불가**: 모든 사용자가 같은 workspace 공유
2. **동시성 제어 없음**: 여러 job이 동시 실행 시 충돌 가능
3. **클라우드 배포 불가**: 인증/인가 시스템 없음
4. **확장성 제한**: 서버 리소스 관리 없음

---

## 요구사항

### 기능 요구사항

#### FR-1: 사용자/조직 관리
- 이메일 기반 간단 인증
- `username@organization.domain.com` 형식
- 초기에는 모든 사용자가 `nexus` 조직에 속함

#### FR-2: 작업 공간 격리
```
workspaces/
└─ <organization_id>/
    └─ <user_id>/
        └─ <project_id>/
            ├─ config.json
            ├─ features/
            │   └─ <feature_id>/
            │       └─ artifacts/
            └─ codebase/
```

#### FR-3: Job Queue
- 비동기 job 처리
- 우선순위 기반 스케줄링
- Job 상태 추적 (pending, running, completed, failed, cancelled)
- 사용자별 job 목록 조회

#### FR-4: Vector DB 공유
- 조직 단위로 Vector DB 사용
- 같은 조직의 사용자는 codebase 벡터 공유

#### FR-5: 모드 전환
- 환경 변수로 Local/Cloud 모드 선택
- 기존 Local Mode는 그대로 유지

### 비기능 요구사항

#### NFR-1: 확장성
- Scale-up 우선 (단일 서버 성능 극대화)
- Scale-out 가능한 구조 (향후)

#### NFR-2: 보안
- Path traversal 공격 방지
- 사용자별 리소스 접근 제어

#### NFR-3: 호환성
- 기존 Local Mode 100% 호환
- 기존 데이터 구조 유지 (마이그레이션 가능)

---

## 아키텍처 설계

### 계층 구조

```
┌─────────────────────────────────────────────────────────────┐
│                       ant-cli Package                       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  Core Layer (Domain)                                  │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │  Ports (Interfaces)                             │ │ │
│  │  │  - HttpServerPort                               │ │ │
│  │  │  - GitPort, FilePort, CommandPort               │ │ │
│  │  │  - AuthPort          ← Infrastructure only     │ │ │
│  │  │  - QueuePort         ← Infrastructure only     │ │ │
│  │  │  - WorkspacePort     ← Infrastructure only     │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                          ▲                                  │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐ │
│  │  Infrastructure Layer (Cloud Services)                │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │  AuthService implements AuthPort                │ │ │
│  │  │  MemoryJobQueue implements QueuePort            │ │ │
│  │  │  BullJobQueue implements QueuePort              │ │ │
│  │  │  WorkspaceService implements WorkspacePort      │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                          ▲                                  │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────────────┐ │
│  │  Periphery Layer (Adapters)                           │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │  BaseServerAdapter (abstract)                   │ │ │
│  │  │    ├─ LocalServerAdapter                        │ │ │
│  │  │    │    └─ Core Port만 사용                     │ │ │
│  │  │    └─ CloudServerAdapter                        │ │ │
│  │  │         └─ Core Port + Infrastructure 사용      │ │ │
│  │  │                                                   │ │ │
│  │  │  GitAdapter, FileAdapter, CommandAdapter        │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 원칙

1. **Adapter와 Infrastructure 분리**
   - 단순한 외부 시스템 연동 → Adapter가 직접 Port 구현
   - Cloud-specific 복잡한 로직 → Infrastructure 사용

2. **Base Adapter 추상화**
   - 공통 로직 재사용
   - Local/Cloud adapter는 차이점만 구현

3. **모드별 분기 최소화**
   - 환경 변수로 시작 시 한 번만 분기
   - 런타임 중에는 polymorphism으로 처리

---

## 디렉토리 구조

### 소스 코드 구조

```
packages/ant-cli/src/
├─ core/
│   ├─ ports/
│   │   ├─ http.ts          # HttpServerPort
│   │   ├─ git.ts           # GitPort
│   │   ├─ file.ts          # FilePort
│   │   ├─ command.ts       # CommandPort
│   │   ├─ auth.ts          # AuthPort (Infrastructure용)
│   │   ├─ queue.ts         # QueuePort (Infrastructure용)
│   │   └─ workspace.ts     # WorkspacePort (Infrastructure용)
│   └─ types/
│       ├─ project.ts
│       ├─ job.ts
│       └─ user.ts          # 신규
│
├─ infrastructure/          # 신규 - Cloud-specific services
│   ├─ auth/
│   │   └─ AuthService.ts   # implements AuthPort
│   ├─ queue/
│   │   ├─ MemoryJobQueue.ts  # implements QueuePort (개발용)
│   │   └─ BullJobQueue.ts    # implements QueuePort (프로덕션용)
│   └─ workspace/
│       └─ WorkspaceService.ts # implements WorkspacePort
│
└─ periphery/adapters/
    ├─ http/
    │   ├─ BaseServerAdapter.ts      # 신규 - 추상 클래스
    │   ├─ LocalServerAdapter.ts     # 신규 - extends Base
    │   ├─ CloudServerAdapter.ts     # 신규 - extends Base
    │   ├─ routes/                   # 기존 routes 재사용
    │   │   ├─ projectRoutes.ts
    │   │   ├─ taskRoutes.ts
    │   │   ├─ featureRoutes.ts
    │   │   └─ devServerRoutes.ts
    │   └─ services/                 # 기존 services 재사용
    │       ├─ ProjectService.ts
    │       ├─ TaskExecutionService.ts
    │       ├─ SessionService.ts
    │       ├─ DevServerService.ts
    │       └─ ChatService.ts
    ├─ git/
    │   └─ SimpleGitAdapter.ts
    ├─ file/
    │   └─ NodeFileAdapter.ts
    └─ command/
        └─ NodeCommandAdapter.ts
```

### 작업 공간 구조

#### Local Mode (변경 없음)

```
workspace/
├─ simple-scheduler/
│   ├─ config.json
│   ├─ features/
│   │   └─ auth-system/
│   │       ├─ artifacts/
│   │       └─ kanban.json
│   └─ codebase/
```

#### Cloud Mode (신규)

```
workspaces/
└─ nexus/                           # organization_id
    ├─ alice/                       # user_id
    │   ├─ project-a/
    │   │   ├─ config.json
    │   │   ├─ features/
    │   │   │   └─ feature-1/
    │   │   │       └─ artifacts/
    │   │   │           ├─ inputs/
    │   │   │           ├─ outputs/
    │   │   │           └─ sessions/
    │   │   └─ codebase/
    │   └─ project-b/
    └─ bob/
        └─ project-c/
```

---

## 구현 계획

### Phase 1: Core 인터페이스 정의 (1일)

#### Task 1.1: Port 인터페이스 추가

**파일**: `packages/ant-cli/src/core/ports/auth.ts`

```typescript
export interface AuthPort {
  authenticate(credentials: AuthCredentials): Promise<AuthContext>;
  authorize(user: User, resource: string, action: string): Promise<boolean>;
}

export interface AuthCredentials {
  email?: string;
  token?: string;
}

export interface AuthContext {
  user: User;
  organization: Organization;
}

export interface User {
  id: string;
  email: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
}
```

**파일**: `packages/ant-cli/src/core/ports/queue.ts`

```typescript
export interface JobQueuePort {
  enqueue(job: JobRequest): Promise<string>;
  dequeue(): Promise<JobRequest | null>;
  getJobStatus(jobId: string): Promise<JobStatus>;
  getUserJobs(userId: string): Promise<JobStatus[]>;
  cancelJob(jobId: string): Promise<void>;
}

export interface JobRequest {
  id: string;
  userId: string;
  organizationId: string;
  params: ExecuteJobParams;
  priority: number;
  createdAt: Date;
}

export interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
```

**파일**: `packages/ant-cli/src/core/ports/workspace.ts`

```typescript
export interface WorkspacePort {
  getUserWorkspacePath(organizationId: string, userId: string): string;
  getProjectPath(org: string, user: string, project: string): string;
  getFeaturePath(org: string, user: string, project: string, feature: string): string;
  getCodebasePath(org: string, user: string, project: string): string;
  validatePath(basePath: string, targetPath: string): boolean;
}
```

**예상 시간**: 2시간

---

#### Task 1.2: Type 정의 추가

**파일**: `packages/ant-cli/src/core/types/user.ts`

```typescript
export interface User {
  id: string;
  email: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
}

export interface UserContext {
  userId: string;
  organizationId: string;
  workspacePath: string;
}
```

**예상 시간**: 1시간

---

### Phase 2: Infrastructure 구현 (1일)

#### Task 2.1: AuthService

**파일**: `packages/ant-cli/src/infrastructure/auth/AuthService.ts`

**기능**:
- 이메일 파싱 (`username@organization.domain.com`)
- 모든 사용자를 `nexus` 조직에 할당 (초기)
- 간단한 권한 검사 (초기에는 모두 허용)

**예상 시간**: 2시간

---

#### Task 2.2: WorkspaceService

**파일**: `packages/ant-cli/src/infrastructure/workspace/WorkspaceService.ts`

**기능**:
- 경로 계산 (`workspaces/<org>/<user>/<project>`)
- Path traversal 방지 (security)
- 경로 존재 여부 확인

**예상 시간**: 2시간

---

#### Task 2.3: MemoryJobQueue

**파일**: `packages/ant-cli/src/infrastructure/queue/MemoryJobQueue.ts`

**기능**:
- 메모리 기반 Queue (개발/테스트용)
- 우선순위 정렬
- Job 상태 추적
- 간단한 Worker 로직

**예상 시간**: 3시간

---

### Phase 3: Base Adapter 구현 (1일)

#### Task 3.1: BaseServerAdapter

**파일**: `packages/ant-cli/src/periphery/adapters/http/BaseServerAdapter.ts`

**기능**:
- Express 서버 초기화
- 공통 middleware 설정
- 공통 services 초기화 (ProjectService, SessionService 등)
- Abstract methods 정의:
  - `getMode(): string`
  - `registerCustomMiddleware(): void`
  - `registerCustomRoutes(): void`
  - `getUserContext(req): UserContext`
  - `getWorkspacePath(context, project): string`
  - `executeJob(params, context): JobResult`

**예상 시간**: 4시간

---

### Phase 4: Local Adapter 구현 (1일)

#### Task 4.1: LocalServerAdapter

**파일**: `packages/ant-cli/src/periphery/adapters/http/LocalServerAdapter.ts`

**기능**:
- BaseServerAdapter 상속
- 기존 `ExpressServerAdapter` 로직 이전
- 단일 사용자 컨텍스트 생성
- 즉시 job 실행 (child process spawn)
- 기존 routes 재사용

**변경사항**:
- `ExpressServerAdapter.ts` → `LocalServerAdapter.ts` 리팩토링
- 공통 로직은 Base로 이동
- Local-specific 로직만 남김

**예상 시간**: 4시간

---

#### Task 4.2: 기존 코드 호환성 테스트

**테스트 항목**:
- ✅ Project CRUD
- ✅ Feature CRUD
- ✅ Job 실행
- ✅ SSE 스트리밍
- ✅ Dev Server
- ✅ Chat

**예상 시간**: 2시간

---

### Phase 5: Cloud Adapter 구현 (2일)

#### Task 5.1: CloudServerAdapter

**파일**: `packages/ant-cli/src/periphery/adapters/http/CloudServerAdapter.ts`

**기능**:
- BaseServerAdapter 상속
- AuthService 통합
- WorkspaceService 통합
- JobQueue 통합
- 인증 middleware 추가
- 사용자별 리소스 필터링

**예상 시간**: 5시간

---

#### Task 5.2: Cloud Routes

**신규 라우트**:

```typescript
// Job Queue API
POST   /api/jobs              # Job 추가 (queue)
GET    /api/jobs/:id          # Job 상태 조회
GET    /api/jobs              # 내 Job 목록 조회
DELETE /api/jobs/:id          # Job 취소

// User-scoped Resources
GET    /api/projects          # 내 프로젝트 목록
POST   /api/projects          # 프로젝트 생성 (내 workspace에)
GET    /api/projects/:id      # 프로젝트 상세 (권한 확인)
```

**예상 시간**: 3시간

---

#### Task 5.3: 사용자별 리소스 필터링

**변경 파일**:
- `ProjectService.ts`: 경로 계산 시 UserContext 사용
- `SessionService.ts`: 사용자별 세션 격리
- `DevServerService.ts`: 사용자별 dev server 관리

**예상 시간**: 3시간

---

### Phase 6: 시작 스크립트 통합 (0.5일)

#### Task 6.1: index.ts 수정

**파일**: `packages/ant-cli/src/index.ts`

```typescript
const mode = process.env.ANT_MODE || 'local';
const port = parseInt(process.env.PORT || '4100');
const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), '../../workspace');

let server: BaseServerAdapter;

if (mode === 'cloud') {
  const queueType = process.env.QUEUE_TYPE || 'memory';
  server = new CloudServerAdapter(port, workspaceRoot, queueType);
  console.log('🌐 Starting in CLOUD mode with', queueType, 'queue');
} else {
  server = new LocalServerAdapter(port, workspaceRoot);
  console.log('💻 Starting in LOCAL mode');
}

await server.start();
```

**예상 시간**: 1시간

---

#### Task 6.2: 환경 변수 문서화

**파일**: `packages/ant-cli/.env.example`

```bash
# Server Mode
ANT_MODE=local          # 'local' or 'cloud'
PORT=4100
WORKSPACE_ROOT=../../workspace

# Cloud Mode Only
QUEUE_TYPE=memory       # 'memory' or 'bull'
REDIS_URL=redis://localhost:6379

# Auth (Cloud Mode)
JWT_SECRET=your-secret-key
```

**예상 시간**: 1시간

---

### Phase 7: Frontend 통합 (1일)

#### Task 7.1: API 클라이언트 수정

**파일**: `packages/ant-ui/src/infrastructure/http/api.ts`

**변경사항**:
```typescript
// 인증 헤더 추가
const headers = {
  'Content-Type': 'application/json',
  'x-user-email': localStorage.getItem('user-email') || ''
};

// Job Queue API 추가
export async function queueJob(params: ExecuteJobParams): Promise<string> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params)
  });
  const { jobId } = await response.json();
  return jobId;
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, { headers });
  return response.json();
}
```

**예상 시간**: 2시간

---

#### Task 7.2: 인증 UI 추가

**파일**: `packages/ant-ui/src/presentation/components/auth/LoginPrompt.tsx`

**기능**:
- 이메일 입력 폼
- localStorage에 저장
- Cloud 모드일 때만 표시

**예상 시간**: 2시간

---

#### Task 7.3: Job Queue UI

**파일**: `packages/ant-ui/src/presentation/components/JobStatusPanel.tsx`

**기능**:
- Job 목록 표시
- 상태별 필터링
- Progress 표시
- 취소 버튼

**예상 시간**: 3시간

---

### Phase 8: 마이그레이션 도구 (0.5일)

#### Task 8.1: 마이그레이션 스크립트

**파일**: `packages/ant-cli/scripts/migrate-to-cloud.ts`

**기능**:
```bash
# 기존 local workspace를 cloud 구조로 변환
npm run migrate -- --source ./workspace --target ./workspaces --org nexus --user alice
```

**변환 로직**:
```
workspace/project-a/
  → workspaces/nexus/alice/project-a/
```

**예상 시간**: 3시간

---

### Phase 9: 테스트 (1일)

#### Task 9.1: Unit Tests

**테스트 파일**:
- `AuthService.test.ts`
- `WorkspaceService.test.ts`
- `MemoryJobQueue.test.ts`

**예상 시간**: 3시간

---

#### Task 9.2: Integration Tests

**테스트 시나리오**:
1. Local Mode 전체 플로우
2. Cloud Mode 사용자 격리
3. Job Queue 동작
4. 권한 검사

**예상 시간**: 4시간

---

## 마이그레이션

### Local Mode → Cloud Mode

#### 1단계: 백업

```bash
cp -r workspace workspace.backup
```

#### 2단계: 마이그레이션 실행

```bash
cd packages/ant-cli
npm run migrate -- \
  --source ../../workspace \
  --target ../../workspaces \
  --org nexus \
  --user <username>
```

#### 3단계: 환경 변수 설정

```bash
# .env
ANT_MODE=cloud
WORKSPACE_ROOT=../../workspaces
```

#### 4단계: 서버 재시작

```bash
pnpm dev:cli
```

---

## 테스트 계획

### Local Mode 테스트

```bash
# 1. 환경 설정
export ANT_MODE=local
export WORKSPACE_ROOT=./workspace

# 2. 서버 시작
pnpm dev:cli

# 3. 기존 기능 테스트
curl http://localhost:4100/api/projects
curl -X POST http://localhost:4100/api/projects -d '{"projectName":"test"}'
```

**기대 결과**: 기존 기능 100% 동작

---

### Cloud Mode 테스트

```bash
# 1. 환경 설정
export ANT_MODE=cloud
export WORKSPACE_ROOT=./workspaces
export QUEUE_TYPE=memory

# 2. 서버 시작
pnpm dev:cli

# 3. 인증 테스트
curl http://localhost:4100/api/projects \
  -H "x-user-email: alice@nexus.ai"

# 4. 격리 테스트 (다른 사용자)
curl http://localhost:4100/api/projects \
  -H "x-user-email: bob@nexus.ai"

# 5. Job Queue 테스트
curl -X POST http://localhost:4100/api/jobs \
  -H "x-user-email: alice@nexus.ai" \
  -d '{"projectName":"test","featureName":"auth","agentId":"architect"}'
```

**기대 결과**:
- Alice와 Bob의 프로젝트 목록이 분리됨
- Job이 queue에 추가됨

---

## 향후 확장

### Phase 10: BullMQ 통합 (프로덕션 Queue)

**파일**: `packages/ant-cli/src/infrastructure/queue/BullJobQueue.ts`

**기능**:
- Redis 기반 Queue
- 분산 Worker 지원
- Job retry 로직
- Job priority

**예상 시간**: 1일

---

### Phase 11: Vector DB 조직별 격리

**변경사항**:
- `VectorMemoryAdapter`에 organizationId 추가
- 조직별 collection 분리
- 같은 조직 내 사용자는 벡터 공유

**예상 시간**: 0.5일

---

### Phase 12: Scale-out 준비

**구성요소**:
- Load Balancer
- Redis (Session, Queue)
- Shared File System (NFS or S3)
- Database (User, Project metadata)

**예상 시간**: 3일

---

## 타임라인

| Phase | 작업 | 예상 시간 | 누적 시간 |
|-------|------|-----------|-----------|
| 1 | Core 인터페이스 | 3h | 3h |
| 2 | Infrastructure | 7h | 10h |
| 3 | Base Adapter | 4h | 14h |
| 4 | Local Adapter | 6h | 20h |
| 5 | Cloud Adapter | 11h | 31h |
| 6 | 시작 스크립트 | 2h | 33h |
| 7 | Frontend 통합 | 7h | 40h |
| 8 | 마이그레이션 | 3h | 43h |
| 9 | 테스트 | 7h | 50h |

**총 예상 시간**: 약 50시간 (6-7일)

---

## 위험 요소 및 대응

### R-1: 기존 기능 호환성 깨짐

**대응**:
- Local Mode는 100% 기존 코드 재사용
- 철저한 regression test

### R-2: 성능 저하

**대응**:
- MemoryJobQueue 사용 시 성능 모니터링
- 필요 시 즉시 BullMQ로 전환

### R-3: 사용자 데이터 격리 실패

**대응**:
- WorkspaceService에서 path validation 강화
- Integration test로 검증

---

## 승인 체크리스트

- [ ] 아키텍처 설계 승인
- [ ] 디렉토리 구조 승인
- [ ] 구현 순서 승인
- [ ] 타임라인 승인

---

**작성자**: AI Assistant  
**검토자**: User  
**승인일**: TBD

