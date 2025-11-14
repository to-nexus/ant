# ANT Works Deployment Scenarios

이 문서는 ANT Works의 다양한 배포 시나리오와 각각의 장단점을 설명합니다.

## 📋 배포 시나리오 비교

| 시나리오 | Frontend (ant-ui) | Backend (ant-cli) | IDE | 인증 | 용도 |
|---------|-------------------|-------------------|-----|------|------|
| **1. Full Local** | localhost:4200 | localhost:4100 | ✅ 완전 지원 | ❌ 불필요 | 개발/로컬 작업 |
| **2. Cloud UI → Local Backend** | cloud | localhost:4100 | ⚠️ 제한적 | ❌ 불필요 | 로컬 파일 + Cloud UI |
| **3. Full Cloud** | cloud | cloud | ✅ 완전 지원 | ✅ 필요 | 팀 협업 |
| **4. Local UI → Cloud Backend** | localhost:4200 | cloud | ✅ 완전 지원 | ✅ 필요 | Cloud 개발/테스트 |

---

## 시나리오 1: Full Local (개발 환경)

**구성:**
```bash
# Backend
cd packages/ant-cli
ANT_SERVER_MODE=local pnpm dev:cli

# Frontend
cd packages/ant-ui
pnpm dev:ui  # 기본값: http://localhost:4100/api
```

**특징:**
- ✅ **파일 접근**: 로컬 파일시스템 직접 접근
- ✅ **IDE**: 완전 지원 (localhost:4400)
- ✅ **속도**: 가장 빠름
- ✅ **인증**: 불필요
- ✅ **네트워크**: 불필요

**추천 용도:**
- 로컬 개발
- 오프라인 작업
- 디버깅

---

## 시나리오 2: Cloud UI → Local Backend ⭐ **추천**

**구성:**
```bash
# Backend만 로컬 실행
cd packages/ant-cli
ANT_SERVER_MODE=local pnpm dev:cli

# Cloud UI 사용 (또는 로컬 개발)
cd packages/ant-ui
VITE_API_BASE=http://localhost:4100/api pnpm dev
```

**특징:**
- ✅ **파일 접근**: 로컬 파일시스템 직접 접근
- ✅ **Workspace**: `workspaces/local/<project>`
- ✅ **속도**: 빠름 (로컬 Backend)
- ✅ **인증**: 불필요
- ✅ **IDE**: **실제 IDE 완벽 지원** (Cursor, VS Code)
  - API를 통해 로컬 IDE 직접 실행
  - 파일 트리, 코드 편집 모두 정상 작동

**장점:**
- 🎯 **로컬 파일 작업** + Cloud UI 편의성
- 💰 Backend만 실행하면 되므로 리소스 효율적
- 🔒 로컬 데이터 완전 제어
- ⚡ **실제 IDE 사용** (더 빠르고 네이티브한 경험)

**추천 용도:**
- 개인 개발자가 Cloud UI를 사용하면서 로컬 파일 작업
- "백엔드만 띄우면 되는" 간편한 로컬 작업
- Cloud 서비스 비용 절감하면서 로컬 데이터 사용

**IDE 선택:**
- Local Backend 접속 시 자동으로 Cursor/VS Code 선택 UI 표시
- 설치된 IDE 자동 감지 및 선택 가능

---

## 시나리오 3: Full Cloud (프로덕션 환경)

**구성:**
```bash
# Backend (Cloud)
cd packages/ant-cli
ANT_SERVER_MODE=cloud pnpm start

# Frontend (Cloud)
cd packages/ant-ui
VITE_API_BASE=https://api.ant.nexus.ai/api pnpm build
```

**특징:**
- ✅ **파일 접근**: Cloud 워크스페이스
- ✅ **Workspace**: `workspaces/<org>/<user>/<project>`
- ✅ **IDE**: 완전 지원
- ✅ **인증**: `x-user-email` 헤더 (자동 추가)
- ✅ **협업**: 팀 작업 가능
- ✅ **접근성**: 어디서든 접근

**추천 용도:**
- 프로덕션 환경
- 팀 협업
- 원격 작업

---

## 시나리오 4: Local UI → Cloud Backend

**구성:**
```bash
# Frontend (로컬 개발)
cd packages/ant-ui
VITE_API_BASE=https://api.ant.nexus.ai/api pnpm dev

# Backend (Cloud)
# 별도 배포됨
```

**특징:**
- ✅ **IDE**: 완전 지원
- ✅ **인증**: 필요 (자동 처리)
- ✅ **개발**: Cloud API 테스트 용이

**추천 용도:**
- Frontend 개발
- Cloud API 테스트
- UI/UX 개발

---

## 🔧 구현 세부사항

### 1. 인증 헤더 자동 추가

Frontend가 Cloud Backend 접속 시 자동으로 인증 헤더 추가:

```typescript
// api.ts
function getAuthHeaders(): HeadersInit {
  try {
    const userEmail = localStorage.getItem('ant-ui:user-email');
    if (userEmail) {
      return { 'x-user-email': JSON.parse(userEmail) };
    }
  } catch (error) {
    console.warn('[API] Failed to get user email:', error);
  }
  return {};
}
```

### 2. CORS 설정

Backend가 모든 origin 허용:

```typescript
// ExpressServerAdapter.ts
this.app.use(cors()); // 모든 origin 허용
```

### 3. IDE 접근 제한 처리

Remote UI → Local Backend 시 IDE 경고:

```typescript
// ProjectSection.tsx
const isLocalhost = window.location.hostname === 'localhost';
if (!isLocalhost) {
  // IDE 기능 제한 경고 표시
}
```

---

## 🎯 사용 사례별 추천

### "로컬 파일로 작업하고 싶어요"
→ **시나리오 2** (Cloud UI → Local Backend)

### "팀과 협업하고 싶어요"
→ **시나리오 3** (Full Cloud)

### "개발 중인데 빠른 피드백이 필요해요"
→ **시나리오 1** (Full Local)

### "Cloud Backend API를 테스트하고 싶어요"
→ **시나리오 4** (Local UI → Cloud Backend)

---

## ⚠️ 주의사항

### IDE 기능 제한

**문제:**
- Cloud UI (https://ant.nexus.ai) → Local IDE (http://localhost:4400)
- 브라우저 Mixed Content 보안 정책으로 차단

**해결:**
- 파일 트리, 코드 편집은 정상 작동
- 완전한 IDE 기능이 필요하면 Local UI 사용

### 인증

- **Local Backend**: 인증 불필요
- **Cloud Backend**: `x-user-email` 헤더 필요 (자동 추가됨)

### Workspace 구조

- **Local**: `workspaces/local/<project>`
- **Cloud**: `workspaces/<org>/<user>/<project>`
- 다른 모드의 프로젝트는 보이지 않음

---

## 📚 관련 문서

- [Cloud Mode 가이드](./CLOUD_MODE.md)
- [환경 변수 설정](./ENV_VARIABLES.md)

