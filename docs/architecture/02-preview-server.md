# Preview Server 아키텍처

## 1. 개요

사용자가 생성한 코드의 실시간 미리보기를 제공하는 시스템입니다. 각 피처별로 독립된 Dev Server(Vite, Next.js 등)를 실행하고, 프록시를 통해 브라우저에서 접근할 수 있게 합니다.

### 핵심 특징

- **별도 호스트 기반 라우팅**: `ant-preview.crosstoken.io` → ant-preview 서비스 전용
- **멀티 패키지 지원**: Frontend + Backend 동시 실행 (Fullstack, Monorepo)
- **동적 포트 할당**: 30000-39999 범위 자동 할당
- **프록시 접근**: `/:serverKey/*` — 프로젝트+피처별 독립 URL
- **Multi-Pod 지원**: Redis 기반 상태 관리, Sticky Session 불필요
- **SSR 호환**: 별도 호스트 + Referer 기반 라우팅으로 SSR 리소스 정상 로드

---

## 2. 아키텍처

### 2.1 서버 키 구조

```
{tenantId}:{userId}:{projectId}:{feature}

예시: to.nexus:probe:ant-prediction:localtest
```

### 2.2 시스템 구성

```
┌────────────────────────────────────────────────────────────────┐
│ Frontend (ant-ui)                                              │
│  ├─ PreviewPanel              # 미리보기 UI (iframe)          │
│  ├─ usePreviewManager         # 상태 관리 & 폴링              │
│  └─ PreviewStatusPanel         # 진행 상황 표시               │
└────────────────────────────────────────────────────────────────┘
                              ↓ HTTP API
┌────────────────────────────────────────────────────────────────┐
│ ant-preview (Express, 포트 8080)                               │
│  ├─ Preview API               # 시작/중지/상태 엔드포인트    │
│  ├─ PreviewService            # Preview 생명주기 관리        │
│  ├─ PreviewProxy              # /:serverKey/* 프록시          │
│  ├─ PortManager               # 동적 포트 할당               │
│  └─ RedisStateStore           # 상태 관리 (PortRegistry)     │
└────────────────────────────────────────────────────────────────┘
                              ↓ Spawn (Child Process)
┌────────────────────────────────────────────────────────────────┐
│ Dev Servers (사용자 코드 실행)                                  │
│  ├─ web-client:30001          # Frontend (Entry)              │
│  ├─ api-server:30002          # Backend                       │
│  └─ admin:30003               # Additional packages           │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. 라우팅 아키텍처

### 3.1 호스트 분리 전략

Preview 서비스는 **별도 호스트**(`ant-preview.crosstoken.io`)를 사용합니다.

```
호스트별 라우팅 (ALB):
  ant.crosstoken.io          →  ant-api (프론트엔드 + API)
  ant-preview.crosstoken.io  →  ant-preview (Preview 전용)
  ant-server.crosstoken.io   →  ant-api (API 서버)
```

### 3.2 왜 별도 호스트가 필요한가?

#### 문제: SSR 앱의 절대 경로 리소스

SSR 프레임워크(Next.js 등)는 HTML에 절대 경로로 리소스를 참조합니다:

```html
<!-- Next.js SSR이 생성하는 HTML -->
<script src="/_next/static/chunks/main-abc123.js"></script>
<link href="/_next/static/css/style.css" rel="stylesheet">
<img src="/logos/header-logo.svg">
```

같은 호스트(`ant.crosstoken.io`)를 쓰면:

```
브라우저: ant.crosstoken.io/_next/static/chunks/main.js
    ↓
ALB: /* 규칙 → ant-api로 라우팅
    ↓
ant-api: 401 Unauthorized (Preview 리소스가 아님!)
```

ALB Controller는 **URI 기반 라우팅만 지원**하므로 Referer 헤더를 볼 수 없습니다.

#### 해결: 별도 호스트

별도 호스트를 쓰면:

```
브라우저: ant-preview.crosstoken.io/_next/static/chunks/main.js
    ↓
ALB: 호스트 = ant-preview.crosstoken.io → ant-preview로 라우팅
    ↓
ant-preview Express 앱: 요청 수신 성공!
```

**호스트 기반 라우팅은 ALB가 네이티브로 지원**합니다. 추가 인프라(API Gateway, istio 등) 불필요.

### 3.3 리소스 요청 흐름 (상세)

Preview에서 발생하는 요청은 두 종류입니다:

#### Case A: serverKey가 경로에 있는 요청 (정상)

```
브라우저:  ant-preview.crosstoken.io/org:user:proj:feat/
    ↓
ALB:  호스트 기반 → ant-preview
    ↓
Express PreviewProxy:
    1. 경로에서 serverKey 추출: "org:user:proj:feat"
    2. Redis 조회: serverKey → { host: Pod_A_IP, port: 30001 }
    3. http://Pod_A_IP:30001/ 로 프록시
    ↓
Dev Server: HTML 응답 반환
    ↓
Express PreviewProxy:
    4. HTML 내 절대 경로를 serverKey prefix로 재작성
       /_next/chunk.js → /org:user:proj:feat/_next/chunk.js
    5. 클라이언트 스크립트 주입 (fetch/XHR 인터셉트)
    ↓
브라우저: 재작성된 HTML 수신
```

#### Case B: serverKey가 없는 요청 (SSR 리소스 누출)

경로 재작성을 빠져나간 절대 경로 요청:

```
브라우저:  ant-preview.crosstoken.io/_next/static/chunks/main.js
    ↓
ALB:  호스트 기반 → ant-preview ✅ (별도 호스트라서 가능!)
    ↓
Express PreviewProxy:
    1. 경로에 serverKey 없음
    2. Referer 헤더 확인:
       "https://ant-preview.crosstoken.io/org:user:proj:feat/"
    3. Referer에서 serverKey 추출: "org:user:proj:feat"
    4. Redis 조회: serverKey → { host: Pod_A_IP, port: 30001 }
    5. http://Pod_A_IP:30001/_next/static/chunks/main.js 로 프록시
    ↓
Dev Server: JS 파일 반환
    ↓
브라우저: 리소스 정상 로드 ✅
```

**핵심**: Referer 기반 라우팅은 ALB가 아닌 **Express 앱 레벨**에서 수행됩니다.
별도 호스트 덕분에 요청이 Express 앱까지 도달할 수 있습니다.

### 3.4 방어 계층 정리

| 계층 | 역할 | 처리 방식 |
|------|------|-----------|
| **1. 경로 재작성** | HTML/JS/CSS의 절대 경로를 `/:serverKey/` prefix로 변환 | 서버 사이드 (PreviewProxy) |
| **2. 클라이언트 스크립트** | React hydration, 런타임 fetch/XHR 인터셉트 | `<head>`에 주입된 JS |
| **3. Referer 기반 라우팅** | 1, 2를 빠져나간 절대 경로 요청 처리 | Express 앱 레벨 |
| **4. 별도 호스트** | 3이 작동하려면 요청이 ant-preview에 도달해야 함 | ALB 호스트 기반 라우팅 |

계층 1, 2가 대부분의 요청을 처리하고, 누출된 요청은 계층 3이 Referer로 복구합니다.
계층 4(별도 호스트)는 계층 3이 작동할 수 있도록 **모든 요청이 ant-preview에 도달하는 것을 보장**합니다.

---

## 4. 프록시 구현

### 4.1 PreviewProxy 미들웨어

```typescript
// previewProxy.ts — 핵심 로직

export function createPreviewProxyMiddleware(config: PreviewProxyConfig) {
  return async (req, res, next) => {

    // ── Case B: serverKey 없는 요청 (SSR 리소스 누출) ──
    if (!hasPreviewPrefix && (isNextInternal || isStaticAsset || hasStaticExt)) {
      const referer = req.headers.referer;
      // Referer에서 serverKey 추출
      const refererMatch = referer.match(/\/([^/]+)/);  // 첫 번째 path segment
      // Redis 조회 → 올바른 dev server로 프록시
      const mapping = await portRegistry.getPreview(tenantId, userId, projectId, feature);
      const targetUrl = `http://${mapping.host}:${mapping.port}${req.url}`;
      // ... 프록시 수행
    }

    // ── Case A: serverKey 있는 요청 (정상) ──
    const serverKey = extractServerKeyFromPath(req.url);
    const mapping = await portRegistry.getPreview(...parsed);
    const targetUrl = `http://${host}:${port}${targetPath}`;

    // HTML 응답: 경로 재작성 + 클라이언트 스크립트 주입
    if (contentType.includes('text/html')) {
      // 절대 경로 → /:serverKey/ prefix 추가
      rewritten = rewriteAbsolutePaths(text, serverKey);
      // fetch/XHR 인터셉트 스크립트 주입
      rewritten = injectClientScript(rewritten, serverKey);
    }
  };
}
```

### 4.2 경로 재작성 대상

| 대상 | 예시 | 변환 결과 |
|------|------|-----------|
| HTML `src`, `href`, `action` | `src="/_next/chunk.js"` | `src="/:serverKey/_next/chunk.js"` |
| JS `import`, `from` | `import '/utils.js'` | `import '/:serverKey/utils.js'` |
| JS `import()` | `import('/lazy.js')` | `import('/:serverKey/lazy.js')` |
| CSS `url()` | `url(/bg.png)` | `url(/:serverKey/bg.png)` |
| Next.js 내부 | `"/_next/static/..."` | `"/:serverKey/_next/static/..."` |
| 정적 리소스 | `"/logos/header.svg"` | `"/:serverKey/logos/header.svg"` |

### 4.3 클라이언트 스크립트 (HTML에 주입)

React hydration이 서버 사이드에서 재작성한 경로를 원래대로 되돌리는 문제를 방지합니다:

```javascript
// HTML <head>에 자동 주입되는 스크립트
(function() {
  var BASE = "/:serverKey";

  // 경로에 serverKey가 없으면 추가
  function rewrite(path) {
    if (path.startsWith('/') && !path.startsWith(BASE)) {
      return BASE + path;
    }
    return path;
  }

  // fetch 인터셉트
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rewrite(input);
    return origFetch.call(this, input, init);
  };

  // XHR 인터셉트
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rewrite(url);
    return origOpen.apply(this, arguments);
  };

  // DOM 변경 감시 (React hydration 대응)
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(fixEl);
      if (m.attributeName === 'src' || m.attributeName === 'href') {
        fixEl(m.target);
      }
    });
  });

  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'href']
  });

  window.__BASENAME__ = BASE;
})();
```

---

## 5. Preview 생명주기

### 5.1 상태 전이 (Phase)

Preview는 다음 상태를 순서대로 거칩니다. 백엔드가 `phase` 필드로 명시적으로 전달합니다.

```
idle → installing → starting → running
                        │           │
                        ▼           ▼
                      error ←──── error (health check fail → cleanup)
```

| Phase | 의미 | UI 표시 |
|-------|------|---------|
| `idle` | 실행 대기 | Start 버튼 활성 |
| `installing` | npm install 진행 중 (타임아웃: 3분) | 진행률 표시 |
| `starting` | 프로세스 실행 + Health check 대기 (최대 60초) | 스피너 |
| `running` | Health check 통과, Dev server 정상 | Open 버튼 |
| `error` | 실패 (install/health check/프로세스 크래시) | 에러 메시지 |

### 5.2 시작 흐름

```
1. 사용자: "Start Preview" 클릭
   ↓
2. Frontend: POST /preview/projects/:id/start { feature: "localtest" }
   ↓
3. 분산 락 획득 (Redis SET NX, TTL 120s) — 다른 Pod 중복 방지
   ↓
4. ant-preview: 프로젝트 구조 감지
   → { type: 'fullstack', packages: [frontend, backend], entry: frontend }
   ↓
5. 의존성 설치 (npm install, 타임아웃 3분) — 패키지별 순차
   로그: "📦 Installing dependencies for web-client..."
   ↓
6. Dev Server 기동 (npm run dev --host 0.0.0.0)
   로그: "🚀 Starting web-client (frontend) on port 30001..."
   ↓
7. Redis에 PreviewState 등록
   { host: Pod_A_IP, port: 30001, running: true, ready: false }
   ↓
8. Health Check (최대 60초, 1초 간격)
   ├── 성공 → { running: true, ready: true } → 분산 락 해제
   └── 실패 → 모든 프로세스 kill → 상태 정리 → 에러 broadcast → 분산 락 해제
   ↓
9. URL 반환: /org:user:proj:feat
```

### 5.3 에러 처리 및 자동 정리

| 상황 | 처리 |
|------|------|
| npm install 실패 (exit code ≠ 0) | 에러 broadcast, 분산 락 해제, UI에 에러 표시 |
| npm install 타임아웃 (3분) | 프로세스 SIGTERM → SIGKILL, 에러 broadcast |
| Health check 실패 (60초) | 모든 프로세스 kill, Redis unregister, 에러 broadcast |
| 프로세스 비정상 종료 | 모든 프로세스 사망 시 자동 cleanup (Map, Redis, Port) |
| stopPreview 중 startPreview 진행 | cancel 플래그로 start 완료 후 자동 정리 |
| 분산 락 Pod 크래시 | TTL 120초 만료 후 다른 Pod에서 재시도 가능 |

### 5.4 Cross-Pod 상태 조회

Multi-Pod 환경에서 GET `/projects/:id/status`는 다음 순서로 조회합니다:

```
1. 로컬 메모리 확인 → 있으면 반환 (+ logs)
2. Redis fallback → 있으면 반환 (logs 없음, 다른 Pod에서 실행 중)
3. 둘 다 없으면 → { running: false }
```

이로써 ALB round-robin으로 다른 Pod가 status를 받아도 정확한 상태를 반환합니다.

### 5.5 프로젝트 구조 감지

| 타입 | 판단 기준 | Entry | 기동 패키지 |
|------|-----------|-------|------------|
| **Frontend-Only** | React/Vue/Vite | root | root |
| **Backend-Only** | Express/NestJS | root | root |
| **Fullstack** | Frontend + Backend 디렉토리 | Frontend | 모두 |
| **Monorepo** | `workspaces` 설정 | 첫 Frontend | dev script 있는 모두 |

### 5.6 Fullstack 지원

Fullstack 프로젝트에서는 Frontend와 Backend를 동시 실행합니다:

```
/:serverKey/           → Frontend (port 30001)
/:serverKey/page       → Frontend (port 30001)
/:serverKey/api/*      → Backend  (port 30002)
```

PreviewProxy가 `targetPath`를 분석하여 `/api/*` 요청만 Backend 포트로 분기합니다.

### 5.7 API 엔드포인트

```bash
# 시작
POST /preview/projects/:id/start
Body: { feature: "localtest" }
Response: { success: true, port: 30001, url: "/org:user:proj:localtest" }

# 중지
POST /preview/projects/:id/stop
Body: { feature: "localtest" }

# 상태 조회 (폴링 + SSE 보완)
GET /preview/projects/:id/status?feature=localtest
Response: {
  running: true,
  ready: true,
  phase: "running",   // idle | installing | starting | running | error
  error: null,        // 에러 시 메시지 포함
  port: 30001,
  url: "/org:user:proj:localtest",
  packages: [
    { name: "web-client", type: "frontend", port: 30001, status: "running" }
  ],
  logs: [...]
}
```

### 5.5 Idle Timeout

마지막 접근으로부터 30분 경과 시 자동 종료:

```typescript
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30분

// PreviewProxy에서 요청 시마다 lastAccessedAt 갱신
await portRegistry.touchPreview(tenantId, userId, projectId, feature);

// 주기적으로 idle 체크
async function checkIdleInstances() {
  const previews = await stateStore.listPreviews();
  for (const preview of previews) {
    if (now - preview.lastAccessedAt > IDLE_TIMEOUT_MS) {
      await previewService.stop(...);
    }
  }
}
```

---

## 6. Multi-Pod 아키텍처

### 6.1 Redis 기반 상태 관리

```typescript
interface PreviewState {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;           // Dev Server 포트 (30000+)
  host: string;           // Pod IP (0.0.0.0에서 listen)
  running: boolean;
  ready: boolean;
  backendPort?: number;   // Fullstack: Backend 포트
  packages?: Package[];   // 패키지 목록
  startedAt?: number;
  lastAccessedAt?: number;
}
```

### 6.2 Cross-Pod 프록시

```
ant-preview Pod A                    ant-preview Pod B
├── PreviewService                   ├── PreviewService
├── Dev Server (port 30001)          ├── Dev Server (port 30004)
│   └── 0.0.0.0:30001 listen        │   └── 0.0.0.0:30004 listen
└── Redis 등록:                      └── Redis 등록:
    host=Pod_A_IP, port=30001            host=Pod_B_IP, port=30004
         │                                    │
         └────────────┬───────────────────────┘
                      ▼
                 Redis (상태 공유)
```

**요청 흐름:**
1. ALB가 Round-robin으로 아무 Pod에 요청 전달
2. 해당 Pod가 Redis에서 serverKey → { host, port } 조회
3. 실제 Dev Server가 돌고 있는 Pod IP로 프록시 (Cross-Pod)

**Sticky Session 불필요**: 어떤 Pod가 받아도 Redis 조회 후 올바른 Pod로 프록시합니다.

---

## 7. Basename Validation

### 7.1 개요

SPA 프레임워크의 Router는 기본적으로 `/` 기준으로 경로를 처리합니다.
Preview 프록시 환경(`/:serverKey/`)에서 정상 작동하려면 `basename` 설정이 필요합니다.

### 7.2 검증 대상

| 프로젝트 타입 | Entry 타입 | Validation 실행 여부 |
|--------------|-----------|-------------------|
| Frontend-Only | frontend | ✅ 실행 |
| Fullstack | frontend | ✅ 실행 (Entry만) |
| Fullstack | backend | ⏭️ Skip |
| Backend-Only | backend | ⏭️ Skip |

### 7.3 Framework별 요구사항

**React:**
```tsx
<BrowserRouter basename={window.__BASENAME__ || ''}>
```

**Vue:**
```typescript
createWebHistory((window as any).__BASENAME__ || '/')
```

`window.__BASENAME__`는 PreviewProxy가 HTML 응답에 자동 주입합니다.

### 7.4 Validation 실패 시 워크플로우

```
1. Preview 시작 → Validation 실패 → 서버 중단 → 400 에러 반환
   ↓
2. UI: 경고 + Fix 버튼 표시
   ┌────────────────────────────────────────┐
   │ ⚠️ 개발서버 프록시 설정 미완료          │
   │ Missing basename configuration        │
   │ [Fix 🔧]                              │
   └────────────────────────────────────────┘
   ↓
3. Fix 버튼 → suggestedFix를 채팅에 자동 입력
   ↓
4. AI가 basename 코드 생성 → 재시작 → 정상 작동
```

---

## 8. 클라우드 환경 제약사항

### 8.1 분산 락 (Multi-Pod 동시성 제어)

클라우드에서 ant-preview가 **2+ Pod**로 실행될 때, ALB round-robin으로 인해 동일한 프로젝트에 대한 start 요청이 서로 다른 Pod에 도달할 수 있습니다.

**문제**: 두 Pod가 동시에 같은 EFS 경로에서 `npm install`을 실행하면:
- Lock file 충돌로 install 실패 (exit code 1)
- `node_modules` 오염으로 Dev Server 기동 실패
- UI에 "Installing dependencies" 표시가 영원히 남음

**해결**: Redis 분산 락 (`SET NX + TTL`)

```
Pod A: POST /start → acquireLock("ant:lock:preview:{serverKey}", 120s) → OK → npm install → dev server → releaseLock
Pod B: POST /start → acquireLock("ant:lock:preview:{serverKey}", 120s) → FAIL → "Preview is starting on another server"
```

| 항목 | 값 |
|------|-----|
| Lock key | `ant:lock:preview:{serverKey}` |
| TTL | 120초 (npm install + startup 커버) |
| 실패 시 | 자동 해제 (TTL 만료) |
| 성공 시 | Health check 완료 후 즉시 해제 |

### 8.2 실패 상태 전파

`startPreview` 실패 시 (npm install 에러, 프로세스 크래시 등):
1. Redis Pub/Sub로 실패 상태 브로드캐스트 → UI가 에러 표시
2. 분산 락 즉시 해제 → 재시도 가능
3. `installingProjects` Set에서 제거

### 8.3 파일 감시 (File Watching)

클라우드 환경에서 워크스페이스는 **EFS (NFS 기반)** 에 마운트됩니다 (`/mnt/workspaces`).

**문제**: Dev Server(Vite, Next.js 등)는 HMR을 위해 `fs.watch` (Linux `inotify`)를 사용합니다.
`inotify`는 로컬 파일시스템 전용 커널 기능이므로 **NFS/EFS에서는 작동하지 않습니다**.

```
Error: UNKNOWN: unknown error, watch '/mnt/workspaces/.../src/components/About.tsx'
  errno: -116, syscall: 'watch', code: 'UNKNOWN'
```

**해결**: ProcessSpawner가 Dev Server 프로세스를 spawn할 때 **polling 모드**를 활성화합니다.

| 환경변수 | 대상 | 설명 |
|----------|------|------|
| `CHOKIDAR_USEPOLLING=true` | Vite (chokidar), Webpack 5+ | `fs.watch` 대신 `fs.stat` polling 사용 |
| `CHOKIDAR_INTERVAL=3000` | Vite (chokidar) | Polling 간격 3초 (CPU 절약, Preview에서 즉시 HMR 불필요) |
| `WATCHPACK_POLLING=true` | Next.js, Webpack 4 (watchpack) | watchpack polling 활성화 |

**왜 polling인가**:
- `fs.stat()`으로 파일 수정 시간을 주기적으로 확인 → 모든 파일시스템에서 작동
- Docker Desktop, WSL2, NFS 환경의 표준 해법
- Preview 용도에서는 HMR이 핵심이 아니므로 긴 polling 간격으로 CPU 부담 최소화

**로컬 환경 영향**: 없음. 로컬에서도 동일한 환경변수가 주입되나, 로컬 파일시스템은 `inotify`가 정상 작동하므로 polling이 활성화되어도 기능적 차이 없음. (다만 로컬에서는 파일 변경 감지가 약간 느려질 수 있음 — 3초 간격)

---

## 9. 파일 구조

```
packages/ant-cli/src/
├── infrastructure/preview/
│   ├── PreviewServer.ts              # Express 서버 (엔트리포인트)
│   └── start-preview-server.ts       # 프로세스 시작
│
├── periphery/adapters/http/
│   ├── middleware/
│   │   └── previewProxy.ts           # 프록시 미들웨어 (핵심)
│   └── services/PreviewService/
│       ├── PreviewService.ts         # Preview 생명주기 관리
│       ├── managers/
│       │   ├── ProcessSpawner.ts     # 프로세스 생성/종료
│       │   ├── LogManager.ts         # 로그 관리
│       │   └── DependencyInstaller.ts
│       ├── detectors/
│       │   ├── PackageDetector.ts    # Frontend/Backend 감지
│       │   └── ProjectStructureDetector.ts
│       └── validators/
│           ├── ReactValidator.ts     # React basename 검증
│           └── VueValidator.ts       # Vue basename 검증
│
├── infrastructure/networking/
│   └── PortManager.ts               # 동적 포트 할당
│
└── infrastructure/state/
    └── RedisStateStore.ts            # Redis 상태 관리 (PortRegistry)
```

---

## 10. 핵심 요약

| 항목 | 설명 |
|------|------|
| **호스트** | `ant-preview.crosstoken.io` (별도 호스트) |
| **서버 키** | `{tenantId}:{userId}:{projectId}:{feature}` |
| **포트 범위** | 30000-39999 동적 할당 |
| **프록시 경로** | `/:serverKey/*` → Entry Dev Server |
| **SSR 리소스** | 별도 호스트 + Referer 기반 라우팅으로 해결 |
| **상태 관리** | Redis (Multi-Pod, Sticky Session 불필요) |
| **Basename** | Frontend Entry 자동 검증 + Fix 워크플로우 |
| **Idle Timeout** | 30분 비활성 시 자동 종료 |
