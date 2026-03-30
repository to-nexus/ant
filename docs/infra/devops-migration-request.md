# [인프라 요청] CloudFront 멀티 오리진 마이그레이션

**요청일**: 2026-03-30
**요청자**: Product Engineering
**우선순위**: High
**상세 가이드**: [`docs/infra/cloudfront-multi-origin-guide.md`](./cloudfront-multi-origin-guide.md)

---

## 변경 배경

기존 `ant.crosstoken.io`는 단일 S3 오리진(ant-ui)에서 SPA를 서빙하는 구조였다.
마케팅 Site(Next.js SSG)와 Desktop 앱 바이너리 배포를 추가하면서, 하나의 CloudFront Distribution에서 3개 오리진을 경로 기반으로 분리해야 한다.

---

## AS-IS / TO-BE

### CloudFront Behaviors

| | AS-IS | TO-BE |
|---|-------|-------|
| `/api/*` | ALB origin (기존) | 변경 없음 |
| `/realtime/*` | ALB origin (기존) | 변경 없음 |
| `/ide/*` | ALB origin (기존) | 변경 없음 |
| `/app/*` | 없음 | **신규**: `app-origin` (S3: ant-ui) |
| `/downloads/*` | 없음 | **신규**: `releases-origin` (S3: ant-releases) |
| `Default (*)` | S3: ant-ui (SPA) | **변경**: `site-origin` (S3: ant-site) |

### S3 버킷

| 버킷 | AS-IS | TO-BE |
|-------|-------|-------|
| `ant-ui-{env}` | SPA 정적파일 (루트 서빙) | SPA 정적파일 (`/app/` prefix 포함) |
| `ant-site-{env}` | 없음 | **신규 생성**: 마케팅 SSG 정적파일 |
| `ant-releases-{env}` | 없음 | **신규 생성**: Desktop 앱 바이너리 |

---

## 신규 생성 필요 리소스

### 1. S3 버킷 (환경별)

| 버킷명 | 용도 | 리전 |
|--------|------|------|
| `ant-site-dev` | 마케팅 페이지 (dev) | ap-northeast-2 |
| `ant-site-stage` | 마케팅 페이지 (stage) | ap-northeast-2 |
| `ant-site-prod` | 마케팅 페이지 (prod) | ap-northeast-2 |
| `ant-releases-dev` | Desktop 바이너리 (dev) | ap-northeast-2 |
| `ant-releases-stage` | Desktop 바이너리 (stage) | ap-northeast-2 |
| `ant-releases-prod` | Desktop 바이너리 (prod) | ap-northeast-2 |

- 정적 웹 호스팅: 비활성화 (CloudFront OAC 사용)
- 퍼블릭 접근: 차단 (OAC 정책만 허용)

### 2. CloudFront Origins (환경별 Distribution에 추가)

| Origin ID | S3 버킷 | OAC |
|-----------|---------|-----|
| `site-origin` | `ant-site-{env}` | 필요 |
| `releases-origin` | `ant-releases-{env}` | 필요 |

기존 `app-origin` (ant-ui)은 유지하되, Default Behavior에서 분리하여 `/app/*` Behavior에 연결한다.

### 3. CloudFront Functions (2개)

| 함수명 | 연결 대상 | 이벤트 | 용도 |
|--------|----------|--------|------|
| `ant-spa-fallback` | `/app/*` Behavior | Viewer Request | 확장자 없는 SPA 경로를 `/app/index.html`로 리라이트 |
| `ant-site-clean-urls` | `Default (*)` Behavior | Viewer Request | Next.js SSG clean URL 리라이트 (`/pricing` → `/pricing/index.html`) |

함수 코드는 상세 가이드 Section 2.3, 2.4 참조.

### 4. CloudFront Behaviors (신규 3건)

상세 가이드 Section 2.2의 순서 4, 5, 6번 항목. Default Behavior는 origin을 `site-origin`으로 변경.

---

## 기존 리소스 변경

### ant-cli 환경변수

| 변수 | 현재 값 | 변경 후 | 비고 |
|------|--------|--------|------|
| `FRONTEND_URL` | `https://ant.crosstoken.io` | 변경 없음 (확인만) | `/app` 포함하면 안 됨. OAuth 콜백이 `returnTo` 기반으로 Site/App 분기 리다이렉트 |
| `GOOGLE_REDIRECT_URI` | `https://ant.crosstoken.io/api/auth/google/callback` | 변경 없음 | 기존과 동일 |

### Custom Error Response

기존 403/404 → `/app/index.html` 설정은 유지한다 (SPA 폴백 백업용).

---

## GitHub Actions 변수 (환경별 설정 필요)

| 변수명 | 용도 | 예시 값 (dev) |
|--------|------|--------------|
| `ANT_SITE_S3_BUCKET` | ant-site S3 버킷명 | `ant-site-dev` |
| `ANT_SITE_CF_DISTRIBUTION_ID` | CloudFront Distribution ID | `E1234ABCDEF` |

기존 `AWS_ROLE_ARN`, `AWS_REGION`은 그대로 사용.

CI/CD 워크플로우(`deploy.yml`)에 ant-site 배포 job이 이미 추가되어 있으며, 위 변수만 설정하면 자동 배포가 동작한다.

---

## 배포 순서 (다운타임 방지)

```
Phase 1: 인프라 준비
  ├─ S3 버킷 생성 (ant-site-{env}, ant-releases-{env})
  ├─ CloudFront Origin 추가 (site-origin, releases-origin)
  ├─ CloudFront Behavior 추가 (/app/*, /downloads/*, Default 변경)
  └─ CloudFront Function 생성 및 연결

Phase 2: 백엔드
  ├─ FRONTEND_URL이 도메인 루트인지 확인
  └─ ant-api, ant-job 재배포

Phase 3: 프론트엔드
  ├─ ant-site 빌드 → ant-site-{env} S3 업로드
  ├─ ant-ui 빌드 (base: '/app/') → ant-ui-{env} S3 업로드
  └─ CloudFront 캐시 무효화: /*

Phase 4: 검증
  ├─ / → Site 홈
  ├─ /app/ → App SPA
  ├─ /pricing/ → Site 서브페이지
  ├─ Site Sign In → OAuth → Site 복귀
  ├─ Site Get Started → OAuth → /app/?auth=success
  └─ App Sign In → OAuth → /app/?auth=success
```

---

## 위험도 및 롤백

| 항목 | 위험도 | 설명 |
|------|--------|------|
| Default Behavior origin 변경 | **중** | 기존 `/` 접속 시 App 대신 Site가 표시됨. 롤백 시 origin을 ant-ui로 복원 |
| `/app/*` Behavior 추가 | **저** | 신규 Behavior. 삭제하면 원복 |
| CloudFront Function | **저** | 비활성화하면 원복. S3 직접 접근에는 영향 없음 |
| FRONTEND_URL | **저** | 값 변경 없음. 확인만 필요 |

**롤백 절차**: CloudFront Distribution의 Default Behavior origin을 `ant-ui-{env}`로 복원하고, `/app/*` Behavior를 삭제하면 기존 상태로 돌아간다.
