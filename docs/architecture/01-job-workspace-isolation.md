# Job 실행 시 Workspace 격리 정책

## 현재 구조 (실제 작동 중)

### Workspace 디렉토리 구조
```
{ANT_WORKSPACE_BASE_PATH}/
  └── {tenantId}/
      └── {userId}/
          └── {projectId}/
              ├── config.json
              ├── codebase/              # main 브랜치
              └── features/              # 피처별 작업 디렉토리
                  ├── feature-login/
                  ├── feature-payment/
                  └── bugfix-123/
```

### 실제 예시
```
/workspaces/acme-corp/alice/todo-app/
  ├── config.json
  ├── codebase/              # main 브랜치 코드
  └── features/
      ├── feature-login/     # alice의 로그인 기능 작업
      └── feature-payment/   # alice의 결제 기능 작업
```

## Job 실행 시 환경 격리

### 1. 환경변수 격리

```typescript
// ExpressServerAdapter.runJob()
const childEnv: Record<string, string> = {
  // ✅ 시스템 필수 변수만 화이트리스트
  PATH: ensuredPath,
  HOME: process.env.HOME || '/tmp',
  USER: process.env.USER || 'ant',
  LANG: 'en_US.UTF-8',
  
  // ✅ Node.js 설정
  NODE_ENV: process.env.NODE_ENV || 'production',
  
  // ✅ Job별 독립 변수 (매번 새로 생성)
  ANT_JOB_ID: jobId,
  ANT_API_URL: process.env.ANT_API_URL || `http://localhost:${process.env.PORT || '4100'}`,
  ANT_PROJECT_ID: params.project || '',
  ANT_FEATURE_NAME: params.feature || '',
  ANT_PROJECT_PATH: projectPath,              // /workspaces/.../codebase
  ANT_FEATURE_PATH: featurePath,              // /workspaces/.../features/feature-login
  
  // ✅ 사용자 컨텍스트 (멀티테넌시)
  ANT_USER_EMAIL: `${userId}@${tenantId}`,
  
  // ✅ Job 특정 옵션
  ANT_OVERRIDE_DIRECTIVE: params.overrideDirective || '',
  ANT_CHAT_SOURCE: params.chatSource ? 'true' : 'false'
};

// ❌ ...process.env 사용 안 함 → 완전 격리
```

### 2. 작업 디렉토리 (cwd) 격리

```typescript
// Job은 프로젝트 루트에서 실행
const childProcess = spawn('npx', ['tsx', ...args], {
  cwd: process.cwd(),  // /Users/probe/dev/ant/packages/ant-cli (ant-cli 소스)
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

**중요**: Job은 ant-cli 소스에서 실행되지만, 파일 작업은 `ANT_FEATURE_PATH`로 이루어짐

### 3. 파일 작업 격리

```typescript
// Agent가 파일 작업할 때
const featurePath = process.env.ANT_FEATURE_PATH;
// → /workspaces/acme-corp/alice/todo-app/features/feature-login

// FileSystemPort가 이 경로 내부로만 작업 제한
await fileSystem.writeFile('src/app.ts', code);
// → /workspaces/.../features/feature-login/src/app.ts

// Path traversal 방어: '../../other-user/file.txt' → 차단됨
```

## Multi-Tenancy 격리

### 조직(Tenant) 레벨
- 조직마다 독립된 디렉토리: `/workspaces/{tenantId}/`
- 조직 A는 조직 B의 파일에 접근 불가

### 사용자(User) 레벨
- 사용자마다 독립된 디렉토리: `/workspaces/{tenantId}/{userId}/`
- 같은 조직이어도 alice는 bob의 파일에 접근 불가

### 프로젝트(Project) 레벨
- 프로젝트마다 독립된 디렉토리: `/workspaces/{tenantId}/{userId}/{projectId}/`
- 프로젝트 A 작업이 프로젝트 B에 영향 없음

### 피처(Feature) 레벨
- 피처마다 독립된 디렉토리: `/workspaces/.../features/{feature}/`
- feature-login 작업이 feature-payment에 영향 없음
- 동시에 여러 피처 작업 가능

## Job 실행 플로우

```
1. 사용자 요청
   POST /projects/todo-app/features/feature-login/execute
   { task: 'code', agent: 'architect' }

2. 중복 체크
   feature-login에 이미 실행 중인 job 있는지 확인
   ✅ 없으면 진행, ❌ 있으면 409 에러

3. WorkspaceResolver 경로 확인
   tenantId: acme-corp
   userId: alice
   projectId: todo-app
   feature: feature-login
   → featurePath: /workspaces/acme-corp/alice/todo-app/features/feature-login

4. Job 환경 생성
   - jobId 생성 (uuid)
   - 격리된 환경변수 생성 (childEnv)
   - ANT_FEATURE_PATH 설정

5. Child process 실행
   npx tsx src/composition/orchestrator.ts
   - cwd: ant-cli 소스
   - env: 격리된 childEnv
   - stdio: pipe (로그 캡처)

6. Agent 실행
   - ANT_FEATURE_PATH에서 파일 읽기/쓰기
   - Git 작업 (commit, push)
   - 로그를 parent process로 전송

7. Job 완료
   - Child process 종료
   - 로그 저장
   - 리소스 정리
```

## 환경 설정

```bash
# .env
ANT_WORKSPACE_BASE_PATH=/workspaces           # 워크스페이스 루트 (기본값)
ANT_API_URL=http://localhost:4100             # API 서버 URL (로컬) 또는 http://ant-api:8080 (K8s)
NODE_ENV=production

# 로컬 환경에서 npm 스크립트가 PORT 지정 (package.json)
# PORT=4100 npm run start:server
# PORT=4101 npm run start:realtime-server
# PORT=4102 npm run start:preview-server
```

### 프로덕션 환경
```bash
# 별도 마운트된 대용량 스토리지
ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces  # EBS, NFS 등
```

## 보안 및 격리 보장

### 1. Path Traversal 방어
```typescript
// FileSystemPort가 자동 검증
validatePath(filePath: string) {
  const fullPath = path.join(this.basePath, filePath);
  const normalized = path.normalize(fullPath);
  
  if (!normalized.startsWith(this.basePath)) {
    throw new Error('Path traversal detected');
  }
}
```

### 2. 프로세스 격리
- 각 Job은 독립된 child process
- 환경변수 완전 격리 (화이트리스트)
- stdout/stderr 파이프로 로그 수집

### 3. 파일시스템 격리
- 각 피처는 독립된 디렉토리
- FileSystemPort가 디렉토리 경계 강제
- Git 저장소도 피처별 독립

### 4. 리소스 제한 (향후)
```typescript
// Job당 리소스 제한
const childProcess = spawn('npx', ['tsx', ...args], {
  // CPU, 메모리 제한 (Docker 또는 cgroups)
  timeout: 30 * 60 * 1000,  // 30분 타임아웃
});
```

## 현재 제한사항 및 개선 사항

### 현재 작동
- ✅ 환경변수 격리 (화이트리스트)
- ✅ 파일 작업 격리 (features/ 디렉토리)
- ✅ Job별 독립 실행
- ✅ Multi-tenancy 지원
- ✅ 동일 프로젝트 여러 피처 동시 작업

### 향후 개선
- ⏰ Docker 컨테이너 격리 (완전한 격리)
- ⏰ CPU/메모리 제한 (리소스 쿼터)
- ⏰ 네트워크 격리 (필요시)
- ⏰ 디스크 쿼터 (테넌트별)

## 요약

| 항목 | 격리 방법 |
|------|----------|
| **환경변수** | 화이트리스트 방식, Job별 독립 생성 |
| **파일시스템** | features/{feature}/ 디렉토리 격리 |
| **프로세스** | 독립 child process |
| **테넌트** | /workspaces/{tenantId}/{userId}/ 물리적 분리 |
| **프로젝트** | {projectId}/ 디렉토리 분리 |
| **피처** | features/{feature}/ 디렉토리 분리 |

**핵심**: 각 Job은 완전히 독립된 환경에서 실행되며, 다른 Job이나 테넌트에 영향을 주지 않습니다.

