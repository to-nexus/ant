# Preview Server 아키텍처

## 1. 개요

사용자가 생성한 코드의 실시간 미리보기를 제공하는 시스템입니다. 각 피처별로 독립된 Dev Server(Vite, Next.js 등)를 실행하고, 프록시를 통해 브라우저에서 접근할 수 있게 합니다.

### 핵심 특징

- **별도 호스트 기반 라우팅**: `ant-preview.crosstoken.io` → ant-preview 서비스 전용
- **멀티 패키지 지원**: Frontend + Backend 동시 실행 (Fullstack, Monorepo)
- **동적 포트 할당**: 30000-39999 범위 자동 할당
- **프록시 접근**: `/:urlKey/*` — 프로젝트+피처별 독립 URL
- **Multi-Pod 지원**: Redis 기반 상태 관리 (Single Source of Truth), Sticky Session 불필요
- **통합 프록시**: 모든 프레임워크가 네이티브 base path 사용, 프록시는 항상 pass-through

---

## 2. 아키텍처

### 2.1 키 구조

Preview는 두 가지 키 형식을 사용합니다:

| 형식 | 용도 | 예시 |
|------|------|------|
| **Internal Key** (Redis) | 내부 상태 관리, Redis 키 | `to.nexus:probe:ant-prediction:localtest` |
| **URL Key** (HTTP) | URL path segment | `to.nexus--probe--ant-prediction--localtest` |

URL Key는 콜론(`:`) 대신 더블대시(`--`)를 사용합니다. 콜론은 URL에서 scheme 구분자로 오인식될 수 있기 때문입니다 (예: `to.nexus:`가 URL scheme `[a-z][a-z0-9+\-.]*` 패턴에 매칭).

변환 함수: `toUrlKey()` / `fromUrlKey()` (serverKeyUtils.ts)

### 2.2 시스템 구성

```
┌────────────────────────────────────────────────────────────────┐
│ Frontend (ant-ui)                                              │
│  ├─ PreviewPanel              # 미리보기 UI                    │
│  ├─ usePreviewManager         # 상태 관리 & SSE              │
│  └─ PreviewStatusPanel        # 진행 상황 + Fix 버튼         │
└────────────────────────────────────────────────────────────────┘
                              ↓ HTTP API + SSE
┌────────────────────────────────────────────────────────────────┐
│ ant-preview (Express, 포트 8080)                               │
│  ├─ PreviewProxy              # /:urlKey/* 프록시 (핵심)      │
│  ├─ Preview API               # 시작/중지/상태 엔드포인트    │
│  ├─ PreviewService            # Preview 생명주기 관리        │
│  ├─ Validators                # 프로젝트 설정 검증           │
│  │   ├─ ReactValidator        #   Vite base + router basename │
│  │   ├─ VueValidator          #   Vite base + router base     │
│  │   └─ NextValidator         #   basePath + env var 검증     │
│  ├─ PortManager               # 동적 포트 할당               │
│  └─ RedisStateStore           # 상태 관리 (Single Source)    │
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

프레임워크가 네이티브 base path를 사용하므로 대부분의 리소스는 `/{urlKey}/` 하위 경로로 요청됩니다. 그러나 일부 리소스(raw `<img src="/logo.svg">` 등)는 base path 없이 절대 경로로 요청될 수 있습니다. 별도 호스트를 사용하면 **호스트 기반 라우팅**으로 이러한 요청도 ant-preview에 도달합니다.

### 3.3 통합 프록시 전략

**모든 프레임워크가 네이티브 base path를 사용합니다. 프록시는 항상 동일한 단일 경로로 동작합니다.**

```
요청 수신
    │
    ├─ reserved path? (/projects/, /admin/, /health) → Express route handler
    │
    ├─ urlKey in path? ─── NO ──→ [Fallback 경로]
    │                              1. Referer에서 urlKey 추출
    │      YES                     2. Cookie에서 urlKey 추출
    │                              3. Redis 조회 → /{urlKey} prepend 후 프록시
    ▼
[Main 경로]
    1. urlKey 파싱 → fromUrlKey() → internal key
    2. Redis 조회 → { host, port }
    3. 경로 prefix 유지 (항상)
    4. Fullstack: /api/* → backend port 분기
    5. fetch → dev server
    6. 응답 body를 stream pipe (변환/재작성 없음)
    7. preview cookie 설정 (text/html 응답 시, Path=/{urlKey})
```

### 3.4 각 프레임워크의 base path 설정

| 프레임워크 | 환경변수 | 설정 위치 |
|-----------|---------|----------|
| **Vite** (React/Vue) | `VITE_BASE_PATH` | `vite.config.ts` → `base: process.env.VITE_BASE_PATH \|\| '/'` |
| **Next.js** | `NEXT_PUBLIC_BASE_PATH` | `next.config.js` → `basePath: process.env.NEXT_PUBLIC_BASE_PATH \|\| ''` |

ProcessSpawner가 dev server 프로세스 생성 시 환경변수를 자동 주입합니다.

### 3.5 리소스 요청 흐름

#### Case A: urlKey가 경로에 있는 요청

```
브라우저:  ant-preview.crosstoken.io/org--user--proj--feat/page
    ↓
Express PreviewProxy:
    1. 경로에서 urlKey 추출: "org--user--proj--feat"
    2. fromUrlKey() → internal key: "org:user:proj:feat"
    3. Redis 조회: internal key → { host, port }
    4. prefix 유지 → http://host:port/org--user--proj--feat/page 로 프록시
    5. 응답 body를 stream pipe (재작성 없음)
    6. Preview cookie 설정: Path=/org--user--proj--feat
```

#### Case B: urlKey가 없는 요청 (리소스 누출)

```
브라우저:  ant-preview.crosstoken.io/logos/logo.svg
    ↓
Express PreviewProxy:
    1. 경로에 urlKey 없음
    2. urlKey 복원:
       a) Referer 헤더에서 추출
       b) __ant_preview_sk 쿠키에서 추출
    3. Redis 조회: internal key → { host, port }
    4. /{urlKey}/logos/logo.svg 로 prepend 후 프록시
```

### 3.6 Hop-by-hop 헤더 처리

Node.js `fetch` (undici)는 hop-by-hop 헤더를 거부합니다. 프록시는 `buildCleanHeaders()` 유틸리티로 이를 일괄 제거합니다:

```
제거 대상: connection, keep-alive, proxy-connection, proxy-authenticate,
          proxy-authorization, te, trailer, transfer-encoding, upgrade,
          if-none-match, if-modified-since
```

### 3.7 Streaming SSR 지원

프록시는 응답 body를 `Readable.fromWeb(response.body).pipe(res)`로 직접 스트리밍합니다. `response.text()` 버퍼링이 없으므로:
- React 18 Suspense 기반 스트리밍 SSR이 정상 작동
- 브라우저가 초기 HTML shell을 즉시 수신
- 메모리 사용량 최소화

### 3.8 Fallback: Referer + Cookie 기반 복구

일부 리소스는 urlKey prefix 없이 요청됩니다:

```
<img src="/logos/logo.svg">         ← raw img (base path 미적용)
url(/fonts/inter.woff2)             ← CSS 내부 참조
```

**복원 순서:**

1. Referer 헤더에서 urlKey 추출
2. 실패 시: `__ant_preview_sk` 쿠키에서 internal key 추출 → urlKey로 변환
3. `/{urlKey}` prepend 후 프록시

**쿠키 격리**: `Path=/{urlKey}`로 설정하여 다른 프리뷰 세션과 쿠키가 공유되지 않습니다.

---

## 4. 프로젝트 설정 검증 (Validator)

### 4.1 개요

Preview 시작 시 프로젝트의 프록시 환경 설정을 검증합니다. 미설정 시 서버를 중단하고 사용자에게 수정을 제안합니다.

### 4.2 검증 대상

| 프레임워크 | 검증 항목 | Validator |
|-----------|----------|-----------|
| React (Vite) | `vite.config` base + React Router basename | ReactValidator |
| Vue (Vite) | `vite.config` base + Vue Router base | VueValidator |
| Next.js | `next.config` basePath + `NEXT_PUBLIC_BASE_PATH` 참조 | NextValidator |

### 4.3 검증 실패 워크플로우

```
1. Preview 시작 → Validation 실패 → 서버 중단 → 에러 반환
   ↓
2. Redis에 issues 기록 → SSE로 UI에 브로드캐스트
   ↓
3. UI: 경고 + Fix 버튼 표시
   ↓
4. Fix 버튼 클릭 → suggestedFix를 채팅에 자동 입력
   ↓
5. AI가 코드 수정 → Preview 재시작 → 정상 작동
```

### 4.4 코드 생성 가이드 (Layer 1: 예방)

새 프로젝트 생성 시 AI가 올바른 설정을 포함하도록 프롬프트 템플릿이 가이드합니다:

| 파일 | 역할 |
|------|------|
| `preview-setup.md` | 프레임워크별 base path 설정 원칙 |
| `preview-env-contract.md` | 플랫폼 런타임 계약 — 환경변수, 포트 바인딩 |

---

## 5. Preview 생명주기

### 5.1 상태 전이 (Phase)

```
idle → installing → starting → running
                        │           │
                        ▼           ▼
                      error ←──── error (health check fail → cleanup)
```

### 5.2 시작 흐름

```
1. 사용자: "Start Preview" 클릭
   ↓
2. Frontend: POST /preview/projects/:id/start { feature }
   ↓
3. 분산 락 획득 (Redis SET NX, TTL 120s)
   ↓
4. 프로젝트 구조 감지
   ↓
5. 의존성 설치 (npm install)
   ↓
6. Dev Server 기동 (npm run dev --host 0.0.0.0)
   환경변수 주입: PORT, VITE_BASE_PATH / NEXT_PUBLIC_BASE_PATH, ANT_BASE_PATH 등
   ↓
7. 프로젝트 설정 검증 (Validator)
   ├─ 통과 → 계속
   └─ 실패 → 프로세스 kill, 에러 broadcast
   ↓
8. Redis에 PreviewState 등록
   { host: Pod_IP, port: 30001, running: true, ready: false }
   ↓
9. Health Check (최대 60초)
   ├─ 성공 → { ready: true }
   └─ 실패 → 프로세스 kill → 에러 broadcast
```

### 5.3 Fullstack 지원

```
/:urlKey/           → Frontend (port 30001)
/:urlKey/page       → Frontend (port 30001)
/:urlKey/api/*      → Backend  (port 30002)
```

### 5.4 Cross-Project Preview (프론트-백엔드 분리 프로젝트)

#### 문제

프론트엔드와 백엔드가 서로 다른 언어/프레임워크일 경우 모노레포 구성이 불가능합니다.
각 프로젝트는 별도 워크스페이스로 존재하며, 각각 독립적인 Preview Server를 실행합니다.
이 경우 프론트엔드에서 백엔드 API에 접근하기 위한 추가 설정이 필요합니다.

#### 해결 구조

```
Frontend 프로젝트 (React)          Backend 프로젝트 (Go)
├── urlKey: org--user--fe--feat    ├── urlKey: org--user--be--feat
├── port: 30001                    ├── port: 30004
│                                  │
├── linkedBackend:                 └── (독립 실행)
│   type: 'project'
│   projectId: 'be'
│   feature: 'feat'
│   resolvedUrlKey: 'org--user--be--feat'
│
└── VITE_API_BASE_URL = /org--user--be--feat
```

**프론트엔드의 API 요청 흐름:**
1. 프론트 코드: `fetch(VITE_API_BASE_URL + '/api/users')`
2. 브라우저: `GET ant-preview.crosstoken.io/org--user--be--feat/api/users`
3. 프록시: urlKey 파싱 → Redis에서 백엔드 Pod IP/포트 조회 → 프록시

#### 구성 방법

1. **Preview Config 탭**: FeatureDropdown의 Settings(기어) 아이콘 클릭
2. **Backend Connection**: Direct URL 입력 또는 Ant Project 선택
3. **저장**: `PUT /preview/projects/:id/preview-config` → Redis에 `linkedBackend` 저장
4. **프리뷰 재시작**: 환경변수에 `VITE_API_BASE_URL`이 자동 주입됨

#### 인프라 책임 분리

- `frontend-only` 프로젝트: `docker-compose.yml`, 인프라 스크립트 생성 금지
- 인프라 관련 파일(Redis, DB 등)은 백엔드 프로젝트에서만 생성
- setup constraints.md에 Environment Constraint로 강제

---

## 6. Multi-Pod 아키텍처

### 6.1 Redis — Single Source of Truth

모든 Preview 상태는 Redis에만 존재합니다.

```typescript
interface PreviewState {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;
  host: string;              // Pod IP
  running: boolean;
  ready: boolean;
  phase: string;
  backendPort?: number;
  structureType?: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';  // 자동 감지
  linkedBackend?: {          // Cross-project 백엔드 연결 (Preview Config UI에서 설정)
    type: 'url' | 'project';
    url?: string;            // type='url': 직접 URL
    projectId?: string;      // type='project': Ant 프로젝트 ID
    feature?: string;        // type='project': Feature 이름
    resolvedUrlKey?: string; // type='project': 자동 생성된 urlKey
  };
  packages?: Package[];
  issues?: PreviewIssue[];
  startedAt?: number;
  lastAccessedAt?: number;
}
```

### 6.2 Cross-Pod 프록시

```
ant-preview Pod A                    ant-preview Pod B
├── Dev Server (port 30001)          ├── Dev Server (port 30004)
│   └── 0.0.0.0:30001 listen        │   └── 0.0.0.0:30004 listen
└── Redis 등록:                      └── Redis 등록:
    host=Pod_A_IP, port=30001            host=Pod_B_IP, port=30004
```

요청 흐름: ALB → 아무 Pod → Redis 조회 → 올바른 Pod IP로 프록시

---

## 7. 파일 구조

```
packages/ant-cli/src/
├── infrastructure/preview/
│   ├── PreviewServer.ts              # Express 서버 (엔트리포인트)
│   └── start-preview-server.ts       # 프로세스 시작
│
├── periphery/adapters/http/
│   ├── middleware/
│   │   └── previewProxy.ts           # 프록시 미들웨어 (통합, 단일 경로)
│   └── services/PreviewService/
│       ├── PreviewService.ts         # Preview 생명주기 관리
│       ├── managers/
│       │   ├── ProcessSpawner.ts     # 프로세스 생성 + base path 환경변수 주입
│       │   ├── LogManager.ts         # 로그 관리
│       │   └── DependencyInstaller.ts
│       ├── detectors/
│       │   ├── PackageDetector.ts    # Frontend/Backend/프레임워크 감지
│       │   └── ProjectStructureDetector.ts
│       ├── validators/
│       │   ├── ProjectValidator.ts   # 프레임워크 판별 → Validator 위임
│       │   ├── ReactValidator.ts     # Vite base + React Router basename 검증
│       │   ├── VueValidator.ts       # Vite base + Vue Router base 검증
│       │   └── NextValidator.ts      # basePath + NEXT_PUBLIC_BASE_PATH 검증
│       └── utils/
│           └── serverKeyUtils.ts     # toUrlKey/fromUrlKey 변환
│
├── infrastructure/networking/
│   └── PortManager.ts               # 동적 포트 할당
│
├── infrastructure/state/
│   ├── RedisStateStore.ts            # Redis 상태 관리
│   └── redisKeyUtils.ts             # Redis 키 생성/파싱
│
├── core/prompt/templates/code/base/injections/
│   ├── preview-setup.md              # base path 설정 원칙 (통합)
│   └── preview-env-contract.md       # 플랫폼 런타임 계약 (통합, 크로스 프로젝트 포함)
│
└── core/prompt/templates/code/phases/execute/languages/
    ├── typescript/setup/constraints.md  # TS 셋업 제약 (인프라 가드레일 포함)
    └── golang/setup/constraints.md      # Go 셋업 제약 (인프라 가드레일 포함)

packages/ant-ui/src/
├── presentation/components/
│   ├── PreviewConfigEditor/         # Preview Config 탭 컴포넌트
│   │   └── index.tsx                #   Project Info + Backend Connection + Controls + Status Console
│   ├── FeatureSection/
│   │   ├── index.tsx                #   Settings 버튼 → openMainPanelTab('previewConfig')
│   │   └── components/
│   │       ├── FeatureDropdown.tsx   #   Play + Settings(기어) 아이콘 분리
│   │       └── PreviewStatusPanel.tsx  # Explorer 사이드바 미리보기 상태 (Preview Console)
│   ├── MainPanelTabsBar/
│   │   └── index.tsx                #   previewConfig 탭 렌더링 추가
│   └── layout/
│       └── MainContentArea.tsx      #   previewConfig 탭 라우팅 추가
├── domain/store/
│   ├── types.ts                     #   previewConfig 탭 타입 추가
│   └── slices/uiSlice.ts           #   previewConfig 탭 액션 추가
└── infrastructure/http/api.ts       #   getPreviewConfig, updatePreviewConfig API 추가
```

---

## 8. 핵심 요약

| 항목 | 설명 |
|------|------|
| **호스트** | `ant-preview.crosstoken.io` (별도 호스트) |
| **URL Key** | `{tenantId}--{userId}--{projectId}--{feature}` (더블대시 구분) |
| **Internal Key** | `{tenantId}:{userId}:{projectId}:{feature}` (콜론 구분, Redis) |
| **포트 범위** | 30000-39999 동적 할당 |
| **프록시 경로** | `/:urlKey/*` → Entry Dev Server |
| **프록시 동작** | 항상 prefix 유지 + stream pipe (재작성/주입 없음) |
| **base path** | 프레임워크 네이티브 (Vite base / Next.js basePath) |
| **환경변수** | `VITE_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` / `ANT_BASE_PATH` |
| **상태 관리** | Redis (Single Source of Truth, Multi-Pod) |
| **검증** | 프레임워크별 base path + 환경변수 참조 검증 + Fix 워크플로우 |
| **Idle Timeout** | 30분 비활성 시 자동 종료 |

---

## 부록: 용어 정리

| 용어 | 의미 |
|------|------|
| **Internal Key** | `{tenantId}:{userId}:{projectId}:{feature}` — Redis 내부에서 사용하는 콜론 구분 키 |
| **URL Key** | `{tenantId}--{userId}--{projectId}--{feature}` — HTTP URL path에서 사용하는 더블대시 구분 키 |
| **base path** | 프레임워크의 네이티브 경로 prefix 설정 (Vite `base`, Next.js `basePath`) |
| **Fallback** | urlKey 없는 요청을 Referer/Cookie로 올바른 dev server에 라우팅하는 메커니즘 |
| **hop-by-hop 헤더** | 단일 연결에서만 유효한 HTTP 헤더 (프록시가 제거해야 함) |
