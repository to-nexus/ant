# Cloud Mode 가이드

## 개요

ANT CLI는 Local Mode와 Cloud Mode를 지원합니다.

### 핵심 차이점

| 항목 | Local Mode | Cloud Mode |
|------|------------|------------|
| Workspace 경로 | `workspaces/local/<project>` | `workspaces/<org>/<user>/<project>` |
| 인증 | 없음 | 이메일 헤더 필수 (`x-user-email`) |
| 사용자 격리 | 단일 사용자 | 다중 사용자 격리 |
| Vector DB | 로컬 연결 | 조직별 격리 |

### 공통 사항

- Job Queue 방식 동일
- 모든 비즈니스 로직 동일
- Vector DB, Redis 연결 설정만 다름

## Local Mode 실행

```bash
# 기본값 (Local Mode)
pnpm dev:cli

# 명시적 지정
ANT_SERVER_MODE=local CLOUD_URL=https://ant.nexus.ai pnpm dev:cli
```

**특징:**
- 인증 불필요
- `workspaces/local/` 디렉토리 사용
- 단일 사용자
- **Root 경로(`/`) 접속 시 Cloud URL로 자동 redirect**

## Cloud Mode 실행

```bash
ANT_SERVER_MODE=cloud WORKSPACE_ROOT=./workspaces pnpm dev:cli
```

**특징:**
- 이메일 헤더 인증 필수
- `workspaces/<org>/<user>/<project>` 구조
- 다중 사용자 격리
- **`/local` 경로에서 Local Mode 안내 페이지 제공**

### 인증 방법

모든 API 요청에 `x-user-email` 헤더 필요:

```bash
curl -H "x-user-email: alice@nexus.ai" http://localhost:4100/api/projects
```

**이메일 파싱 규칙:**
- `username@organization.domain.com`
- Username: `username`
- Organization: 초기 버전에서는 모두 `nexus`로 할당

## 환경 변수

```bash
# 서버 모드 ('local' 또는 'cloud')
ANT_SERVER_MODE=local

# 클라우드 서비스 URL (Local 모드에서 redirect용)
CLOUD_URL=https://ant.nexus.ai

# 서버 포트
PORT=4100

# Workspace 루트 디렉토리
# Local: workspaces/local/
# Cloud: workspaces/<org>/<user>/
WORKSPACE_ROOT=../../workspaces

# LLM 설정 (기존과 동일)
AI_MODEL_PROVIDER=openai
AI_MODEL_NAME=gpt-4
```

## Workspace 구조

### Local Mode

```
workspaces/
└─ local/                           # Local user
    └─ simple-scheduler/
        ├─ config.json
        ├─ features/
        │   └─ auth-system/
        │       ├─ artifacts/
        │       └─ kanban.json
        └─ codebase/
```

### Cloud Mode

```
workspaces/
└─ to.nexus/                        # Organization
    ├─ alice/                       # User
    │   ├─ project-a/
    │   │   ├─ config.json
    │   │   ├─ features/
    │   │   └─ codebase/
    │   └─ project-b/
    └─ bob/
        └─ project-c/
```

## API 예시

### Local Mode

```bash
# Health check
curl http://localhost:4100/api/health

# 프로젝트 목록
curl http://localhost:4100/api/projects

# 프로젝트 생성
curl -X POST http://localhost:4100/api/projects \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project"}'
```

### Cloud Mode

```bash
# Health check (인증 불필요)
curl http://localhost:4100/api/health

# 프로젝트 목록 (인증 필요)
curl -H "x-user-email: alice@nexus.ai" \
  http://localhost:4100/api/projects

# 프로젝트 생성 (인증 필요)
curl -X POST http://localhost:4100/api/projects \
  -H "x-user-email: alice@nexus.ai" \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project"}'
```

## 아키텍처

### WorkspaceResolver 패턴

```typescript
interface WorkspaceResolver {
  getWorkspacePath(context: UserContext): string;
  getProjectPath(context: UserContext, projectId: string): string;
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string;
}

// Local Mode
class LocalWorkspaceResolver implements WorkspaceResolver {
  getWorkspacePath(context) {
    return workspaceRoot; // workspace/
  }
  
  getProjectPath(context, projectId) {
    return `workspace/${projectId}`;
  }
}

// Cloud Mode
class CloudWorkspaceResolver implements WorkspaceResolver {
  getWorkspacePath(context) {
    return `workspaces/${context.org}/${context.user}`;
  }
  
  getProjectPath(context, projectId) {
    return `workspaces/${context.org}/${context.user}/${projectId}`;
  }
}
```

### 단일 ServerAdapter

- **단일 ExpressServerAdapter**로 Local/Cloud 모두 처리
- **WorkspaceResolver**로 경로 계산 위임
- **Optional Auth Middleware**로 Cloud mode 인증 처리

## 향후 확장

### Phase 1 (현재)
- ✅ Local/Cloud 모드 구분
- ✅ 경로 기반 사용자 격리
- ✅ 이메일 인증

### Phase 2
- Job Queue (Bull + Redis)
- 조직별 Vector DB 격리
- 사용자 권한 관리

### Phase 3
- Scale-out 준비
- Load Balancer
- Shared File System (NFS/S3)
- Metadata DB

## 문제 해결

### Cloud Mode에서 401 에러

**원인**: `x-user-email` 헤더 누락

**해결**:
```bash
curl -H "x-user-email: your-email@org.domain" [URL]
```

### Workspace 경로 오류

**원인**: `WORKSPACE_ROOT` 설정 오류

**해결**:
```bash
# Local
export WORKSPACE_ROOT=./workspace

# Cloud
export WORKSPACE_ROOT=./workspaces
```

### 이메일 형식 오류

**원인**: 잘못된 이메일 형식

**해결**: `username@organization.domain` 형식 사용

## 새로운 기능

### Local Mode: Root Redirect

Local Mode에서 서버의 root 경로(`http://localhost:4100/`)에 접속하면 자동으로 Cloud 서비스로 redirect됩니다.

```bash
# Local Mode 시작
ANT_SERVER_MODE=local CLOUD_URL=https://ant.nexus.ai pnpm dev:cli

# 브라우저에서 http://localhost:4100/ 접속
# → https://ant.nexus.ai 로 자동 redirect
```

이를 통해 사용자가 Local 서버로 잘못 접속했을 때 자동으로 Cloud 서비스로 유도할 수 있습니다.

### Cloud Mode: Local 안내 페이지

Cloud Mode에서는 `/local` 경로에 접속하면 Local Mode 실행 방법을 안내하는 페이지가 표시됩니다.

```bash
# Cloud Mode 시작
ANT_SERVER_MODE=cloud pnpm dev:cli

# 브라우저에서 http://localhost:4100/local 접속
# → Local Mode 설치/실행 가이드 표시
```

**안내 페이지 내용:**
- Local Mode 설치 방법
- GitHub 저장소 링크
- Local vs Cloud 비교표
- 사용 시나리오별 추천

## 테스트

```bash
# Local Mode 테스트
ANT_SERVER_MODE=local CLOUD_URL=https://ant.nexus.ai pnpm dev:cli

# Health check
curl http://localhost:4100/api/health

# Root redirect 테스트
curl -I http://localhost:4100/  # → Location: https://ant.nexus.ai

# Cloud Mode 테스트
ANT_SERVER_MODE=cloud pnpm dev:cli

# Health check (인증 불필요)
curl http://localhost:4100/api/health

# /local 페이지 접속 (인증 불필요)
curl http://localhost:4100/local

# API 호출 (인증 필요)
curl -H "x-user-email: test@nexus.ai" http://localhost:4100/api/projects
```

## 참고

- [구현 계획서](./cloud-mode-implementation-plan.md)
- [Main README](../README.md)

