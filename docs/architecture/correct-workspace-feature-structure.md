# Workspace 구조 - 올바른 피처 관리

## 디렉토리 구조

```
/workspaces/{tenantId}/{userId}/{projectId}/
  ├── config.json                    # 프로젝트 설정
  ├── codebase/                      # 메인 브랜치 (main/master)
  │   ├── src/
  │   ├── package.json
  │   ├── .git/
  │   └── ...
  └── features/                      # ✅ 피처별 작업 디렉토리
      ├── feature-login/             # 피처 1
      │   ├── src/
      │   ├── package.json
      │   ├── .git/
      │   └── ...
      ├── feature-payment/           # 피처 2
      │   ├── src/
      │   ├── package.json
      │   ├── .git/
      │   └── ...
      └── bugfix-123/                # 버그픽스
          ├── src/
          ├── package.json
          ├── .git/
          └── ...
```

## 구체적인 예시

### Acme Corp - Alice의 todo-app

```
/workspaces/acme-corp/alice/todo-app/
  ├── config.json
  │
  ├── codebase/                      # 메인 브랜치
  │   ├── src/
  │   │   ├── app.ts
  │   │   └── utils.ts
  │   ├── package.json
  │   ├── .git/                      # Git 저장소
  │   └── node_modules/
  │
  └── features/                      # 피처 작업 디렉토리
      │
      ├── feature-login/             # alice의 로그인 기능 작업
      │   ├── src/
      │   │   ├── app.ts
      │   │   ├── utils.ts
      │   │   └── auth.ts           # 새로 추가한 파일
      │   ├── package.json
      │   ├── .git/                  # 별도 Git 브랜치
      │   └── node_modules/
      │
      └── feature-payment/           # alice의 결제 기능 작업
          ├── src/
          │   ├── app.ts
          │   ├── utils.ts
          │   └── payment.ts        # 새로 추가한 파일
          ├── package.json
          ├── .git/                  # 별도 Git 브랜치
          └── node_modules/
```

### Acme Corp - Bob의 blog

```
/workspaces/acme-corp/bob/blog/
  ├── config.json
  │
  ├── codebase/                      # 메인 브랜치
  │   ├── src/
  │   ├── package.json
  │   └── .git/
  │
  └── features/                      # bob은 현재 피처 작업 없음
```

## 경로 매핑

### 서버 키 → 파일 경로

```typescript
// 서버 키
serverKey = "acme-corp:alice:todo-app:feature-login"

// 워크스페이스 경로
workspacePath = "/workspaces/acme-corp/alice/todo-app/features/feature-login"

// 개발서버 실행 위치 (cwd)
devServerCwd = "/workspaces/acme-corp/alice/todo-app/features/feature-login"
```

### 특별한 경우: main/master 브랜치

```typescript
// 메인 브랜치는 features/ 밖
serverKey = "acme-corp:alice:todo-app:main"
workspacePath = "/workspaces/acme-corp/alice/todo-app/codebase"

// 또는 명시적으로 main을 features/ 안에?
workspacePath = "/workspaces/acme-corp/alice/todo-app/features/main"
```

## 코드 구현

### WorkspaceService에서 경로 생성

```typescript
// LocalWorkspaceService.ts
class LocalWorkspaceService implements WorkspaceServicePort {
  private getWorkspacePath(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): string {
    const basePath = this.basePath;  // /workspaces
    
    // feature가 'main'이면 codebase/ 사용
    if (feature === 'main' || feature === 'master') {
      return path.join(basePath, tenantId, userId, projectId, 'codebase');
    }
    
    // 그 외는 features/ 아래
    return path.join(basePath, tenantId, userId, projectId, 'features', feature);
  }
  
  async createFeatureWorkspace(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<WorkspaceHandle> {
    const workspacePath = this.getWorkspacePath(tenantId, userId, projectId, feature);
    
    // 디렉토리 생성
    await fs.promises.mkdir(workspacePath, { recursive: true });
    
    // 메인 코드베이스에서 복사 (Git worktree 또는 clone)
    const mainPath = path.join(this.basePath, tenantId, userId, projectId, 'codebase');
    await this.createFeatureBranch(mainPath, workspacePath, feature);
    
    return {
      tenantId,
      userId,
      projectId,
      feature,
      storagePath: workspacePath,
      createdAt: new Date()
    };
  }
  
  private async createFeatureBranch(
    mainPath: string,
    featurePath: string,
    branchName: string
  ): Promise<void> {
    // Git worktree로 피처 브랜치 작업 공간 생성
    // git worktree add ../features/feature-login -b feature-login
    
    // 또는 단순 복사 + 브랜치 체크아웃
    await execCommand(`cp -r ${mainPath} ${featurePath}`);
    await execCommand(`cd ${featurePath} && git checkout -b ${branchName}`);
  }
}
```

### DevServerService에서 경로 사용

```typescript
// DevServerService.ts
async startDevServer(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string,
  port?: number
): Promise<DevServerResult> {
  const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
  
  // WorkspaceService에서 올바른 경로 가져오기
  const workspacePath = this.getFeatureWorkspacePath(tenantId, userId, projectId, feature);
  // → /workspaces/acme-corp/alice/todo-app/features/feature-login
  
  // 개발서버 실행
  const devProcess = spawn('npm', ['run', 'dev', '--', '--port', devPort.toString()], {
    cwd: workspacePath,  // ✅ features/feature-login 에서 실행
    shell: true,
    env: {
      ...cleanEnv,
      PORT: devPort.toString()
    }
  });
  
  // ...
}

private getFeatureWorkspacePath(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string
): string {
  const basePath = process.env.ANT_WORKSPACE_BASE_PATH || '/workspaces';
  
  if (feature === 'main' || feature === 'master') {
    return path.join(basePath, tenantId, userId, projectId, 'codebase');
  }
  
  return path.join(basePath, tenantId, userId, projectId, 'features', feature);
}
```

## 사용 시나리오

### 1. Alice가 새 피처 작업 시작

```typescript
// 1. 피처 워크스페이스 생성
const handle = await workspaceService.createFeatureWorkspace(
  'acme-corp',
  'alice',
  'todo-app',
  'feature-login'
);

// 생성된 경로:
// /workspaces/acme-corp/alice/todo-app/features/feature-login

// 2. 개발서버 시작
const result = await devServerService.startDevServer(
  'acme-corp',
  'alice',
  'todo-app',
  'feature-login'
);

// 개발서버 실행 위치:
// cwd: /workspaces/acme-corp/alice/todo-app/features/feature-login
// port: 30001
// url: /dev/acme-corp:alice:todo-app:feature-login
```

### 2. Alice가 동일 프로젝트의 다른 피처 작업

```typescript
// feature-payment 워크스페이스 생성
const handle2 = await workspaceService.createFeatureWorkspace(
  'acme-corp',
  'alice',
  'todo-app',
  'feature-payment'
);

// 생성된 경로:
// /workspaces/acme-corp/alice/todo-app/features/feature-payment

// 개발서버 시작
const result2 = await devServerService.startDevServer(
  'acme-corp',
  'alice',
  'todo-app',
  'feature-payment'
);

// 결과:
// - feature-login: 30001번 포트, /workspaces/.../features/feature-login
// - feature-payment: 30002번 포트, /workspaces/.../features/feature-payment
```

### 3. 메인 브랜치 작업

```typescript
// 메인 브랜치는 codebase/ 사용
const result = await devServerService.startDevServer(
  'acme-corp',
  'alice',
  'todo-app',
  'main'  // ✅ 특별 처리
);

// 실행 위치:
// /workspaces/acme-corp/alice/todo-app/codebase
```

## Git Worktree (추천)

Git worktree를 사용하면 더 효율적:

```bash
# 메인 저장소
/workspaces/acme-corp/alice/todo-app/codebase/.git

# Worktree로 피처 브랜치 작업 공간 생성
cd /workspaces/acme-corp/alice/todo-app/codebase
git worktree add ../features/feature-login -b feature-login

# 결과:
/workspaces/acme-corp/alice/todo-app/
  ├── codebase/.git/           # 메인 Git 저장소
  └── features/
      └── feature-login/       # Worktree (같은 .git 공유)
```

**장점:**
- 디스크 공간 절약 (.git 공유)
- 브랜치 전환 빠름
- Git 히스토리 공유

## 환경 변수

```bash
# .env
ANT_WORKSPACE_BASE_PATH=/workspaces

# 또는 프로덕션
ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces
```

## 요약

### 올바른 경로 구조:
```
✅ /workspaces/{tenantId}/{userId}/{projectId}/features/{feature}
   /workspaces/acme-corp/alice/todo-app/features/feature-login

❌ /workspaces/{tenantId}/{userId}/{projectId}  (features/ 빠짐!)
   /workspaces/acme-corp/alice/todo-app
```

### 서버 키와 경로 매핑:
```typescript
serverKey: "acme-corp:alice:todo-app:feature-login"
    ↓
path: "/workspaces/acme-corp/alice/todo-app/features/feature-login"
```

### 특별한 경우:
```typescript
// 메인 브랜치
serverKey: "acme-corp:alice:todo-app:main"
    ↓
path: "/workspaces/acme-corp/alice/todo-app/codebase"
```

죄송합니다. 기존 구조를 제대로 파악하지 못했습니다! 🙏

