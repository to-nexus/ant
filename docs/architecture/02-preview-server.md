# Preview Server 아키텍처

## 1. 개요

사용자가 생성한 코드의 실시간 미리보기를 제공하는 시스템입니다. 각 피처별로 독립된 Dev Server(Vite, Next.js 등)를 실행하고, 프록시를 통해 브라우저에서 접근할 수 있게 합니다.

### 핵심 특징

- **별도 호스트 기반 라우팅**: `ant-preview.crosstoken.io` → ant-preview 서비스 전용
- **멀티 패키지 지원**: Frontend + Backend 동시 실행 (Fullstack, Monorepo)
- **동적 포트 할당**: 30000-39999 범위 자동 할당
- **프록시 접근**: `/:serverKey/*` — 프로젝트+피처별 독립 URL
- **Multi-Pod 지원**: Redis 기반 상태 관리 (Single Source of Truth), Sticky Session 불필요
- **CSR/SSR 듀얼 모드**: 렌더링 타입에 따라 프록시 전략이 자동 분기

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
│  ├─ usePreviewManager         # 상태 관리 & SSE              │
│  └─ PreviewStatusPanel        # 진행 상황 + Fix 버튼         │
└────────────────────────────────────────────────────────────────┘
                              ↓ HTTP API + SSE
┌────────────────────────────────────────────────────────────────┐
│ ant-preview (Express, 포트 8080)                               │
│  ├─ PreviewProxy              # /:serverKey/* 프록시 (핵심)   │
│  ├─ Preview API               # 시작/중지/상태 엔드포인트    │
│  ├─ PreviewService            # Preview 생명주기 관리        │
│  ├─ Validators                # 프로젝트 설정 검증           │
│  │   ├─ ReactValidator        #   CSR: basename 검증         │
│  │   ├─ VueValidator          #   CSR: basename 검증         │
│  │   └─ NextValidator         #   SSR: basePath 검증         │
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

SSR 프레임워크(Next.js 등)는 HTML에 절대 경로로 리소스를 참조합니다:

```html
<script src="/_next/static/chunks/main-abc123.js"></script>
<img src="/logos/header-logo.svg">
```

같은 호스트를 쓰면 ALB가 `/*` 규칙으로 ant-api에 라우팅하여 401 에러가 발생합니다.
별도 호스트를 쓰면 **호스트 기반 라우팅**으로 모든 요청이 ant-preview에 도달합니다.

### 3.3 CSR/SSR 듀얼 모드 — 핵심 개념

**프록시는 프로젝트의 렌더링 타입에 따라 완전히 다른 전략을 사용합니다.**

```
                        ┌─────────────────────┐
                        │   렌더링 타입 판별    │
                        │   (NextValidator,    │
                        │    ReactValidator)    │
                        └──────────┬──────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                              ▼
          ┌─────────────────┐            ┌─────────────────┐
          │   CSR 모드       │            │   SSR 모드       │
          │ (React, Vue)     │            │ (Next.js)        │
          └─────────────────┘            └─────────────────┘
                    │                              │
     ┌──────────────┤                    ┌─────────┤
     │              │                    │         │
     ▼              ▼                    ▼         ▼
 프록시가         window.             프록시가    프레임워크가
 prefix           __BASENAME__       prefix를    basePath로
 strip 후         주입 +             유지하여    모든 URL을
 전달             HTML 재작성        그대로 전달  자체 처리
```

| 항목 | CSR 모드 | SSR 모드 |
|------|----------|----------|
| **대상 프레임워크** | React, Vue (client-side router) | Next.js (server-side rendering) |
| **프록시 동작** | prefix strip + HTML/JS/CSS 재작성 | prefix 유지 (pass-through) |
| **경로 prefix 설정** | `window.__BASENAME__` (런타임 주입) | `basePath` in next.config.js (빌드타임) |
| **HTML 재작성** | O — 절대경로에 prefix 추가 | X — 프레임워크가 자체 처리 |
| **클라이언트 스크립트 주입** | O — fetch/XHR 인터셉트, MutationObserver | X — 불필요 |
| **Redis `nativeBasePath` 플래그** | `false` (기본) | `true` |
| **이미지 최적화** | N/A | 비활성화 (`images.unoptimized`) |

**모드 결정 기준**: PreviewService가 startPreview 시 `validation.framework === 'next'`이면 Redis에 `nativeBasePath: true`를 기록합니다. 프록시는 이 플래그를 읽어 동작을 분기합니다.

### 3.4 왜 SSR에는 별도 전략이 필요한가? (Hydration Mismatch)

CSR 방식(HTML 재작성)은 SSR 프레임워크에서 **Hydration Mismatch**를 유발합니다:

```
1. Next.js SSR: <img src="/logos/logo.svg">      (서버 렌더링 원본)
2. 프록시 재작성: <img src="/sk/logos/logo.svg">   (prefix 추가)
3. 브라우저 수신: src="/sk/logos/logo.svg"         (재작성된 HTML)
4. React 클라이언트 번들: src="/logos/logo.svg"    (원본 코드)
5. Hydration: src 불일치 → Warning: Prop 'src' did not match
```

**해결**: SSR 프레임워크는 자체 basePath 설정으로 서버/클라이언트 **양쪽 모두** 동일한 prefix를 적용합니다. 프록시는 개입하지 않습니다.

### 3.5 리소스 요청 흐름

Preview에서 발생하는 요청은 두 종류입니다:

#### Case A: serverKey가 경로에 있는 요청

```
브라우저:  ant-preview.crosstoken.io/org:user:proj:feat/page
    ↓
Express PreviewProxy:
    1. 경로에서 serverKey 추출: "org:user:proj:feat"
    2. Redis 조회: serverKey → { host, port, nativeBasePath }
    3-a. CSR 모드 (nativeBasePath=false):
         prefix strip → http://host:port/page 로 프록시
         응답 HTML 재작성 + 클라이언트 스크립트 주입
    3-b. SSR 모드 (nativeBasePath=true):
         prefix 유지 → http://host:port/org:user:proj:feat/page 로 프록시
         응답 그대로 전달 (재작성 없음)
    4. Preview cookie 설정: __ant_preview_sk=org:user:proj:feat
```

#### Case B: serverKey가 없는 요청 (리소스 누출)

일부 리소스 경로는 serverKey prefix가 포함되지 않을 수 있습니다:
- SSR에서 raw `<img src="/logos/logo.svg">` (Next.js Image가 아닌 일반 img)
- CSS `url(...)` 내부의 서브리소스 참조

```
브라우저:  ant-preview.crosstoken.io/logos/logo.svg
    ↓
Express PreviewProxy:
    1. 경로에 serverKey 없음
    2. serverKey 복원 시도:
       a) Referer 헤더에서 추출 (가장 신뢰)
       b) __ant_preview_sk 쿠키에서 추출 (CSS url() 등 Referer 체인 끊김 대응)
    3. Redis 조회: serverKey → { host, port, nativeBasePath }
    4-a. nativeBasePath=true:
         Dev Server가 /{basePath}/ 하위에서만 파일 서빙
         → /{serverKey}/logos/logo.svg 로 prepend 후 프록시
    4-b. nativeBasePath=false:
         Dev Server가 / 하위에서 파일 서빙
         → /logos/logo.svg 그대로 프록시
    5. 실패 시 (404): retry-on-404 — serverKey prepend 후 재시도 (Redis 동기화 타이밍 대응)
```

### 3.6 방어 계층 정리

#### CSR 프로젝트 (React, Vue)

| 계층 | 역할 | 처리 방식 |
|------|------|-----------|
| **1. 서버사이드 HTML 재작성** | 절대 경로를 `/:serverKey/` prefix로 변환 | PreviewProxy |
| **2. 클라이언트 스크립트** | React hydration, 런타임 fetch/XHR 인터셉트 | `<head>`에 주입된 JS |
| **3. `window.__BASENAME__`** | 클라이언트 라우터의 base path 설정 | 주입 스크립트 내 |
| **4. Referer/Cookie fallback** | 누출된 절대 경로 요청 복구 | Express 앱 레벨 |
| **5. 별도 호스트** | 4가 작동하려면 요청이 ant-preview에 도달해야 함 | ALB 호스트 라우팅 |

#### SSR 프로젝트 (Next.js)

| 계층 | 역할 | 처리 방식 |
|------|------|-----------|
| **1. 코드 생성 (예방)** | 새 프로젝트에 basePath + images.unoptimized 설정 포함 | LLM 프롬프트 가이드 |
| **2. Validator + Chat Fix (탐지/교정)** | 기존 프로젝트에 누락된 설정 감지 → UI Fix 버튼 → 채팅 입력 | NextValidator |
| **3. 프록시 Resilience (런타임 안전망)** | Layer 1,2 실패 시에도 동작 보장 | PreviewProxy |
| ↳ 3a. `_next/image` URL 리라이트 | 이미지 최적화 API의 basePath 미적용 버그 대응 | url 파라미터 rewrite |
| ↳ 3b. WebSocket 생성자 패치 | basePath 내 콜론이 URL scheme으로 오인식 → HMR 크래시 방지 | HTML `<head>` 스크립트 주입 |
| ↳ 3c. Referer/Cookie fallback | raw img 등 basePath 미적용 리소스 복구 | Express 앱 레벨 |
| ↳ 3d. Retry-on-404 | Redis 동기화 타이밍 이슈 대응 | fallback 내 retry |
| **4. 별도 호스트** | 모든 fallback이 작동하려면 요청 도달 보장 필요 | ALB 호스트 라우팅 |

---

## 4. 프록시 구현

### 4.1 PreviewProxy 미들웨어 — 전체 흐름

```
요청 수신
    │
    ├─ reserved path? (/projects/, /admin/, /health) → Express route handler
    │
    ├─ serverKey in path? ─── NO ──→ [Fallback 경로]
    │                                  1. Referer에서 serverKey 추출
    │      YES                         2. Cookie에서 serverKey 추출
    │                                  3. Redis 조회 → dev server 프록시
    ▼                                  4. nativeBasePath → prepend serverKey
[Main 경로]                            5. 실패 시 retry-on-404
    1. serverKey 파싱
    2. Redis 조회 → { host, port, nativeBasePath }
    3. nativeBasePath 분기:
       ├─ true  → prefix 유지, _next/image url rewrite
       └─ false → prefix strip
    4. Fullstack: /api/* → backend port 분기
    5. fetch → dev server
    6. 응답 처리:
       ├─ nativeBasePath=true  → pass-through (재작성 없음)
       └─ nativeBasePath=false → HTML 재작성 + 스크립트 주입
    7. preview cookie 설정 (text/html 응답 시)
```

### 4.2 Hop-by-hop 헤더 처리

Node.js `fetch` (undici)는 hop-by-hop 헤더를 거부합니다. 프록시는 `buildCleanHeaders()` 유틸리티로 이를 일괄 제거합니다:

```
제거 대상: connection, keep-alive, proxy-connection, proxy-authenticate,
          proxy-authorization, te, trailer, transfer-encoding, upgrade,
          if-none-match, if-modified-since
```

이 유틸리티는 Main 경로와 Fallback 경로 **양쪽 모두**에서 사용됩니다.

### 4.3 CSR 모드: 경로 재작성 대상

| 대상 | 예시 | 변환 결과 |
|------|------|-----------|
| HTML `src`, `href`, `action` | `src="/_next/chunk.js"` | `src="/:serverKey/_next/chunk.js"` |
| JS `import`, `from` | `import '/utils.js'` | `import '/:serverKey/utils.js'` |
| JS `import()` | `import('/lazy.js')` | `import('/:serverKey/lazy.js')` |
| CSS `url()` | `url(/bg.png)` | `url(/:serverKey/bg.png)` |
| 정적 리소스 리터럴 | `"/logos/header.svg"` | `"/:serverKey/logos/header.svg"` |
| Next.js 내부 | `"/_next/static/..."` | `"/:serverKey/_next/static/..."` |

### 4.4 CSR 모드: 클라이언트 스크립트 (HTML `<head>` 주입)

React hydration이 서버 사이드에서 재작성한 경로를 원래대로 되돌리는 것을 방지합니다:

```javascript
(function() {
  var BASE = "/:serverKey";

  function rewrite(path) {
    if (path.startsWith('/') && !path.startsWith(BASE)) return BASE + path;
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

  // DOM 변경 감시 (src/href 속성 재작성)
  new MutationObserver(function(mutations) { /* ... */ })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  window.__BASENAME__ = BASE;
})();
```

### 4.5 SSR 모드: `_next/image` URL 리라이트

**문제**: Next.js Image Optimization(`/_next/image?url=...`)은 내부적으로 `new URL(url, origin)` 으로 이미지를 가져옵니다. 절대 경로(`/backgrounds/hero.png`)는 origin 기준으로 해석되어 basePath가 무시됩니다.

```
요청: /_next/image?url=%2Fbackgrounds%2Fhero.png
      → Next.js 내부 fetch: http://localhost:30000/backgrounds/hero.png
      → Dev Server는 /{basePath}/backgrounds/hero.png 에서만 서빙
      → 404 → "The requested resource isn't a valid image" (400)
```

**해결**: 프록시가 `url` 파라미터에 basePath prefix를 자동 주입합니다:

```
프록시 수신: /{sk}/_next/image?url=%2Fbackgrounds%2Fhero.png
프록시 변환: /{sk}/_next/image?url=%2F{sk}%2Fbackgrounds%2Fhero.png
             → Next.js 내부 fetch: http://localhost:30000/{sk}/backgrounds/hero.png
             → 200 OK ✅
```

**근본 해결**: `images: { unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH }`를 next.config.js에 설정하면 `_next/image` API 자체를 사용하지 않습니다. Layer 1(코드 생성)과 Layer 2(Validator 제안)에서 이 설정을 유도하며, 프록시 리라이트는 Layer 3 안전망입니다.

### 4.6 SSR 모드: WebSocket 생성자 패치 (HMR 크래시 방지)

**문제**: Next.js `normalizedAssetPrefix`는 basePath에서 leading `/`를 제거합니다:

```
"/to.nexus:probe:ant-ogf:skeleton"
  → strip leading slash
  → "to.nexus:probe:ant-ogf:skeleton"
  → URL.canParse() = true (to.nexus가 유효한 URL scheme 패턴 [a-z][a-z0-9+\-.]* 에 매칭)
  → WebSocket URL: "to.nexus:probe:ant-ogf:skeleton/_next/webpack-hmr"
  → new WebSocket() → SyntaxError: scheme 'to.nexus' is not allowed
```

이 에러는 React useEffect 내에서 uncaught로 발생하여 전체 앱을 크래시시킵니다 ("Application error: a client-side exception has occurred").

**해결**: nativeBasePath 프로젝트의 HTML 응답에 **WebSocket 생성자 패치 스크립트**만 주입합니다:
- `new WebSocket(invalidUrl)` 에서 SyntaxError가 발생하면 catch
- `wss://currentHost/` + 원래 URL로 재구성하여 재시도
- 경로 재작성은 하지 않음 (Hydration Mismatch 회피)
- 이 스크립트는 Next.js 내부 HMR 클라이언트의 WebSocket URL 구성 버그에 대한 방어

**이 문제의 본질**: serverKey에 포함된 콜론(`:`)이 URL scheme 구분자와 충돌. `to.nexus:probe:...`에서 `to.nexus`가 유효한 URL scheme으로 오인식됩니다. 콜론 없는 serverKey (예: `acme-alice-todo-feature`)를 사용하면 이 문제는 발생하지 않습니다.

### 4.7 Fallback: Referer + Cookie 기반 복구

일부 리소스는 serverKey prefix 없이 요청됩니다:

```
<img src="/logos/logo.svg">         ← SSR에서 raw img (basePath 미적용)
url(/fonts/inter.woff2)             ← CSS 내부 참조 (Referer가 CSS 파일 URL)
```

**복원 순서:**

```
1. Referer 헤더에서 serverKey 추출
   Referer: https://ant-preview.../org:user:proj:feat/
   → serverKey: "org:user:proj:feat"

2. 실패 시: __ant_preview_sk 쿠키에서 추출
   Cookie: __ant_preview_sk=org%3Auser%3Aproj%3Afeat
   → serverKey: "org:user:proj:feat"
   (CSS url() 등 Referer 체인이 끊기는 경우 대응)

3. nativeBasePath 확인:
   ├─ true  → /{serverKey}/logos/logo.svg 로 prepend 후 프록시
   └─ false → /logos/logo.svg 그대로 프록시

4. 실패 시 (404) + nativeBasePath=false:
   → /{serverKey} prepend 후 retry
   (Redis에 nativeBasePath 플래그가 아직 기록되지 않은 타이밍 이슈 대응)
```

**쿠키 설정 시점**: 프록시가 `text/html` 응답을 반환할 때 `Set-Cookie: __ant_preview_sk={serverKey}` 를 설정합니다. 이후 모든 서브리소스 요청에 쿠키가 포함됩니다.

---

## 5. 프로젝트 설정 검증 (Validator)

### 5.1 개요

Preview 시작 시 프로젝트의 프록시 환경 설정을 검증합니다. 미설정 시 서버를 중단하고 사용자에게 수정을 제안합니다.

### 5.2 CSR 검증: ReactValidator / VueValidator

SPA의 클라이언트 라우터에 `basename` 설정이 필요합니다:

```tsx
// React
<BrowserRouter basename={window.__BASENAME__ || ''}>

// Vue
createWebHistory((window as any).__BASENAME__ || '/')
```

`window.__BASENAME__`은 프록시가 HTML 응답에 자동 주입합니다.

**검증 방식**: 소스 코드 스캔 — `BrowserRouter`, `createBrowserRouter`, `createWebHistory` 등에서 `basename`/`__BASENAME__` 사용 여부 확인.

### 5.3 SSR 검증: NextValidator

Next.js 프로젝트에는 `basePath`와 `images.unoptimized` 설정이 필요합니다:

```js
// next.config.js
const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  images: {
    unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH,
  },
};
```

| 설정 | 역할 |
|------|------|
| `basePath` | 모든 라우트, 에셋, 이미지 URL에 prefix 적용 (SSR + CSR 양쪽) |
| `images.unoptimized` | 프록시 환경에서 Image Optimization API 비활성화 (내부 fetch 문제 회피) |
| `NEXT_PUBLIC_BASE_PATH` | 환경변수. 프록시 환경에서 `/{serverKey}`, 비-Ant 환경에서 `''` |

**검증 방식**: `next.config.js` (또는 `.mjs`/`.ts`) 파일에서 `basePath` 키워드 존재 여부 확인.

**환경변수 주입**: `ProcessSpawner`가 dev script에 `next`가 포함된 것을 감지하면 `NEXT_PUBLIC_BASE_PATH=/{serverKey}` 를 자동 주입합니다.

### 5.4 검증 대상

| 프로젝트 타입 | Entry 타입 | 검증 | Validator |
|--------------|-----------|------|-----------|
| Frontend-Only (React/Vue) | frontend | basename | ReactValidator / VueValidator |
| Frontend-Only (Next.js) | frontend | basePath | NextValidator |
| Fullstack | frontend (entry) | 위와 동일 | Entry의 프레임워크에 따라 |
| Backend-Only | backend | Skip | — |

### 5.5 검증 실패 워크플로우

```
1. Preview 시작 → Validation 실패 → 서버 중단 → 에러 반환
   ↓
2. Redis에 issues 기록 → SSE로 UI에 브로드캐스트
   ↓
3. UI: 경고 + Fix 버튼 표시
   ┌────────────────────────────────────────────────┐
   │ ⚠️ basePath 설정 누락 (SSR 프로젝트)            │
   │ SSR 환경에서 에셋 경로 불일치가 발생합니다       │
   │ [Fix 🔧]                                       │
   └────────────────────────────────────────────────┘
   ↓
4. Fix 버튼 클릭 → suggestedFix를 채팅에 자동 입력
   ↓
5. AI가 코드 수정 → Preview 재시작 → 정상 작동
```

**전체 흐름**: `NextValidator.validate()` → `handleValidationFailure()` → `issueDetector.createFatalIssue(reasoning, reason, suggestedFix)` → Redis `updatePreview({issues})` → SSE broadcast → UI `PreviewStatusPanel` → "Fix" 버튼 → `setPendingChatInput({message: suggestedFix})` → 채팅 입력

### 5.6 코드 생성 가이드 (Layer 1: 예방)

새 프로젝트 생성 시 AI가 올바른 설정을 포함하도록 프롬프트 템플릿이 가이드합니다:

| 파일 | 역할 |
|------|------|
| `dev-server-setup.md` | CSR/SSR별 경로 prefix 설정 원칙, Hydration Mismatch 경고, Image Optimization 비활성화 |
| `dev-server-env-contract.md` | 플랫폼 런타임 계약 — 환경변수, 포트 바인딩, 경로 prefix |

---

## 6. Preview 생명주기

### 6.1 상태 전이 (Phase)

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

### 6.2 시작 흐름

```
1. 사용자: "Start Preview" 클릭
   ↓
2. Frontend: POST /preview/projects/:id/start { feature }
   ↓
3. 분산 락 획득 (Redis SET NX, TTL 120s) — 다른 Pod 중복 방지
   ↓
4. 프로젝트 구조 감지
   → { type: 'fullstack', packages: [frontend, backend], entry: frontend }
   ↓
5. 의존성 설치 (npm install, 타임아웃 3분) — 패키지별 순차
   ↓
6. Dev Server 기동 (npm run dev --host 0.0.0.0)
   환경변수 주입: PORT, CHOKIDAR_USEPOLLING, NEXT_PUBLIC_BASE_PATH 등
   ↓
7. 프로젝트 설정 검증 (Validator)
   ├─ 통과 → 계속
   └─ 실패 → 프로세스 kill, 에러 broadcast, 분산 락 해제
   ↓
8. SSR 프레임워크 감지 시: Redis에 nativeBasePath=true 기록
   ↓
9. Redis에 PreviewState 등록
   { host: Pod_IP, port: 30001, running: true, ready: false, nativeBasePath: true }
   ↓
10. Health Check (최대 60초, 1초 간격)
    ├─ 성공 → { ready: true } → 분산 락 해제
    └─ 실패 → 프로세스 kill → 상태 정리 → 에러 broadcast → 분산 락 해제
```

### 6.3 에러 처리 및 자동 정리

| 상황 | 처리 |
|------|------|
| npm install 실패 | 에러 broadcast, 분산 락 해제, UI에 에러 표시 |
| npm install 타임아웃 (3분) | SIGTERM → SIGKILL, 에러 broadcast |
| Health check 실패 (60초) | 모든 프로세스 kill, Redis unregister, 에러 broadcast |
| 프로세스 비정상 종료 | 모든 프로세스 사망 시 자동 cleanup |
| stopPreview 중 startPreview 진행 | cancel 플래그로 start 완료 후 자동 정리 |
| 분산 락 Pod 크래시 | TTL 120초 만료 후 다른 Pod에서 재시도 가능 |

### 6.4 프로젝트 구조 감지

| 타입 | 판단 기준 | Entry | 기동 패키지 |
|------|-----------|-------|------------|
| **Frontend-Only** | React/Vue/Vite/Next | root | root |
| **Backend-Only** | Express/NestJS | root | root |
| **Fullstack** | Frontend + Backend 디렉토리 | Frontend | 모두 |
| **Monorepo** | `workspaces` 설정 | 첫 Frontend | dev script 있는 모두 |

### 6.5 Fullstack 지원

```
/:serverKey/           → Frontend (port 30001)
/:serverKey/page       → Frontend (port 30001)
/:serverKey/api/*      → Backend  (port 30002)
```

### 6.6 API 엔드포인트

```bash
# 시작
POST /preview/projects/:id/start
Body: { feature: "localtest" }

# 중지
POST /preview/projects/:id/stop
Body: { feature: "localtest" }

# 상태 조회
GET /preview/projects/:id/status?feature=localtest

# 프로젝트 검증 (dry-run)
POST /preview/projects/:id/validate
Body: { feature: "localtest" }
```

### 6.7 Idle Timeout

마지막 접근으로부터 30분 경과 시 자동 종료. `PreviewProxy`가 요청마다 `touchPreview()` 호출.

---

## 7. Multi-Pod 아키텍처

### 7.1 Redis — Single Source of Truth

**모든 Preview 상태는 Redis에만 존재합니다.** 로컬 메모리(Map)는 프로세스 핸들 등 로컬 전용 데이터에만 사용됩니다.

```typescript
interface PreviewState {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;              // Dev Server 포트 (30000+)
  host: string;              // Pod IP (0.0.0.0에서 listen)
  running: boolean;
  ready: boolean;
  phase: string;             // idle | installing | starting | running | error
  nativeBasePath?: boolean;  // true: SSR basePath 모드 (Next.js)
  backendPort?: number;      // Fullstack: Backend 포트
  packages?: Package[];      // 패키지 목록
  issues?: PreviewIssue[];   // 검증 이슈
  startedAt?: number;
  lastAccessedAt?: number;
}
```

### 7.2 Cross-Pod 프록시

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
2. 해당 Pod가 Redis에서 serverKey → `{ host, port, nativeBasePath }` 조회
3. 실제 Dev Server가 돌고 있는 Pod IP로 프록시 (Cross-Pod)

**Sticky Session 불필요**: 어떤 Pod가 받아도 Redis 조회 후 올바른 Pod로 프록시합니다.

### 7.3 분산 락

| 항목 | 값 |
|------|-----|
| Lock key | `ant:lock:preview:{serverKey}` |
| TTL | 120초 (npm install + startup 커버) |
| 실패 시 | 자동 해제 (TTL 만료) |
| 성공 시 | Health check 완료 후 즉시 해제 |

### 7.4 Cross-Pod 상태 조회

GET `/projects/:id/status`는 다음 순서로 조회합니다:

```
1. 로컬 프로세스 핸들 확인 → 있으면 Redis 상태 + 로컬 로그 결합
2. Redis fallback → 있으면 반환 (logs 없음, 다른 Pod에서 실행 중)
3. 둘 다 없으면 → { running: false }
```

---

## 8. 클라우드 환경 제약사항

### 8.1 파일 감시 (File Watching)

워크스페이스는 **EFS (NFS 기반)**에 마운트됩니다. `inotify`는 NFS에서 작동하지 않으므로 **polling 모드**를 활성화합니다.

| 환경변수 | 대상 | 설명 |
|----------|------|------|
| `CHOKIDAR_USEPOLLING=true` | Vite (chokidar), Webpack 5+ | `fs.stat` polling 사용 |
| `CHOKIDAR_INTERVAL=3000` | Vite (chokidar) | Polling 간격 3초 (CPU 절약) |
| `WATCHPACK_POLLING=true` | Next.js, Webpack 4 (watchpack) | watchpack polling 활성화 |

### 8.2 실패 상태 전파

`startPreview` 실패 시:
1. Redis Pub/Sub로 실패 상태 브로드캐스트 → UI가 에러 표시
2. 분산 락 즉시 해제 → 재시도 가능

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
│       │   ├── ProcessSpawner.ts     # 프로세스 생성/종료 + 환경변수 주입
│       │   ├── LogManager.ts         # 로그 관리
│       │   └── DependencyInstaller.ts
│       ├── detectors/
│       │   ├── PackageDetector.ts    # Frontend/Backend/프레임워크 감지
│       │   └── ProjectStructureDetector.ts
│       └── validators/
│           ├── ProjectValidator.ts   # 프레임워크 판별 → 적절한 Validator 위임
│           ├── ReactValidator.ts     # CSR: React basename 검증
│           ├── VueValidator.ts       # CSR: Vue basename 검증
│           └── NextValidator.ts      # SSR: Next.js basePath 검증
│
├── infrastructure/networking/
│   └── PortManager.ts               # 동적 포트 할당
│
├── infrastructure/state/
│   ├── RedisStateStore.ts            # Redis 상태 관리 (PortRegistry 구현)
│   └── redisKeyUtils.ts             # Redis 키 생성/파싱 유틸
│
└── core/prompt/templates/code/base/injections/
    ├── dev-server-setup.md           # CSR/SSR 경로 prefix 설정 가이드
    └── dev-server-env-contract.md    # 플랫폼 런타임 계약
```

---

## 10. 핵심 요약

| 항목 | 설명 |
|------|------|
| **호스트** | `ant-preview.crosstoken.io` (별도 호스트) |
| **서버 키** | `{tenantId}:{userId}:{projectId}:{feature}` |
| **포트 범위** | 30000-39999 동적 할당 |
| **프록시 경로** | `/:serverKey/*` → Entry Dev Server |
| **CSR 경로 처리** | HTML 재작성 + 클라이언트 스크립트 + `window.__BASENAME__` |
| **SSR 경로 처리** | 프레임워크 네이티브 basePath + 프록시 pass-through |
| **상태 관리** | Redis (Single Source of Truth, Multi-Pod) |
| **CSR 검증** | React/Vue basename 자동 검증 + Fix 워크플로우 |
| **SSR 검증** | Next.js basePath + images.unoptimized 검증 + Fix 워크플로우 |
| **Idle Timeout** | 30분 비활성 시 자동 종료 |

---

## 부록: 용어 정리

| 용어 | 의미 |
|------|------|
| **serverKey** | `{tenantId}:{userId}:{projectId}:{feature}` — Preview를 고유 식별하는 키 |
| **nativeBasePath** | SSR 프레임워크가 자체적으로 경로 prefix를 처리하는 모드 (프록시 재작성 불필요) |
| **basename** | CSR 라우터의 base path 설정 (`window.__BASENAME__` 으로 주입) |
| **basePath** | Next.js의 네이티브 경로 prefix 설정 (`next.config.js`의 `basePath` 옵션) |
| **Hydration Mismatch** | SSR HTML과 클라이언트 번들의 속성 값 불일치로 인한 React 경고 |
| **Fallback** | serverKey 없는 요청을 Referer/Cookie로 올바른 dev server에 라우팅하는 메커니즘 |
| **hop-by-hop 헤더** | 단일 연결에서만 유효한 HTTP 헤더 (프록시가 제거해야 함) |
