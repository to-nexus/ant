# Workspace Multi-Tenancy 리팩토링 진행 상황

## ✅ 완료된 작업

### Phase 1-3: 기반 구축 (100% 완료)
1. ✅ FileSystemPort 인터페이스 정의
2. ✅ WorkspaceServicePort 인터페이스 정의
3. ✅ GitPort에서 파일 I/O 메서드 제거
4. ✅ LocalFileSystemAdapter 구현
5. ✅ LocalWorkspaceService 구현
6. ✅ PureGitAdapter 구현
7. ✅ ArchitectDeps 인터페이스 업데이트 (state.ts)
8. ✅ code/nodes/tool.ts 리팩토링 (GitPort → FileSystemPort)
9. ✅ design/nodes/tool.ts 리팩토링

## 🔄 남은 작업

### Phase 4-5: 통합 (진행 필요)

#### 1. orchestrator.ts 리팩토링
파일: `/packages/ant-cli/src/composition/orchestrator.ts`

**현재 구조:**
```typescript
// 현재: GitAdapter + WorkspaceResolver 사용
const git = AdapterFactory.createGitAdapterWithConfig(project, configData, projectPath);
await architectAgent(..., { git, workspaceResolver, ... });
```

**변경 후:**
```typescript
// 새로운: WorkspaceService + FileSystem + Git 분리
import { LocalWorkspaceService } from '../infrastructure/workspace/LocalWorkspaceService';
import { PureGitAdapter } from '../periphery/adapters/git/PureGitAdapter';

// 1. WorkspaceService 초기화 (환경변수에서)
const workspaceService = new LocalWorkspaceService(
  process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces'
);

// 2. Workspace handle 생성
const tenantId = userContext?.organizationId && userContext?.userId 
  ? `${userContext.organizationId}:${userContext.userId}`
  : 'local:user';
const handle = await workspaceService.createWorkspace(tenantId, project);

// 3. FileSystemPort 획득 (workspace별 격리)
const fileSystem = workspaceService.getFileSystem(handle);

// 4. Git adapter 생성 (codebase만)
const codebasePath = path.join(handle.storagePath, 'codebase');
const git = new PureGitAdapter(codebasePath);

// 5. Agent 실행
await architectAgent(input, project, jobType, inputFile, {
  fileSystem,  // ✅ 파일 I/O용
  git,         // ✅ Git 작업용
  workspaceService,  // ✅ Workspace 관리용
  workspaceHandle: handle,  // ✅ 현재 workspace
  // ... 기타 deps
});
```

**주요 변경점:**
- `workspaceResolver` 제거 → `workspaceService` + `workspaceHandle` 사용
- `git` 는 codebase 디렉토리만 담당
- `fileSystem` 은 workspace 전체 파일 접근

#### 2. server.ts WorkspaceService 통합
파일: `/packages/ant-cli/src/composition/server.ts`

**변경 사항:**
```typescript
import { LocalWorkspaceService } from '../infrastructure/workspace/LocalWorkspaceService';

async function main() {
  // 1. WorkspaceService 초기화
  const workspacesPath = process.env.ANT_WORKSPACE_BASE_PATH || 
    path.join(__dirname, '../../../../workspaces');  // 기본값
  
  const workspaceService = new LocalWorkspaceService(workspacesPath);
  
  console.log(`[Server] Workspace base path: ${workspacesPath}`);
  
  // 2. ExpressServerAdapter에 주입
  const server = new ExpressServerAdapter(
    mode,
    workspaceService,  // ✅ WorkspaceService 주입
    cloudUrl
  );
  
  await server.start(port);
}
```

#### 3. ExpressServerAdapter 리팩토링
파일: `/packages/ant-cli/src/periphery/adapters/http/ExpressServerAdapter.ts`

**변경 사항:**
```typescript
export class ExpressServerAdapter {
  private readonly workspaceService: WorkspaceServicePort;
  
  constructor(
    mode: 'local' | 'cloud',
    workspaceService: WorkspaceServicePort,  // ✅ WorkspaceResolver 대신
    cloudUrl: string
  ) {
    this.workspaceService = workspaceService;
    // ...
  }
  
  private async runJob(jobId: string, params: ExecuteJobParams): Promise<void> {
    // Workspace handle 생성
    const tenantId = params.userContext 
      ? `${params.userContext.organizationId}:${params.userContext.userId}`
      : 'local:user';
    
    const handle = await this.workspaceService.createWorkspace(
      tenantId, 
      params.project
    );
    
    // Child process에 전달할 환경변수
    const childProcess = spawn('npx', ['tsx', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANT_WORKSPACE_TENANT: tenantId,
        ANT_WORKSPACE_PROJECT: params.project,
        ANT_WORKSPACE_STORAGE_PATH: handle.storagePath,  // ✅ 전체 경로 전달
        // ...
      }
    });
  }
}
```

#### 4. 레거시 제거

**삭제 대상:**
```
packages/ant-cli/src/
├── infrastructure/workspace/
│   ├── LocalWorkspaceResolver.ts    [DELETE]
│   ├── WorkspaceResolver.ts         [DELETE - CloudWorkspaceResolver 포함]
│   └── WorkspaceService.ts          [DELETE]
├── periphery/adapters/git/
│   └── SimpleGitAdapter.ts          [DELETE - PureGitAdapter로 대체]
```

**수정 필요:**
- `AdapterFactory.ts`: SimpleGitAdapter 제거, PureGitAdapter 사용
- `gitUtils.ts`: 필요 시 PureGitAdapter 내부로 이동
- 모든 import문에서 SimpleGitAdapter → PureGitAdapter

## 📋 테스트 체크리스트

### 1. Unit Tests
```bash
# LocalFileSystemAdapter
- ✅ Path traversal 방어
- ✅ 파일 읽기/쓰기
- ✅ 디렉토리 생성
- ✅ 파일 리스팅

# LocalWorkspaceService
- ✅ Workspace 생성/삭제
- ✅ FileSystemPort 획득
- ✅ Tenant 격리 검증
```

### 2. Integration Tests
```bash
# Design job
npm run dev:server
# → POST /api/projects/test-project/features/test-feature/jobs
# → jobType: design

# Code job  
# → jobType: code

# 검증:
- ✅ FileSystemPort로 파일 읽기/쓰기 동작
- ✅ GitPort로 Git 작업 동작
- ✅ Workspace 격리 확인
```

### 3. Migration Test
```bash
# 기존 workspaces 데이터 이동
mv workspaces /mnt/workspaces

# 또는 환경변수 설정
export ANT_WORKSPACE_BASE_PATH=/Users/probe/dev/ant/workspaces

# 서버 재시작
npm run dev:server
```

## 🚀 배포 가이드

### 1. 환경변수 설정
```bash
# .env 파일
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces  # 프로덕션
# ANT_WORKSPACE_BASE_PATH=/Users/probe/dev/ant/workspaces  # 개발

# 서버 모드 (기존)
ANT_SERVER_MODE=local  # or cloud
ANT_CLI_PORT=4100
```

### 2. 디렉토리 초기화
```bash
# 새 위치 생성
mkdir -p /mnt/workspaces

# 기존 데이터 마이그레이션
rsync -av workspaces/ /mnt/workspaces/
```

### 3. 서버 시작
```bash
cd packages/ant-cli
npm run dev:server
```

## 📊 아키텍처 개선 요약

### Before (문제)
```
SimpleGitAdapter
  ├─ Git operations ✅
  └─ File I/O operations ❌  (책임 혼재)

WorkspaceResolver
  └─ 경로만 계산 (추상화 부족)

workspaces/ (ant 소스 내부)  ❌
```

### After (해결)
```
PureGitAdapter
  └─ Git operations only ✅

FileSystemPort
  └─ File I/O operations ✅

WorkspaceServicePort
  ├─ Workspace CRUD ✅
  ├─ FileSystemPort factory ✅
  └─ Tenant isolation ✅

/mnt/workspaces/ (물리적 분리) ✅
```

## 🎯 핵심 메트릭

- **코드 변경**: ~15 files
- **신규 파일**: 4 files (FileSystemPort, WorkspaceServicePort, LocalFileSystemAdapter, LocalWorkspaceService)
- **삭제 파일**: 3 files (SimpleGitAdapter, WorkspaceResolver, LocalWorkspaceResolver)
- **리팩토링 파일**: 8 files (orchestrator, server, tool.ts, state.ts, etc.)
- **테스트 필요**: Unit (4), Integration (2)

## 📝 다음 단계

1. orchestrator.ts 완성 (패턴 위 참고)
2. server.ts 통합
3. ExpressServerAdapter 수정
4. AdapterFactory 업데이트
5. 레거시 삭제
6. 테스트 실행
7. 문서 업데이트

