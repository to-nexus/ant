# Environment Setup Guide

## Overview

ANT Works는 Frontend와 Backend가 각각 독립적으로 환경을 설정합니다:

- **Frontend (`ant-ui`)**: 어느 백엔드에 연결할지 결정
- **Backend (`ant-cli`)**: 워크스페이스를 어떻게 관리할지 결정

## Frontend Configuration (`ant-ui`)

Frontend는 `.env` 파일로 연결할 백엔드와 UI 동작 모드를 결정합니다.

### 환경변수

`packages/ant-ui/.env` 파일을 생성하세요:

```bash
# API Base URL - 백엔드 서버 주소
VITE_API_BASE_URL=http://localhost:4100

# Deployment Mode - UI 동작 결정
# local: 로컬 IDE 사용 (Cursor, VS Code), 인증 불필요
# cloud: 웹 IDE 사용, 인증 필요
VITE_DEPLOYMENT_MODE=local
```

### 시나리오별 설정

#### 1. Local Development (로컬 개발)
```bash
VITE_API_BASE_URL=http://localhost:4100
VITE_DEPLOYMENT_MODE=local
```

- ✅ 로컬 백엔드에 연결
- ✅ 로컬 IDE (Cursor, VS Code) 사용
- ✅ 인증 불필요
- ✅ 파일 직접 접근

#### 2. Cloud UI + Local Backend (클라우드 UI에서 로컬 백엔드 사용)
```bash
VITE_API_BASE_URL=http://localhost:4100
VITE_DEPLOYMENT_MODE=local
```

- ✅ 로컬 백엔드에 연결
- ✅ 로컬 IDE 사용 가능
- ✅ 인증 불필요
- ⚠️ CORS 설정 필요

#### 3. Full Cloud (완전 클라우드)
```bash
VITE_API_BASE_URL=https://api.ant.works
VITE_DEPLOYMENT_MODE=cloud
```

- ✅ 클라우드 백엔드에 연결
- ✅ 웹 IDE (Docker) 사용
- ✅ 인증 필요 (이메일 기반)
- ✅ 멀티테넌시

## Backend Configuration (`ant-cli`)

Backend는 `.env` 파일로 워크스페이스 관리 모드를 결정합니다.

### 환경변수

`packages/ant-cli/.env` 파일을 생성하세요:

```bash
# Server Mode - 워크스페이스 관리 방식
# local: workspaces/local/, 인증 불필요
# cloud: workspaces/<org>/<user>/, 인증 필요
ANT_SERVER_MODE=local

# Workspace Root (optional, 기본값: ../../workspaces)
WORKSPACE_ROOT=../../workspaces

# Cloud URL (local mode일 때 redirect 대상)
CLOUD_URL=https://ant.works
```

### 시나리오별 설정

#### 1. Local Mode
```bash
ANT_SERVER_MODE=local
WORKSPACE_ROOT=../../workspaces
```

- ✅ `workspaces/local/` 사용
- ✅ 인증 불필요
- ✅ 단일 사용자

#### 2. Cloud Mode
```bash
ANT_SERVER_MODE=cloud
WORKSPACE_ROOT=../../workspaces
CLOUD_URL=https://ant.works
```

- ✅ `workspaces/<org>/<user>/` 사용
- ✅ 이메일 기반 인증
- ✅ 멀티테넌시
- ✅ 조직별 Vector DB 격리

## 배포 시나리오

### Scenario 1: 로컬 개발
```
Frontend: VITE_DEPLOYMENT_MODE=local + VITE_API_BASE_URL=http://localhost:4100
Backend:  ANT_SERVER_MODE=local
```

**특징:**
- 로컬 IDE 사용
- 인증 불필요
- 빠른 개발

### Scenario 2: 클라우드 UI + 로컬 백엔드
```
Frontend: VITE_DEPLOYMENT_MODE=local + VITE_API_BASE_URL=http://localhost:4100
Backend:  ANT_SERVER_MODE=local
```

**특징:**
- 배포된 UI 사용
- 로컬 파일 접근
- CORS 설정 필요

### Scenario 3: 완전 클라우드
```
Frontend: VITE_DEPLOYMENT_MODE=cloud + VITE_API_BASE_URL=https://api.ant.works
Backend:  ANT_SERVER_MODE=cloud
```

**특징:**
- 웹 IDE 사용
- 이메일 인증
- 멀티테넌시
- 프로덕션 환경

## 환경변수 파일 생성

### 1. Frontend 환경변수 생성

```bash
cd packages/ant-ui
cat > .env << 'EOF'
VITE_API_BASE_URL=http://localhost:4100
VITE_DEPLOYMENT_MODE=local
EOF
```

### 2. Backend 환경변수 생성

```bash
cd packages/ant-cli
cat > .env << 'EOF'
ANT_SERVER_MODE=local
WORKSPACE_ROOT=../../workspaces
CLOUD_URL=https://ant.works
EOF
```

## 실행

### Local Mode
```bash
# Terminal 1: Backend
cd packages/ant-cli
ANT_SERVER_MODE=local pnpm dev:cli

# Terminal 2: Frontend
cd packages/ant-ui
VITE_DEPLOYMENT_MODE=local pnpm dev:ui
```

### Cloud Mode
```bash
# Terminal 1: Backend
cd packages/ant-cli
ANT_SERVER_MODE=cloud pnpm dev:cli

# Terminal 2: Frontend
cd packages/ant-ui
VITE_DEPLOYMENT_MODE=cloud pnpm dev:ui
```

## 주의사항

1. **.env 파일은 Git에 커밋하지 마세요** (`.gitignore`에 포함됨)
2. **프로덕션 환경에서는 반드시 환경변수를 설정**하세요
3. **Frontend와 Backend의 모드가 일치하지 않아도 됩니다** (독립적으로 동작)
4. **API_BASE_URL은 반드시 Backend 주소와 일치**해야 합니다

## 트러블슈팅

### 401 Unauthorized 에러
- Frontend의 `VITE_DEPLOYMENT_MODE`가 `cloud`인데 로그인하지 않은 경우
- Backend의 `ANT_SERVER_MODE`가 `cloud`인데 인증 헤더가 없는 경우

**해결:**
- Local 개발: 두 환경변수 모두 `local`로 설정
- Cloud 환경: 로그인 후 사용

### CORS 에러
- Cloud UI에서 Local Backend 사용 시 발생 가능

**해결:**
- Backend의 CORS 설정 확인
- `ExpressServerAdapter.ts`에서 `cors()` 미들웨어 활성화

### 로컬 IDE가 열리지 않음
- `VITE_DEPLOYMENT_MODE=cloud`로 설정된 경우
- IDE가 설치되지 않은 경우

**해결:**
- Local Backend 사용 시: `VITE_DEPLOYMENT_MODE=local`로 설정
- IDE 설치 확인: Cursor, VS Code

## 참고 문서

- [Cloud Mode 상세 가이드](./CLOUD_MODE.md)
- [환경변수 전체 목록](./ENV_VARIABLES.md)
- [배포 시나리오](./DEPLOYMENT_SCENARIOS.md)

