# CloudFront 멀티 오리진 배포 가이드

## 개요

`ant.crosstoken.io` 도메인에서 3개의 서로 다른 오리진을 하나의 CloudFront Distribution으로 서빙한다.

| 경로 패턴 | 오리진 | 서비스 | 콘텐츠 |
|-----------|--------|--------|--------|
| `/app/*` | S3: `ant-ui-{env}` | ant-ui (Vite SPA) | React 앱 정적 파일 |
| `/downloads/*` | S3: `ant-releases-{env}` | 릴리즈 바이너리 | Desktop 앱 설치파일 |
| `/*` (default) | S3: `ant-site-{env}` | ant-site (Next.js SSG) | 마케팅 페이지 |

백엔드 서비스(`/api/*`, `/realtime/*`, `/ide/*`)는 별도 도메인(`ant-server.crosstoken.io`)의 ALB로 라우팅되며 이 가이드의 범위가 아니다.

---

## 1. S3 버킷

### 1.1 ant-site-{env}

- **용도**: 마케팅 페이지 정적 파일 (Next.js `output: 'export'` 빌드 결과물)
- **빌드 출력**: `packages/ant-site/out/`
- **구조 예시**:
  ```
  index.html
  figma/index.html
  capabilities/index.html
  pricing/index.html
  download/index.html
  legal/terms-of-use/index.html
  legal/privacy-policy/index.html
  _next/static/...
  favicon.svg
  logo-dark.svg
  logo-light.svg
  ```
- **정적 웹 호스팅**: 비활성화 (CloudFront OAC 사용)
- **퍼블릭 접근**: 차단 (OAC 정책만 허용)

### 1.2 ant-ui-{env}

- **용도**: React SPA 정적 파일 (Vite `base: '/app/'` 빌드 결과물)
- 기존 버킷 사용. 빌드 출력물이 `/app/` 접두사 포함.

### 1.3 ant-releases-{env} (신규)

- **용도**: Ant Desktop 설치파일 (`.dmg`, `.exe`, `.deb`, `.AppImage`)
- **S3 키 = URL 경로** (CloudFront가 full path를 그대로 전달)
- **구조 예시**:
  ```
  downloads/desktop/latest/macos-arm64.dmg
  downloads/desktop/latest/macos-x64.dmg
  downloads/desktop/latest/windows-x64.exe
  downloads/desktop/latest/linux-x64.deb
  downloads/desktop/latest/linux-x64.AppImage
  downloads/desktop/v0.1.0/...
  ```

---

## 2. CloudFront Distribution 설정

### 2.1 Origins

| Origin ID | Domain | Origin Path | OAC |
|-----------|--------|-------------|-----|
| `site-origin` | `ant-site-{env}.s3.ap-northeast-2.amazonaws.com` | (없음) | O |
| `app-origin` | `ant-ui-{env}.s3.ap-northeast-2.amazonaws.com` | (없음) | O |
| `releases-origin` | `ant-releases-{env}.s3.ap-northeast-2.amazonaws.com` | (없음) | O |

### 2.2 Behaviors (우선순위 순)

| 순서 | Path Pattern | Origin | Cache Policy | 비고 |
|------|-------------|--------|--------------|------|
| 1 | `/api/*` | ALB origin | CachingDisabled | 백엔드 API (기존) |
| 2 | `/realtime/*` | ALB origin | CachingDisabled | SSE 스트림 (기존) |
| 3 | `/ide/*` | ALB origin | CachingDisabled | WebSocket (기존) |
| 4 | `/app/*` | `app-origin` | CachingOptimized | SPA 정적파일 |
| 5 | `/downloads/*` | `releases-origin` | CachingOptimized | 바이너리 다운로드 |
| 6 | `Default (*)` | `site-origin` | CachingOptimized | 마케팅 페이지 |

### 2.3 CloudFront Function: SPA Fallback

`/app/*` behavior에 Viewer Request 함수를 연결하여, 파일 확장자가 없는 경로를 `/app/index.html`로 리라이트한다 (SPA client-side routing 지원).

```javascript
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  // /app/ 하위 경로 중 확장자가 없으면 → /app/index.html
  if (uri.startsWith('/app') && !uri.includes('.')) {
    request.uri = '/app/index.html';
  }
  
  return request;
}
```

### 2.4 CloudFront Function: Site Clean URLs

`Default (*)` behavior에 Viewer Request 함수를 연결하여 Next.js SSG의 `trailingSlash: true` 출력에 맞게 리라이트한다.

```javascript
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  // 루트는 그대로
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }
  
  // 확장자가 있으면 그대로 (JS, CSS, SVG, 이미지 등)
  if (uri.includes('.')) {
    return request;
  }
  
  // /figma → /figma/index.html
  if (!uri.endsWith('/')) {
    uri += '/';
  }
  request.uri = uri + 'index.html';
  
  return request;
}
```

---

## 3. 404 에러 처리

### 3.1 Custom Error Response

CloudFront Distribution > Error Pages:

| HTTP Error Code | Response Page Path | Response Code | TTL |
|-----------------|-------------------|---------------|-----|
| 403 | `/app/index.html` | 200 | 0 |
| 404 | `/app/index.html` | 200 | 0 |

이 설정은 `/app/*` SPA 라우트에 대한 폴백이다. 사용자가 `/app/some-route`를 직접 방문하면 S3에서 404가 발생하고, CloudFront가 `/app/index.html`을 반환하여 React Router가 클라이언트에서 처리한다.

> **주의**: CloudFront Function (2.3)이 정상 동작하면 이 Custom Error Response는 백업용이다. 두 방식 모두 설정하는 것을 권장한다.

### 3.2 Site 404 처리

Custom Error Response는 Distribution 전체에 적용되므로 Site 경로(`/pricing/typo` 등)에서 발생한 404도 `/app/index.html`로 리다이렉트된다. 이는 CloudFront Function (2.4)이 정상 동작할 때는 문제가 되지 않는다 — SSG 빌드 시점에 모든 페이지가 `index.html`로 출력되기 때문이다.

만약 Site 전용 404 페이지가 필요하다면, Next.js의 `not-found.tsx`를 활용하여 `404/index.html`을 빌드 출력하고, CloudFront Function (2.4)에서 S3 응답이 403/404일 때 `/404/index.html`로 리라이트하는 별도 Origin Response 함수를 추가해야 한다. 현재는 이 설정 없이도 정상 동작한다.

---

## 4. 배포 순서

아래 순서를 지키면 다운타임 없이 마이그레이션할 수 있다.

### Phase 1: 인프라 준비

1. S3 버킷 생성: `ant-site-{env}`, `ant-releases-{env}`
2. CloudFront Distribution에 새 오리진 추가
3. Behavior 추가 (위 2.2 순서대로)
4. CloudFront Function 생성 및 연결

### Phase 2: ant-cli 환경변수 확인

5. `FRONTEND_URL`이 **도메인 루트**(`https://ant.crosstoken.io`)인지 확인한다. `/app`을 포함하면 안 된다.
   - OAuth 콜백에서 `returnTo` 파라미터 기반으로 Site(`/`) 또는 App(`/app/`)으로 리다이렉트하므로, `FRONTEND_URL`은 경로 없는 도메인이어야 한다.
   - `GOOGLE_REDIRECT_URI`는 `https://ant.crosstoken.io/api/auth/google/callback` (기존과 동일).
6. ant-cli 서비스 재배포 (ant-api, ant-job 모두)

### Phase 3: 프론트엔드 배포

7. `ant-site` 빌드 후 `ant-site-{env}` S3 업로드
8. `ant-ui` 빌드 후 `ant-ui-{env}` S3 업로드 (새 빌드: `base: '/app/'` 포함)
9. CloudFront 캐시 무효화: `/*`

### Phase 4: 검증

**정적 페이지 검증**:
10. `https://ant.crosstoken.io/` → Site 홈 확인
11. `https://ant.crosstoken.io/app/` → App SPA 로드 확인 (GNB에 Sign In 버튼)
12. `https://ant.crosstoken.io/pricing/` → Site 서브페이지 확인
13. `https://ant.crosstoken.io/legal/terms-of-use/` → Legal 페이지 확인

**OAuth 인증 흐름 검증**:
14. Site "Sign In" 클릭 → Google OAuth → Site 원래 페이지로 복귀 (로그인 유지)
15. Site "Get Started" 클릭 → Google OAuth → `/app/?auth=success`로 리다이렉트 → App 정상 로드
16. App "Sign In" 클릭 → Google OAuth → `/app/?auth=success`로 리다이렉트 → App 정상 로드
17. 로그인 상태에서 `https://ant.crosstoken.io/` 접속 → Site GNB에 사용자 아바타 + 드롭다운 표시
18. 로그인 상태에서 `/app/` 새 탭 접속 → 쿠키 기반 세션 자동 복원 (auth=success 없이도 로그인 유지)

---

## 5. CI/CD 변수 (GitHub Actions)

| 변수명 | 용도 | 예시 값 |
|--------|------|---------|
| `ANT_SITE_S3_BUCKET` | ant-site S3 버킷명 | `ant-site-dev` |
| `ANT_SITE_CF_DISTRIBUTION_ID` | ant-site용 CloudFront Distribution ID | `E1234ABCDEF` |
| `AWS_ROLE_ARN` | OIDC 기반 AWS 인증 역할 | (기존 사용 중) |
| `AWS_REGION` | AWS 리전 | `ap-northeast-2` |

---

## 6. 로컬 개발

### 6.1 서비스 포트

| 서비스 | URL | 명령어 |
|--------|-----|--------|
| ant-ui (Vite SPA) | `http://localhost:4200/app/` | `pnpm dev:ui` |
| ant-site (Next.js) | `http://localhost:4300` | `pnpm dev:site` |
| ant-cli (API) | `http://localhost:4100` | `pnpm dev:local` 또는 `pnpm dev:local:all` |

### 6.2 통합 프록시 (antSiteProxy)

`localhost:4200` 하나로 Site + App 모두 접근 가능하다. Vite에 커스텀 플러그인(`antSiteProxy`)이 설정되어 있어, `/app/` 이외의 경로는 자동으로 `localhost:4300` (Next.js)으로 프록시된다.

```
localhost:4200/           → proxy → localhost:4300  (Site 홈)
localhost:4200/pricing/   → proxy → localhost:4300  (Site 서브페이지)
localhost:4200/app/       → Vite 직접 서빙           (App SPA)
localhost:4200/api/*      → proxy → localhost:4100  (백엔드 API)
localhost:4200/realtime/* → proxy → localhost:4101  (SSE)
localhost:4200/ide/*      → proxy → localhost:4100  (WebSocket)
```

프록시 대상 판정 로직 (`packages/ant-ui/vite.config.ts`):
- `/app`, `/api`, `/ide`, `/realtime`, `/@`, `/__`, `/node_modules`, `/src` 로 시작하는 경로 → Vite가 직접 처리
- 그 외 모든 경로 → Next.js dev 서버로 프록시
- `/app` (trailing slash 없음) → 자동 301 리다이렉트 → `/app/`

### 6.3 로컬에서 인증 흐름

Site와 App이 같은 `localhost:4200` 호스트에서 서빙되므로, JWT 쿠키가 자동으로 공유된다.

- Site "Sign In" → `/api/auth/google?returnTo=/pricing/` → OAuth → `localhost:4200/pricing/` 복귀
- Site "Get Started" → `/api/auth/google?returnTo=/app/` → OAuth → `localhost:4200/app/?auth=success` 복귀
- App "Sign In" → `/api/auth/google?returnTo=/app/` → OAuth → `localhost:4200/app/?auth=success` 복귀
- 로그인 후 `/app/` 새 탭 접속 시 쿠키 기반 세션 자동 복원 (`GET /api/auth/me`)

> **참고**: `ant-site`만 직접 접속(`localhost:4300`)하면 `/api/*` 프록시가 없어 인증 API가 동작하지 않는다. 인증 테스트 시에는 반드시 `localhost:4200` 경유로 접근해야 한다.

---

## 7. 인증 흐름 (OAuth returnTo)

Site와 App은 같은 도메인(`ant.crosstoken.io`)에서 서빙되므로 JWT `httpOnly` 쿠키가 자동으로 공유된다.

### 7.1 returnTo 매개변수

OAuth 시작 시 `returnTo` 쿼리 파라미터로 인증 후 리다이렉트 대상을 지정한다.

| 트리거 | returnTo 값 | 인증 후 도착지 |
|--------|-------------|---------------|
| Site "Sign In" | 현재 Site 경로 (예: `/pricing/`) | Site 원래 페이지 |
| Site "Get Started" | `/app/` | `/app/?auth=success` |
| App "Sign In" / "Sign Up" | `/app/` | `/app/?auth=success` |

### 7.2 백엔드 동작

1. `GET /api/auth/google?returnTo=/app/` — `returnTo` 값을 OIDC state와 함께 Redis에 저장 (TTL 5분)
2. Google OAuth 완료 후 `GET /api/auth/google/callback` — Redis에서 `returnTo` 조회
3. JWT 쿠키 설정 후 `returnTo` 경로로 리다이렉트
   - `returnTo`가 `/app`으로 시작하면 `?auth=success` 쿼리 파라미터 추가 (App.tsx 세션 감지용)
   - 그 외 경로(Site)는 쿼리 파라미터 없이 리다이렉트 (쿠키만으로 인증 상태 판단)

### 7.3 세션 복원

- App(`/app/`)에 직접 접속 시 `?auth=success` 없이도 `GET /api/auth/me`로 쿠키 기반 세션을 자동 복원한다.
- Site에서는 페이지 로드 시 `fetch('/api/auth/me')` 호출로 인증 상태를 확인하고, 로그인된 사용자에게 아바타 + 드롭다운 메뉴를 표시한다.

### 7.4 로그아웃

`POST /api/auth/signout` — JWT 쿠키를 삭제한다. Site와 App 모두 이 엔드포인트를 사용한다.

---

## 8. ant-desktop 릴리즈 배포

`ant-desktop/.github/workflows/release.yml`의 `upload-cdn` job이 자동 처리한다.
S3 키는 CloudFront URL 경로와 1:1 매칭 (`/downloads/desktop/...`).

```yaml
# release.yml upload-cdn job 핵심 동작:
# 1. gh release download → artifacts/
# 2. rename: *_aarch64.dmg → macos-arm64.dmg 등
# 3. versioned upload
aws s3 sync renamed/ s3://ant-releases-${ENV}/downloads/desktop/${TAG}/ \
  --cache-control "public, max-age=31536000, immutable"
# 4. latest update
aws s3 sync s3://ant-releases-${ENV}/downloads/desktop/${TAG}/ \
  s3://ant-releases-${ENV}/downloads/desktop/latest/ \
  --delete --cache-control "public, max-age=3600" --metadata-directive REPLACE
# 5. CF invalidation
aws cloudfront create-invalidation --distribution-id $CF_ID \
  --paths "/downloads/desktop/${TAG}/*" "/downloads/desktop/latest/*"
```
