# 클라우드 모드 — 설치

두 클라우드 경로, 한 페이지:

1. **[매니지드 (페르소나 B)](#managed-personab)** — `ant.crosstoken.io`에
   가입하고 인프라 신경 끄기. 가장 빠른 시작.
2. **[Self-host 클라우드 (페르소나 C)](#self-host-cloud-personac)** —
   동일한 클라우드 빌드를 자기 인프라에서 (단일 VM, 단일 K8s
   네임스페이스, 멀티테넌트 클러스터).

원격 인증 없이 노트북 하나에서만 Ant이 필요하면
[local-mode/install.md](../local-mode/install.md) 쪽이 맞습니다.

런타임은 로컬 / 매니지드 / self-host 클라우드 모두 동일 — 운영자
관점만 다릅니다. 로컬 모드와 클라우드 모드는 동일 Redis + BullMQ 데이터
플레인.

---

## 매니지드 (페르소나 B) <a id="managed-personab"></a>

### 가입

1. [ant.crosstoken.io](https://ant.crosstoken.io) 방문.
2. Google OAuth로 가입.
3. OAuth 후 **Organization 온보딩 화면** (Phase 3 도입):
   - **Business email** (예: `you@acme.io`): second-level 도메인
     (`acme`)이 prefill된 input. 받아들여 `acme`에 합류 (또는 신규 생성),
     또는 다른 이름으로 별도 organization 생성.
   - **Consumer email** (gmail, naver, hotmail, …): 빈 input. 이름을
     적어 생성하거나 Skip → `personal-<userId>`에 안착.
   - **자동완성**: 타이핑하면 기존 organization 검색. 선택하면 합류
     (handshake 모델 — 자유 합류, 오늘 시점 승인 게이트 없음).
4. 온보딩 후 메인 UI 진입. 선택한 `organizationId`는 JWT 쿠키에 저장.

이것이 셋업 전부 — 빌링/리텐션/지원/인프라 매니지드.

### 매니지드 플랜 포함

- Anthropic Claude 1차 LLM, 매니지드 quota.
- 사용자별 Cloud IDE pod (브라우저 K8s 백 VSCode).
- 매니지드 EFS 워크스페이스 저장소.
- 클라우드 HTTP 브리지 통한 Figma MCP (데스크탑 MCP 불필요).

### Limits

쿼터, 허용 concurrency, 리텐션 정책은
[ant.crosstoken.io/pricing](https://ant.crosstoken.io)에 게시됩니다.
이 문서가 drift되지 않도록 의도적으로 중복하지 않습니다.

### Self-host로 갈 때

- 자체 LLM 키 (Anthropic enterprise, Azure OpenAI, 온프렘 추론).
- 컴플라이언스가 매니지드 멀티테넌트 저장을 금지.
- 프롬프트 또는 그래프 노드 fork.

→ [self-host 클라우드](#self-host-cloud-personac).

---

## Self-host 클라우드 (페르소나 C) <a id="self-host-cloud-personac"></a>

자기 인프라에서 클라우드 빌드 실행. 두 shape, 동일한
`ANT_SERVER_MODE=cloud` 코드 경로:

| Shape | 어디서 | 언제 |
|---|---|---|
| **단일 호스트 클라우드** | 1 VM, Docker for Redis | 팀-of-N, Kubernetes 부담 없이, OAuth 필요 |
| **멀티테넌트 클러스터** | K8s (EKS / GKE / AKS / 온프렘) | 다수 팀, 격리, 사용자별 Cloud IDE pod |

운영 차이일 뿐, 아키텍처 차이 아님. 둘 다 동일 OAuth, 동일 Redis 기반
상태, 동일 JWT 쿠키, 동일 IDE 오케스트레이션 인터페이스. IDE
오케스트레이터는 `ANT_K8S_NAMESPACE`가 설정되면 Kubernetes, 아니면
Docker를 선택.

### 사전 준비

- Node 18.17+, pnpm 10+, Docker (단일 호스트, 또는 K8s 이미지 빌드용).
- 등록된 **Google OAuth Client** (다른 provider는 pluggable, 인트리
  기본값은 Google).
- 클라우드 배포 시 매니지드 Redis (ElastiCache, Memorystore, Upstash);
  단일 호스트는 Docker Compose OK.
- TLS termination — OAuth 쿠키가 정상 전송되도록 운영상 필수 (`Secure`
  속성은 `NODE_ENV=production`에서 set).

### 필수 env

모든 클라우드 배포 mandatory 4종:

| 변수 | 메모 |
|---|---|
| `ANT_SERVER_MODE=cloud` | `local:local` 우회 비활성, OAuth + JWT 활성. |
| `ANT_REDIS_URL` | `redis://…` 또는 TLS는 `rediss://…`. |
| `ANT_ENCRYPTION_KEY` | 64자 hex. `openssl rand -hex 32`. |
| `ANT_JWT_SECRET` | 32+ 자. JWT 쿠키 서명 키. |

OAuth (인트리 Google):

| 변수 | 메모 |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). |
| `GOOGLE_REDIRECT_URI` | split-host 배포에만 필요. 단일 호스트는 `FRONTEND_URL`에서 derive. |

FE origin + CORS:

| 변수 | 메모 |
|---|---|
| `FRONTEND_URL` | 1차 FE origin. 단일 호스트에선 OAuth redirect base 겸용. |
| `ANT_CORS_ORIGINS` | 추가 FE origin CSV. split-host 또는 dev cross-origin에. |

CORS + OAuth + FRONTEND_URL은 의도적으로 하나의 predicate — 분리하면
open-redirect 리스크. 5 canonical 시나리오:
[CORS 운영 매트릭스](#cors-operating-matrix) 참조.

IDE 오케스트레이션:

| 변수 | 메모 |
|---|---|
| `ANT_K8S_NAMESPACE` | Kubernetes IDE 오케스트레이터 활성. 미설정시 Docker. |
| `ANT_EFS_PVC_NAME` | 워크스페이스 저장소를 마운트하는 PVC 이름. |
| `ANT_IDE_IMAGE` | Cloud IDE 사용자 컨테이너 이미지. 기본 `gitpod/openvscode-server:latest`. |
| `ANT_IDE_HOSTNAME_MODE` | `user` (사용자별 호스트네임) 또는 `feature` (피처별). |

Frontend build-time:

| 변수 | 메모 |
|---|---|
| `VITE_CLOUD_BACKEND_BASE` | 클라우드 빌드 API origin. Same-origin → 인앱 토글; 외부 origin → navigate. |
| `VITE_PREVIEW_HOST` | Preview 서버 origin (split-host용). |
| `VITE_ANT_SITE_URL` | 로그아웃 redirect의 마케팅 사이트 URL. |

전체 env: [../reference/env-vars.md](../../reference/env-vars.md).

### 단일 호스트 클라우드

1 VM, 4 BE 프로세스 + Docker Redis. OAuth는 필요하지만 K8s는 부담스러운
작은 팀에 적합.

```bash
git clone https://github.com/<org>/ant
cd ant
pnpm install

cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# packages/ant-cli/.env 편집:
#   ANT_SERVER_MODE=cloud
#   ANT_REDIS_URL=redis://localhost:16379
#   ANT_ENCRYPTION_KEY=<64자 hex>
#   ANT_JWT_SECRET=<32+자 시크릿>
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   FRONTEND_URL=https://ant.mycompany.com
#   ANT_API_URL=http://localhost:4100

pnpm dev:infra:redis        # Docker Redis 기동
pnpm build && pnpm start:all
```

TLS termination 리버스 프록시 (nginx / Caddy / Traefik) 뒤에 둡니다:

| 경로 | Upstream | 메모 |
|---|---|---|
| `/api/*` | `:4100` | REST. |
| `/realtime/*` | `:4101` | SSE. 프록시 버퍼링 비활성; `proxy_read_timeout 1d`. |
| `/preview/*` | `:4102` | 피처별 dev 서버. 버퍼링 비활성. |
| `/` | `:5173` 또는 static `packages/ant-ui/dist` | SPA. |

Google Cloud Console OAuth 설정:

- **Authorized JavaScript origins** — 사용자 `FRONTEND_URL`.
- **Authorized redirect URIs** —
  `<FRONTEND_URL>/api/auth/google/callback`.

### 멀티테넌트 Kubernetes

멀티팀 프로덕션. 각 BE 프로세스는 자기 Deployment; Cloud IDE pod은
요청 시 `KubernetesIDEOrchestrator`가 기동.

**배포할 것** (Deployment + 일반 replica):

| Deployment | Replica | 용도 |
|---|---|---|
| `ant-api` | 2+ | REST + IDE proxy, Service 뒤 |
| `ant-realtime` | 2+ | 채팅 / 워크플로 SSE |
| `ant-job` | 2+ (or KEDA-scaled) | `job-runner` spawn하는 BullMQ worker |
| `ant-preview` | 2+ | 피처별 dev-server 라이프사이클 |
| `ant-ui` | 2+ | SPA (또는 CDN — S3 + CloudFront) |

추가:

- **Redis** — ElastiCache / Memorystore / Upstash; Redis 6+. TLS
  지원 (`rediss://…`). Redis ACL로 auth user를 `ant:*` key prefix만
  제한.
- **공유 워크스페이스 볼륨** — EFS (AWS) / Filestore (GCP) / NFS.
  동일 볼륨을 `ant-job`, `ant-preview`, 모든 IDE pod에 마운트.
- **(선택) Vector DB** — ChromaDB. 기본 OFF.
  [AGENTS.md](../../../AGENTS.md)의 invariant + gate site 참조.

#### 클러스터 필요 요소

- 적절한 CSI 드라이버 (AWS EFS CSI / GCP Filestore CSI)와 함께 **EKS
  / GKE / AKS**.
- **Ingress controller** — ALB / nginx / Traefik. `/realtime/*`,
  `/preview/*` 버퍼링 비활성 필수.
- `ANT_JWT_SECRET`, `ANT_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, LLM
  키용 **External Secrets**. ConfigMap에 넣지 말 것.

#### 운영 규칙

- **모든 서비스 Round-robin LB.** Redis 백 상태로 sticky session
  불필요; 모든 pod이 pub/sub하므로 SSE OK.
- **`ant-job`은 종료 보호 필요.** 장시간 잡 (5-30분)은 `preStop` +
  `terminationGracePeriodSeconds` 신중하게.
  [레거시 인프라 runbook §2.3](../../infra/cloud-deployment-guide.md#23-ant-job-%E2%9A%A0-long-running-jobs)
  참조 (해당 내용이 본 문서로 fold될 때까지).
- **IDE pod은 사용자별 / 프로젝트별.** 오케스트레이터가 동일 EFS를
  IDE pod의 `/workspace`에 마운트. EFS open file handle + 삭제 시
  `fs.rm` race가 `Project already exists` 409의 근본 원인 — cleanup
  cascade SSOT는
  [AGENTS.md § "Project / Feature Lifecycle SSOT"](../../../AGENTS.md).

#### CloudFront / 멀티 origin 프론트

UI를 별도 origin (CDN 호스팅 번들, BE가 다른 호스트)에서 서빙하면
[../infra/cloudfront-multi-origin-guide.md](../../infra/cloudfront-multi-origin-guide.md)
의 CORS / 쿠키 / CSP 설정 참조. 쿠키 `Domain` 속성은
`JwtService.deriveCookieDomain`이 derive — 값을 강제하려면
`COOKIE_DOMAIN` env, 또는 소스의 `KNOWN_BASE_DOMAINS`에 등록 가능한
도메인 추가.

#### Long-form 런북

상세 step-by-step EKS 배포 가이드 — IAM, Helm value, EFS CSI 드라이버
버전, ElastiCache custom CNAME TLS, `ant-job` KEDA ScaledObject,
per-tenant 리소스 제한 — 는
[../infra/cloud-deployment-guide.md](../../infra/cloud-deployment-guide.md)에
있습니다. 그 파일은 배포 실행하는 DevOps팀 대상; 본 페이지는 운영자
overview.

### CORS 운영 매트릭스 <a id="cors-operating-matrix"></a>

5 canonical 시나리오; 그중 2개만 명시 env 필요.
[corsConfig.ts](../../../packages/ant-cli/src/periphery/adapters/http/middleware/corsConfig.ts)
의 5-step priority — no Origin → `*` → self-origin → `FRONTEND_URL` →
`ANT_CORS_ORIGINS`.

| 시나리오 | `FRONTEND_URL` | `ANT_CORS_ORIGINS` | 메모 |
|---|---|---|---|
| Local↔Local (페르소나 A) | unset | unset | Loopback 자동 허용. env 0. |
| 매니지드 same-origin (페르소나 B) | `https://ant.crosstoken.io` | (운영) | Self-origin 자동 허용. |
| Cloud↔Cloud same-origin (페르소나 C 단일 호스트) | `https://ant.mycompany.com` | unset | Self-origin 자동 허용. `FRONTEND_URL` 외 env 0. |
| Cloud↔Cloud split-host | `https://app.mycompany.com` | (선택) | `FRONTEND_URL` allowlist. |
| ⚠️ Local FE → Custom Cloud BE (dev) | (클라우드 FE 값) | `'http://localhost:5173'` | [develop.md § Local FE → 원격 클라우드 BE](../develop.md) 참조. |

클라우드 모드에서 **둘 다** 미설정이면 BE가 `[CORS]` 시작 warn —
split-host 배포가 silent fail하지 않도록. Phase 2에서 추가.

### Auth

클라우드 모드는 OAuth 필수. `local:local` 우회 없음. Flow (Phase 3
도입):

1. Google OAuth가 `<FRONTEND_URL>/api/auth/google/callback`에 복귀.
2. BE가 user 조회. **기존 user** → 결정된 `organizationId`로 full JWT →
   메인 UI.
3. **신규 user** → `_pending` JWT (센티넬) 발급 + FE를
   `?onboarding=true`로 redirect.
4. FE가 `OrganizationOnboardingScreen` 렌더 (`/auth/me`의
   `suggestedOrganizationName`으로 input prefill; consumer는 빈
   input).
5. POST `/api/auth/onboarding/organization`이 `organizationId` 해소
   (slugify + reserved-name check + free join), BE가 full JWT 재발급.

`_pending` JWT는 가드됨 — `/api/auth/me`,
`/api/auth/onboarding/organization`, `/api/organizations` 외의
protected route는 `401 ONBOARDING_REQUIRED`로 거절. SSOT는
[AGENTS.md](../../../AGENTS.md).

### 백업

두 가지:

- **워크스페이스 저장소** — 생성 산출물, 세션, 코드베이스. EFS /
  Filestore / NFS 스냅샷.
- **Redis** — in-flight 잡 상태. RDB 또는 AOF.

둘 다 손실 시 복구 가능하지만 (잡은 마지막 체크포인트에서 replay;
코드베이스는 각 프로젝트 git remote에서 재클론), 스냅샷이 있으면 빠릅니다.

### 하드닝 체크리스트

- [ ] 모든 공개 엔드포인트 앞 TLS termination 리버스 프록시.
- [ ] `ANT_ENCRYPTION_KEY`, `ANT_JWT_SECRET`을 시크릿 매니저
      (AWS Secrets Manager, Vault, K8s External Secrets)에서.
- [ ] LLM provider 키 분기별 로테이션.
- [ ] Ingress 제한: UI origin + 자체 integration만 `/api/` 도달.
- [ ] Cloud IDE 미사용 시 비활성 (`/api/cloud-ide/*` + 오케스트레이터,
      라우트 등록으로 gate).
- [ ] Redis ACL이 `ant:*` key prefix로 제한.
- [ ] `ANT_TASK_CONCURRENCY`를 LLM rate-limit 예산에 cap.
- [ ] 레포 보안 advisory 구독 ([../../SECURITY.md](../../../SECURITY.md)).

### 운영 체크리스트

**Pre-launch**

- [ ] 리버스 프록시가 `/realtime/*`, `/preview/*` 버퍼링 비활성.
- [ ] EFS / 공유 볼륨 마운트 타깃이 모든 AZ에 존재.
- [ ] `[CORS]` 시작 로그가 기대 allowlist 표시 (Phase 2 warn).
- [ ] OAuth redirect URI가 BE의 `GOOGLE_REDIRECT_URI` / derive URI와 일치.

**Day-2**

- [ ] BullMQ queue depth > N 알림 (worker 처리 못 따라감).
- [ ] Redis 메모리 압박 알림.
- [ ] `ant-api` 5xx rate 알림.
- [ ] 주기적 chaos: 랜덤 worker kill 후 잡이 체크포인트에서 재개되는지.
- [ ] 주기적 복원 테스트 (Redis + 공유 볼륨 백업).

### 트러블슈팅

- **삭제 후 "Project already exists" 409** — cleanup cascade
  (cancelJobs → cleanupIDE → previewCleanup → redisCleanup → fs.rm)이
  끝까지 돌아야. [getting-started/troubleshooting.md § "Project
  already exists"](../../getting-started/troubleshooting.md#project-already-exists-on-createproject).
- **Redis TLS 검증 오류** — ElastiCache + custom CNAME 처리는
  `RedisStateStore`. [../internals/02-infrastructure.md](../../internals/02-infrastructure.md).
- **IDE pod이 `Terminating` 행** — 오케스트레이터가 `deletionTimestamp`
  polling; 보통 60s. 안 풀리면 `ant-api` 재기동.
- **OAuth callback 404 / 호스트 오류** — `GOOGLE_REDIRECT_URI` (또는
  `FRONTEND_URL`에서 derive)가 provider 등록값과 일치해야.
- **CORS가 split-host에서 silent fail** — Phase 2 시작 warn이 여기.
  `FRONTEND_URL` 또는 `ANT_CORS_ORIGINS`.

---

## 다음

- [개발](../develop.md) — localhost 에서 클라우드 빌드 돌리기 (cloud-auth iterate).
- [../internals/23-cloud-ide.md](../../internals/23-cloud-ide.md) —
  Cloud IDE 내부 (orchestrator, EFS mount topology, lifecycle).
- [../internals/02-infrastructure.md](../../internals/02-infrastructure.md) —
  Redis key 레이아웃, queue, channel.
- [../observability/](../../observability/) — logging / metric 전략.
