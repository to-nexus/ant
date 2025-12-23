# 워크스페이스 생성 및 작업 실행 시뮬레이션

## 📍 시나리오: 새 프로젝트 생성 및 작업 실행

### 환경 설정
```bash
# 환경변수 (기본값)
ANT_SERVER_MODE=local
ANT_CLI_PORT=4100
ANT_WORKSPACE_BASE_PATH=/Users/probe/dev/ant/workspaces  # 기본값
```

---

## 1️⃣ 프로젝트 생성 시점

### UI 작업
```
사용자가 ant-ui에서:
1. "+ New Project" 클릭
2. 프로젝트 이름 입력: "my-app"
3. 생성 버튼 클릭
```

### 서버 처리 흐름

#### Step 1: HTTP Request
```typescript
// ant-ui → ant-cli
POST http://localhost:4100/api/projects
Body: { id: "my-app" }
```

#### Step 2: ProjectService.createProject()
```typescript
// packages/ant-cli/src/periphery/adapters/http/services/ProjectService.ts

async createProject(id: string, userContext: UserContext) {
  // 1. UserContext 확인
  // Local 모드: { userId: 'local', organizationId: 'local' }
  // Cloud 모드: { userId: 'alice', organizationId: 'acme-corp' }
  
  // 2. WorkspaceResolver로 경로 계산 (현재 레거시 방식)
  const projectPath = this.workspaceResolver.getProjectPath(userContext, 'my-app');
  // → /Users/probe/dev/ant/workspaces/local/user/my-app
  
  // 3. 디렉토리 생성
  await fs.promises.mkdir(projectPath, { recursive: true });
  
  // 4. config.json 생성
  const configPath = path.join(projectPath, 'config.json');
  await fs.promises.writeFile(configPath, JSON.stringify({
    repositoryName: "my-app",
    repoType: "cloud",  // ✅ 기본값
    branchBase: "main",
    autoLearn: true,
    llmModels: { ... }
  }));
}
```

### 생성된 워크스페이스 구조
```
/Users/probe/dev/ant/workspaces/           ← basePath
└── local/                                  ← tenantId (조직)
    └── user/                               ← userId
        └── my-app/                         ← projectId ⭐ 프로젝트 워크스페이스
            ├── config.json                 ← 프로젝트 설정
            ├── codebase/                   ← Git 저장소 (비어있음)
            └── features/                   ← 피처 작업 공간 (비어있음)
```

**⭐ 핵심: 프로젝트 워크스페이스는 `/workspaces/local/user/my-app/`에 즉시 생성됨**

---

## 2️⃣ 작업(Job) 실행 시점

### UI 작업
```
사용자가 ant-ui에서:
1. 프로젝트 선택: "my-app"
2. 피처 선택: "auth-system" (또는 생성)
3. Architect > Code 선택
4. "Run" 버튼 클릭
```

### 서버 처리 흐름

#### Step 1: HTTP Request
```typescript
// ant-ui → ant-cli
POST http://localhost:4100/api/projects/my-app/features/auth-system/jobs
Body: {
  agent: "architect",
  jobType: "code",
  input: "Implement user authentication"
}
```

#### Step 2: ExpressServerAdapter.executeJob()
```typescript
// packages/ant-cli/src/periphery/adapters/http/ExpressServerAdapter.ts

async executeJob(params: ExecuteJobParams) {
  const jobId = generateId();  // e.g., "job-abc123"
  
  // 1. UserContext 확인
  const userContext = params.userContext || { 
    userId: 'local', 
    organizationId: 'local' 
  };
  
  // 2. WorkspaceResolver로 경로 계산 (현재 레거시)
  const projectPath = this.workspaceResolver.getProjectPath(userContext, 'my-app');
  // → /Users/probe/dev/ant/workspaces/local/user/my-app
  
  const featurePath = this.workspaceResolver.getFeaturePath(userContext, 'my-app', 'auth-system');
  // → /Users/probe/dev/ant/workspaces/local/user/my-app/features/auth-system
  
  // 3. Child Process 생성 (런타임)
  const childProcess = spawn('npx', ['tsx', 'dist/cli/command.js', ...args], {
    cwd: process.cwd(),  // ← ant-cli 디렉토리 (작업 실행은 여기서)
    env: {
      ...process.env,
      ANT_JOB_ID: jobId,
      ANT_PROJECT_PATH: projectPath,      // ← 프로젝트 워크스페이스 경로
      ANT_FEATURE_PATH: featurePath,      // ← 피처 워크스페이스 경로
      ANT_CLI_PORT: '4100'
    }
  });
}
```

### 런타임 워크스페이스

**⭐ 핵심: "런타임 워크스페이스"는 별도로 생성되지 않습니다!**

Child process는:
- **실행 위치**: `/Users/probe/dev/ant/packages/ant-cli/` (ant-cli 소스 디렉토리)
- **작업 위치**: `/Users/probe/dev/ant/workspaces/local/user/my-app/` (프로젝트 워크스페이스)

```
실행중인 프로세스:
┌─────────────────────────────────────────────────────┐
│ Child Process (tsx)                                 │
│ Working Directory: /Users/probe/dev/ant/packages/ant-cli/ │
│                                                     │
│ 하지만 파일 작업은:                                │
│ → /workspaces/local/user/my-app/codebase/         │
│ → /workspaces/local/user/my-app/features/auth-system/ │
└─────────────────────────────────────────────────────┘
```

---

## 3️⃣ 코드 및 산출물 Write 시점

### 시점 1: Agent 초기화 시
```typescript
// packages/ant-cli/src/composition/orchestrator.ts

// ⚠️ 현재는 레거시 방식 (리팩토링 완료 후):
// 1. WorkspaceService 초기화
const workspaceService = new LocalWorkspaceService(
  process.env.ANT_WORKSPACE_BASE_PATH || '/Users/probe/dev/ant/workspaces'
);

// 2. Workspace Handle 생성 (또는 기존 것 획득)
const tenantId = 'local:user';
const handle = await workspaceService.createWorkspace(tenantId, 'my-app');
// → handle.storagePath = "/Users/probe/dev/ant/workspaces/local/user/my-app"

// 3. FileSystemPort 획득 (이미 존재하는 워크스페이스에 대한 FileSystem)
const fileSystem = workspaceService.getFileSystem(handle);
// → LocalFileSystemAdapter(basePath: "/Users/probe/dev/ant/workspaces/local/user/my-app")

// 4. GitAdapter 생성 (codebase 디렉토리만)
const codebasePath = path.join(handle.storagePath, 'codebase');
// → "/Users/probe/dev/ant/workspaces/local/user/my-app/codebase"
const git = new GitAdapter(codebasePath);
```

### 시점 2: LLM 응답 처리 시 (실시간 Write)

#### A. 코드 파일 생성/수정
```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/tool.ts

// LLM이 도구 호출: edit_file("src/auth/login.ts", old, new)
async function handleEditFile(state, args) {
  const fileSystem = state.deps?.fileSystem;  // ✅
  
  // 1. 현재 파일 읽기 (워크스페이스에서)
  const content = await fileSystem.readFile('codebase/src/auth/login.ts');
  // → /workspaces/local/user/my-app/codebase/src/auth/login.ts
  
  // 2. 수정 적용
  const modified = applySearchReplace(content, old, new);
  
  // 3. 즉시 워크스페이스에 Write ⭐
  await fileSystem.writeFile('codebase/src/auth/login.ts', modified);
  // → /workspaces/local/user/my-app/codebase/src/auth/login.ts 에 즉시 저장
}
```

**Write 시점**: LLM이 각 파일을 생성/수정할 때마다 **실시간으로** 워크스페이스에 Write

#### B. 산출물 (Design 문서, 로그)
```typescript
// packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts

async save(state) {
  const sessionPath = path.join(
    this.featurePath,  // /workspaces/local/user/my-app/features/auth-system
    'sessions',
    'code.json'
  );
  
  // 세션 상태 저장 ⭐
  await fs.promises.writeFile(sessionPath, JSON.stringify(state));
  // → /workspaces/local/user/my-app/features/auth-system/sessions/code.json
}

// Design 문서 저장
const designPath = path.join(
  featurePath,
  'outputs/design',
  `system-design-${Date.now()}.md`
);
await fs.promises.writeFile(designPath, designDoc);
// → /workspaces/local/user/my-app/features/auth-system/outputs/design/system-design-xxx.md
```

**Write 시점**: 
- **세션**: 각 노드 실행 후 (체크포인트)
- **Design 문서**: Design job 완료 시
- **로그**: 실시간 스트리밍

---

## 🎯 최종 워크스페이스 구조

작업 완료 후:
```
/Users/probe/dev/ant/workspaces/
└── local/
    └── user/
        └── my-app/                                    ← 프로젝트 워크스페이스
            ├── config.json                            ← 프로젝트 설정
            │
            ├── codebase/                              ← 생성된 코드 ⭐
            │   ├── src/
            │   │   └── auth/
            │   │       ├── login.ts                   ← LLM이 실시간 Write
            │   │       ├── register.ts                ← LLM이 실시간 Write
            │   │       └── jwt.ts                     ← LLM이 실시간 Write
            │   ├── package.json                       ← LLM이 실시간 Write
            │   └── .git/                              ← Git 저장소
            │
            └── features/
                └── auth-system/                       ← 피처 작업 공간
                    ├── inputs/
                    │   ├── directives/
                    │   │   └── code/
                    │   │       └── directive.md
                    │   └── sources/
                    │       └── prd.md
                    │
                    ├── outputs/
                    │   ├── design/
                    │   │   └── system-design-xxx.md  ← Design job 산출물 ⭐
                    │   └── reports/
                    │       └── architect-code-xxx.log ← 실행 로그 ⭐
                    │
                    └── sessions/
                        ├── design.json                ← Design 세션 상태 ⭐
                        └── code.json                  ← Code 세션 상태 ⭐
```

---

## 📊 타임라인 요약

```
시간    │ 이벤트                        │ 워크스페이스 상태
────────┼──────────────────────────────┼─────────────────────────────────
T0      │ 서버 시작                     │ /workspaces/ (비어있음)
        │                              │
T1      │ 프로젝트 생성: "my-app"       │ /workspaces/local/user/my-app/ ⭐ 생성
        │ → POST /api/projects          │   ├── config.json
        │                              │   ├── codebase/ (비어있음)
        │                              │   └── features/ (비어있음)
        │                              │
T2      │ 피처 생성: "auth-system"      │ /workspaces/local/user/my-app/
        │ → POST .../features           │   └── features/
        │                              │       └── auth-system/ ⭐ 생성
        │                              │           ├── inputs/
        │                              │           ├── outputs/
        │                              │           └── sessions/
        │                              │
T3      │ Code Job 시작                 │ Child Process 생성
        │ → POST .../jobs               │ (워크스페이스 접근 준비)
        │                              │
T4~T10  │ LLM 코드 생성 (실시간)        │ codebase/src/auth/login.ts ⭐ Write
        │ → edit_file("login.ts")       │ codebase/src/auth/register.ts ⭐ Write
        │ → edit_file("register.ts")    │ (각 파일마다 즉시 Write)
        │                              │
T11     │ 노드 완료 (체크포인트)         │ sessions/code.json ⭐ Write
        │                              │ (중간 상태 저장)
        │                              │
T12     │ Job 완료                      │ outputs/reports/xxx.log ⭐ Write
        │                              │ sessions/code.json (최종 상태)
```

---

## 🔑 핵심 정리

### 1. 워크스페이스 위치
- **프로젝트 생성 즉시**: `/workspaces/local/user/my-app/` 생성
- **별도 런타임 워크스페이스 없음**: 같은 워크스페이스에서 직접 작업

### 2. Write 시점
- **코드 파일**: LLM이 각 파일을 생성/수정할 때마다 **실시간** Write
- **세션 상태**: 노드 실행 후 **체크포인트**마다 Write
- **산출물**: Job 완료 시 또는 실시간 스트리밍

### 3. 물리적 위치
```
모든 작업이 동일한 워크스페이스에서 발생:
/workspaces/local/user/my-app/
  ├── codebase/      ← 사용자 코드 (실시간 Write)
  └── features/      ← 작업 메타데이터 (실시간 Write)
     └── auth-system/
         ├── outputs/    ← 산출물
         └── sessions/   ← 체크포인트
```

### 4. 리팩토링 후 변화
리팩토링 후에도 물리적 구조는 동일하지만:
- **WorkspaceService**가 테넌트별 격리 관리
- **FileSystemPort**가 모든 파일 작업 담당
- **GitPort**는 Git 작업만 담당

**보안 강화**: FileSystemPort가 path traversal 방어, 테넌트 격리 보장

