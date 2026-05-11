# 클라우드 모드 — 개발

localhost에서 클라우드 빌드를 돌려 Ant cloud-mode 기능 (OAuth, IDE
오케스트레이션, JWT 쿠키, organization 온보딩)을 배포 없이 iterate
합니다. **페르소나 C-dev**: 클라우드 코드 경로를 로컬에서 돌리고
노트북 Chrome이 거기 붙음.

이 OAuth 가시성 없이 Ant이 그냥 돌면 되는 분은
[../local-mode/install.md](../local-mode/install.md). 프로덕션 self-host는
[install.md](install.md).

## 로컬 모드와의 차이

| 관심사 | 로컬 모드 | 클라우드 모드 dev |
|---|---|---|
| 인증 | `local:local` 테넌트, OAuth 없음 | Google OAuth + JWT 쿠키 |
| IDE 오케스트레이터 | Docker | Docker 또는 Kubernetes (선택; 로컬은 Docker가 편함) |
| Figma | 데스크탑 MCP | HTTP 브리지 |
| 쿠키 | JWT 쿠키 미발급 | 실제 프로덕션 attribute의 JWT 쿠키 |
| FE selector | 로컬 기본 | 클라우드 기본 (`VITE_CLOUD_BACKEND_BASE` 의존) |

클라우드 프로덕션과 정확히 같은 코드 경로를 돕니다 — 그게 이 모드의
존재 이유.

## 필수 env

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=cloud
ANT_REDIS_URL=redis://localhost:16379
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)
ANT_JWT_SECRET=$(openssl rand -base64 48)
ANT_API_URL=http://localhost:4100

# Google OAuth (Google Cloud Console에서 테스트 클라이언트 생성)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback

# FE allowlist
FRONTEND_URL=http://localhost:5173
ANT_CORS_ORIGINS=http://localhost:5173
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# packages/ant-ui/.env.development (FE build-time, Vite가 읽음)
VITE_CLOUD_BACKEND_BASE=http://localhost:4100
```

`VITE_CLOUD_BACKEND_BASE`가 중요한 이유 — Phase 1 launch-mode init이
검사:

- **Same-origin**이면 → 첫 로드 시 `launchMode='cloud'` 기본.
- **외부 origin**이면 → 클라우드 토글이 그쪽으로 navigate (매니지드
  `ant.crosstoken.io` 배포와 일치).
- **미설정**이면 → 클라우드 토글 disabled, 로컬 기본 (페르소나 A 구성).

FE를 `:5173`, BE를 `:4100`로 dev할 때 둘은 서로 다른 origin (포트 다름
= origin 다름). Vite dev 서버가 `/api`, `/realtime`을 `:4100`로
프록시해서 브라우저가 same-origin으로 인식 — 그래서 localStorage
stickiness와 `setLaunchMode` 토글이 navigation 없이 동작.

## OAuth 클라이언트 셋업

[Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)에서
**OAuth 2.0 Client ID** 생성:

- **Authorized JavaScript origins**:
  - `http://localhost:5173`
  - `http://localhost:4100`
- **Authorized redirect URIs**:
  - `http://localhost:4100/api/auth/google/callback`

OAuth 시작은 FE (`:5173`), callback은 BE (`:4100`)로 복귀하기 때문에 두
포트 모두 필요.

## Cross-origin dev의 CORS

로컬 dev에서 클라우드 빌드는 **`ANT_CORS_ORIGINS`를 명시 설정해야 하는
유일한 문서화 시나리오** — 실무에선 Vite proxy로 same-origin이 되지만,
프록시를 우회하면 (예: 다른 호스트의 dev BE에 프로덕션 FE 번들):

```
ANT_CORS_ORIGINS=http://localhost:5173
```

Phase 2의 `[CORS]` 시작 warn은 `FRONTEND_URL`와 `ANT_CORS_ORIGINS` 둘
다 미설정일 때 발생 — silent CORS 실패가 프로덕션에서 발견되지 않도록.

## 쿠키 정책 (소스 검증)

JWT 쿠키 attribute는
[`JwtService.getCookieOptions`](../../../packages/ant-cli/src/infrastructure/auth/JwtService.ts)에서
설정:

| Attribute | 값 | 출처 |
|---|---|---|
| `HttpOnly` | `true` | 항상. JS가 JWT 못 읽음. |
| `Secure` | 프로덕션 `true`, dev `false` | `isProduction` (Node `NODE_ENV==='production'`)에 의해. |
| `SameSite` | `lax` | 하드코드. |
| `Domain` | `localhost` / IP / 비known host에서 unset; `KNOWN_BASE_DOMAINS` 매칭 또는 `COOKIE_DOMAIN` env 설정 시 registrable 도메인 (예: `.crosstoken.io`) | `deriveCookieDomain`에 의해. |
| `Path` | `/` | 기본. |

cloud-mode dev에 미치는 영향:

- `localhost`에서 `Domain` 속성 **생략** → host-only 쿠키. 단일 origin
  dev에 맞음.
- dev에서 `Secure=false`라 쿠키가 plain HTTP로 전송. **편의 위해
  프로덕션에서 HTTPS-mode를 끄지 말 것** — 의도적으로 `NODE_ENV`로 게이트됨.
- `SameSite=lax`는 top-level navigation (OAuth redirect)에 쿠키가 가지만
  다른 registrable 도메인에서의 cross-site `fetch`에는 안 갑니다. dev에서
  다른 registrable 도메인에서 JWT 쿠키를 읽어야 하면 (매우 드묾)
  `COOKIE_DOMAIN`을 공유 부모로 설정 + `/etc/hosts`로 두 origin을 그
  아래로 서빙.
- 매칭되는 `getClearCookieOptions`가 동일한
  `domain`/`path`/`sameSite`/`secure`를 반환해야 — RFC 6265bis 요구.
  두 함수를 fork하지 말 것.

⚠️ 쿠키 `SameSite=lax` + `Secure=true`는 cross-site SSO 패턴
(`SameSite=None; Secure`)과 **동일하지 않습니다**. 배포 모양이 cross-site
쿠키 전송을 필요로 하면 (예: FE가 BE와 다른 registrable 도메인의 CDN에서
서빙) 코드 변경 필요 — 오늘 시점 env 스위치 없음.

## 실행

```bash
pnpm dev:infra:redis
pnpm dev:cloud:all
```

`pnpm dev:cloud:all`은 `ANT_SERVER_MODE=cloud`로 4 BE 프로세스 + UI dev
서버 기동. [http://localhost:5173](http://localhost:5173) 방문.

보이는 것:

- GNB selector에서 **Cloud** 활성 (Phase 1 origin-detection).
- **Sign In** 버튼 (Local Org badge 없음).
- Sign In 클릭 → Google OAuth 시작.
- OAuth 후 신규 사용자는 **Organization 온보딩** 화면 (Phase 3). 기존
  사용자는 메인 UI 직행.

## End-to-end 스모크

dev 셋업 검증용 Phase 3 온보딩 flow walk-through:

1. **Fresh consumer email로 가입** (Google 테스트 계정, 예:
   `you@gmail.com`).
2. **온보딩**이 빈 input과 함께. Skip → `personal-<userId>` 안착.
   BE 로그 확인: `[Auth] resolveOrganizationId → personal-<id>`.
3. **Fresh business email로 가입** (`you@acme.io` 2차 Google 계정).
4. **온보딩**이 `acme` prefill (`suggestedOrganizationName`). 받아들이면
   → `organizationId='acme'`.
5. **같은 도메인의 2번째 business email로 sign in** — 온보딩이 동일한
   `acme` input을 받아 → 둘 다 같은 organization (handshake 모델).
6. **`_pending` JWT로 protected route 호출** (DevTools → Network에서
   step 2 submit 전 `/api/projects` 호출) → `401 ONBOARDING_REQUIRED`.

## Local FE → Custom Cloud BE (advanced)

**로컬 FE**를 **원격 클라우드 BE**에 가리키는 것도 가능 — 실제 백엔드로
FE 디버그용. [CORS 매트릭스](install.md#cors-operating-matrix)의 ⚠️ 행:

```bash
# packages/ant-ui/.env.development
VITE_CLOUD_BACKEND_BASE=https://dev-ant.example.com
```

```bash
# 원격 BE 구성:
ANT_CORS_ORIGINS=http://localhost:5173
# (FRONTEND_URL=https://dev-ant.example.com 외에 추가)
```

이 shape은 fragile: `dev-ant.example.com`의 쿠키를 `localhost:5173`의
JavaScript가 못 읽음 (다른 registrable 도메인, host-only 쿠키,
`SameSite=lax`). HTTP 요청 디버그 한정 사용; 실제 cloud-mode FE 작업은
`pnpm dev:cloud:all` 단일 호스트 셋업 권장.

## 본 페이지가 다루지 않는 것

- **프로덕션 하드닝** — [install.md § 하드닝 체크리스트](install.md#하드닝-체크리스트).
- **Kubernetes 배포** — [install.md § 멀티테넌트 Kubernetes](install.md#멀티테넌트-kubernetes)
  + runbook [../infra/cloud-deployment-guide.md](../../infra/cloud-deployment-guide.md).
- **OAuth provider 플러그인** — 인트리는 Google만.
  `packages/ant-cli/src/infrastructure/auth/` 변경 필요.

## 다음

- [로컬 모드 — 개발](../local-mode/develop.md) — 기여 컨벤션 (양 모드
  공통).
- [AGENTS.md](../../../AGENTS.md) — 구속력 있는 아키텍처 규칙.
- [../internals/37-auth-unified-procedure.md](../../internals/37-auth-unified-procedure.md) —
  인증 flow 내부.
