# 리팩토링 완료 및 남은 작업

## ✅ 완료된 핵심 작업

### 1. 새로운 Port 및 Adapter 구현
- ✅ `FileSystemPort` 인터페이스 정의
- ✅ `WorkspaceServicePort` 인터페이스 정의
- ✅ `GitPort` 파일 I/O 메서드 제거
- ✅ `LocalFileSystemAdapter` 구현
- ✅ `LocalWorkspaceService` 구현
- ✅ `GitAdapter` (구 PureGitAdapter) 구현

### 2. State 인터페이스 업데이트
- ✅ `ArchitectGraphState.deps`: fileSystem, workspaceService, workspaceHandle 추가
- ✅ `DesignGraphState.deps`: fileSystem, workspaceService, workspaceHandle 추가

### 3. Tool 노드 리팩토링
- ✅ `code/nodes/tool.ts`: GitPort → FileSystemPort
- ✅ `design/nodes/tool.ts`: GitPort → FileSystemPort

### 4. 기타 수정
- ✅ `FileRegistry`: GitPort → FileSystemPort
- ✅ `StreamOrchestrator`: gitPort → fileSystem

## ⚠️ 남은 작업 (컴파일 에러 수정)

리팩토링이 광범위하여 다음 파일들이 아직 수정되지 않았습니다:

### 1. Context Loaders
파일들이 GitPort를 FileSystemPort와 함께 받도록 시그니처 변경 필요:

```typescript
// 수정 필요 파일들:
- packages/ant-cli/src/agents/architect/context/index.ts
- packages/ant-cli/src/agents/architect/context/loader.ts

// 변경 예시:
// Before
export async function loadFullCodebase(gitPort: GitPort, options) {
  const files = await gitPort.listFiles(...);  // ❌
}

// After  
export async function loadFullCodebase(
  gitPort: GitPort,
  fileSystem: FileSystemPort,  // ← 추가
  options
) {
  const files = await fileSystem.listFiles(...);  // ✅
}
```

### 2. Node 파일들
다음 노드들이 fileSystem 변수 선언 필요:

```typescript
// 수정 필요 파일들:
- packages/ant-cli/src/agents/architect/graph/code/nodes/installDeps.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/diagnostics/index.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/resolve.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/runtimeValidate.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/plan/errorFilesLoader.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/plan/semanticSearch.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/plan/referenceLoader.ts

// 패턴:
const gitPort = state.deps?.git;
const fileSystem = state.deps?.fileSystem;  // ← 추가

if (!fileSystem) {
  throw new Error('FileSystemPort not available');
}
```

### 3. workspaceResolver 제거
`workspaceResolver`를 사용하는 곳을 `workspaceService`로 변경:

```typescript
// 수정 필요:
- packages/ant-cli/src/agents/architect/graph/code/nodes/plan/referenceLoader.ts
- packages/ant-cli/src/agents/architect/graph/code/nodes/resolve.ts

// Before
const refPath = state.deps.workspaceResolver.getProjectPath(userContext, project);

// After
const tenantId = `${userContext.organizationId}:${userContext.userId}`;
const handle = await state.deps.workspaceService.createWorkspace(tenantId, project);
const refPath = handle.storagePath;
```

### 4. orchestrator.ts 통합
WorkspaceService를 초기화하고 의존성 주입:

```typescript
// packages/ant-cli/src/composition/orchestrator.ts

import { LocalWorkspaceService } from '../infrastructure/workspace/LocalWorkspaceService';
import { GitAdapter } from '../periphery/adapters/git/GitAdapter';

// WorkspaceService 초기화
const workspaceService = new LocalWorkspaceService(
  process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces'
);

// Workspace handle 생성
const tenantId = userContext ? 
  `${userContext.organizationId}:${userContext.userId}` : 
  'local:user';
const handle = await workspaceService.createWorkspace(tenantId, project);

// FileSystemPort 획득
const fileSystem = workspaceService.getFileSystem(handle);

// GitAdapter 생성 (codebase만)
const codebasePath = path.join(handle.storagePath, 'codebase');
const git = new GitAdapter(codebasePath);

// Agent 실행
await architectAgent(input, project, jobType, inputFile, {
  git,
  fileSystem,
  workspaceService,
  workspaceHandle: handle,
  // ... 나머지 deps
});
```

### 5. server.ts 통합
```typescript
// packages/ant-cli/src/composition/server.ts

import { LocalWorkspaceService } from '../infrastructure/workspace/LocalWorkspaceService';

const workspacesPath = process.env.ANT_WORKSPACE_BASE_PATH || 
  path.join(__dirname, '../../../../workspaces');

const workspaceService = new LocalWorkspaceService(workspacesPath);

const server = new ExpressServerAdapter(
  mode,
  workspaceService,  // ← 주입
  cloudUrl
);
```

## 🔧 빠른 수정 가이드

### Step 1: Context 파일 수정
```bash
# context/index.ts, context/loader.ts
# 모든 함수 시그니처에 fileSystem: FileSystemPort 추가
# gitPort.listFiles → fileSystem.listFiles
# gitPort.readFile → fileSystem.readFile
```

### Step 2: Node 파일들 일괄 수정
```bash
# 각 노드 파일에서:
# 1. const fileSystem = state.deps?.fileSystem; 추가
# 2. fileSystem 검증 추가
# 3. fileSystem.xxx() 호출 확인
```

### Step 3: workspaceResolver 제거
```bash
# workspaceResolver 사용하는 모든 곳을 workspaceService로 교체
grep -r "workspaceResolver" packages/ant-cli/src --include="*.ts"
```

### Step 4: 통합 테스트
```bash
cd packages/ant-cli
npm run build
# 모든 컴파일 에러 해결 후:
npm run dev:server
```

## 📝 핵심 변경 사항 요약

### Before (문제)
```typescript
// GitPort가 Git + 파일 I/O 모두 담당 (SRP 위반)
interface GitPort {
  // Git
  createBranch()
  commit()
  // File I/O ❌
  readFile()
  writeFile()
  fileExists()
}

// 사용
const git = AdapterFactory.createGitAdapter();
const content = await git.readFile(path);  // ❌ 혼재
```

### After (해결)
```typescript
// 완전 분리
interface GitPort {
  createBranch()
  commit()
  // Git만!
}

interface FileSystemPort {
  readFile()
  writeFile()
  fileExists()
  // 파일 I/O만!
}

// 사용
const git = new GitAdapter(codebasePath);
const fileSystem = workspaceService.getFileSystem(handle);
const content = await fileSystem.readFile(path);  // ✅ 명확
```

## 🎯 다음 단계

1. 위 "남은 작업" 섹션의 파일들 수정
2. `npm run build` 성공 확인
3. 테스트 실행
4. 레거시 파일 삭제:
   - SimpleGitAdapter.ts
   - WorkspaceResolver.ts
   - LocalWorkspaceResolver.ts
5. 문서 업데이트

## 💡 핵심 원칙

- **GitPort**: Git 작업만 (branch, commit, push, pull)
- **FileSystemPort**: 파일 I/O만 (read, write, exists, delete, list)
- **WorkspaceService**: 멀티 테넌시 관리, FileSystemPort factory
- **각 역할이 명확히 분리**되어 테스트와 확장이 용이함

