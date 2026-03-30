# CloudFront 이중 오리진 배포 가이드

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
- **구조 예시**:
  ```
  desktop/latest/macos-arm64.dmg
  desktop/latest/macos-x64.dmg
  desktop/latest/windows-x64.exe
  desktop/latest/linux-x64.deb
  desktop/latest/linux-x64.AppImage
  desktop/v0.1.0/...
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

---

## 4. 배포 순서

아래 순서를 지키면 다운타임 없이 마이그레이션할 수 있다.

### Phase 1: 인프라 준비

1. S3 버킷 생성: `ant-site-{env}`, `ant-releases-{env}`
2. CloudFront Distribution에 새 오리진 추가
3. Behavior 추가 (위 2.2 순서대로)
4. CloudFront Function 생성 및 연결

### Phase 2: ant-cli 환경변수 업데이트

5. `FRONTEND_URL` 업데이트: `https://ant.crosstoken.io` → `https://ant.crosstoken.io/app`
6. ant-cli 서비스 재배포 (ant-api, ant-job 모두)

### Phase 3: 프론트엔드 배포

7. `ant-site` 빌드 후 `ant-site-{env}` S3 업로드
8. `ant-ui` 빌드 후 `ant-ui-{env}` S3 업로드 (새 빌드: `base: '/app/'` 포함)
9. CloudFront 캐시 무효화: `/*`

### Phase 4: 검증

10. `https://ant.crosstoken.io/` → Site 홈 확인
11. `https://ant.crosstoken.io/app` → App SPA 로드 확인
12. `https://ant.crosstoken.io/app?auth=success` → OAuth 리다이렉트 확인
13. `https://ant.crosstoken.io/pricing/` → Site 서브페이지 확인
14. 기존 북마크 `https://ant.crosstoken.io` → Site 홈으로 정상 이동 확인

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

로컬에서는 3개 서비스가 서로 다른 포트에서 실행된다:

| 서비스 | URL | 명령어 |
|--------|-----|--------|
| ant-site (Next.js) | `http://localhost:4300` | `pnpm dev:site` |
| ant-ui (Vite SPA) | `http://localhost:4200/app` | `pnpm dev:ui` |
| ant-cli (API) | `http://localhost:4100` | `pnpm dev:local` |

- Site의 "Sign In" / "Get Started" 링크는 `/app`으로 연결 → 로컬에서는 `http://localhost:4200/app`으로 수동 이동 필요
- Vite dev 서버는 `base: '/app/'` 설정으로 `http://localhost:4200/app/`에서 서빙

---

## 7. ant-desktop 릴리즈 배포

GitHub Actions에서 ant-desktop 릴리즈 시 빌드 산출물을 S3 `ant-releases-{env}` 버킷으로 업로드한다.

```yaml
- name: Upload release artifacts
  run: |
    VERSION=${{ github.ref_name }}
    aws s3 cp dist/macos-arm64.dmg s3://ant-releases-${ENV}/desktop/${VERSION}/macos-arm64.dmg
    aws s3 cp dist/macos-x64.dmg s3://ant-releases-${ENV}/desktop/${VERSION}/macos-x64.dmg
    aws s3 cp dist/windows-x64.exe s3://ant-releases-${ENV}/desktop/${VERSION}/windows-x64.exe
    aws s3 cp dist/linux-x64.deb s3://ant-releases-${ENV}/desktop/${VERSION}/linux-x64.deb
    aws s3 cp dist/linux-x64.AppImage s3://ant-releases-${ENV}/desktop/${VERSION}/linux-x64.AppImage
    
    # latest 심링크 업데이트
    aws s3 sync s3://ant-releases-${ENV}/desktop/${VERSION}/ s3://ant-releases-${ENV}/desktop/latest/ --delete
```
