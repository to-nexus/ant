# 개발

**Ant 코어**를 로컬에서 개발하는 기여자용, 또는 private fork
유지보수자용. Ant 을 자기 코드베이스에 대해 그냥 돌리려는 분은
[local-mode/install.md](local-mode/install.md) 또는
[cloud-mode/install.md](cloud-mode/install.md) 를 보세요.

> **로컬과 클라우드는 doc 트랙 두 개가 아니라 env 플래그 한 개의
> 차이입니다.** Ant 은 항상 같은 4-프로세스 토폴로지를 Redis / BullMQ /
> Pub-Sub 위에서 돌립니다 — `.env` 의 `ANT_SERVER_MODE` 가 인증 테넌트와
> Figma MCP 트랜스포트 두 fork 만 결정합니다. `:cloud` 스크립트 이름은
> **토폴로지** (4-프로세스) 를 가리키지 배포 대상이 아닙니다.

## 모노레포 레이아웃

```
packages/
├── ant-cli/        Backend: API + Job worker + Realtime + Preview 엔트리포인트
├── ant-ui/         Frontend: React + Vite SPA
└── ant-shared/     Cross-package TypeScript 타입 (런타임 코드 없음)
```

`ant-shared` 는 빌드 스텝이 없습니다 — pnpm workspace 해소로 소스에서
직접 참조됩니다.

추가로:

```
packages/ant-site/   마케팅 사이트 (Next.js). 런타임의 일부 아님.
```

## 4-프로세스 아키텍처

`ant-cli` 는 단일 코드베이스로 4 별도 프로세스로 출하됩니다. 엔트리
포인트와 env 가 어느 것을 띄울지 결정:

| 프로세스 | 포트 | 엔트리 포인트 |
|---|---|---|
| `ant-api` | 4100 | `composition/server.ts` |
| `ant-realtime` | 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| `ant-job` | — | `infrastructure/worker/start-job-worker.ts` |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts` |

프로세스 간 통신은 오직 Redis (Pub/Sub, KV, BullMQ). **프로세스 간
직접 HTTP 없음.** 로컬과 클라우드는 동일 데이터 플레인을 공유 — 로컬은
단지 4 개를 한 머신에 띄울 뿐.

Redis key 레이아웃, queue, pub/sub 채널 SSOT:
[internals/02-infrastructure.md](../internals/02-infrastructure.md).

## 아키텍처 규칙

Ant 은 코어 컨트랙트를 보호하는 소수의 구속력 있는 규칙을 갖습니다.
SSOT 는 [AGENTS.md](../../AGENTS.md) — 아래는 포켓 버전:

- **Unified Distributed System Principle.** Redis / BullMQ 에 대한
  in-memory fallback 없음. Redis 없이 못 도는 기능이면 그게 고장 —
  Map 을 더하지 말고 고치세요.
- **Phase 노드는 task-type blind.** `nodes/`, `routers/`,
  `parallel/`, `common/tool/handlers/` 안에
  `if (task.type === 'verification')` 금지. Task-specific 로직은
  `tasks/{type}/hooks/`.
- **PromptBuilder 가 유일한 prompt 엔트리.** Handlebars 나 `render()`
  직접 호출 금지 — system / rules / base / domain / basis / node
  레이어링을 우회.
- **`state.artifacts` 는 RAC-bound.** `loadResolvedArtifacts` 와
  `appendOrUpdatePool` 만 풀에 씁니다. `resolve` 에서 wholesale 디스크
  scan 금지.
- **Tier-Verification matrix.** Tier 2 = 1 task with
  `selfVerifyOnDone: true`. Tier 3/4 = 2+ task + final verification.
- **`serverMode` SSOT.** BE `/system/config` 가 `authMode` 를 응답
  (`ANT_SERVER_MODE` 기반); FE 는 `state.serverMode:
  AsyncFields<'local'|'cloud'>` 로 저장하고 read-only 로 소비.
  FE 토글, localStorage 영속, origin-detection 없음. 모드는 BE 기동
  시점에 고정 — 바꾸려면 `.env` 교체 후 재기동.
- **Project Lifecycle SSOT.** `repoType` 기본값은 `'cloud'`;
  `serverMode` → `repoType` 자동 매핑 금지.

망설이면 [AGENTS.md](../../AGENTS.md) 읽으세요. 모든 규칙 옆에
regression-guard 테스트 이름이 적혀 있습니다.

## 일상 루프

```bash
pnpm dev:infra                # Redis + ChromaDB + visual-processor
pnpm dev:all            # 4-프로세스 백엔드 + UI + site, hot reload
pnpm test:cli                 # ant-cli vitest
pnpm typecheck                # 모든 패키지
pnpm build                    # 타입체크 + 테스트 + 빌드
```

`pnpm build` 는 전체 테스트 슈트를 prebuild gate 로 실행 — 실패 테스트는
빌드를 abort 합니다. 우회 금지 (`--no-verify`, `[skip ci]`).

단일 테스트 파일 실행:

```bash
cd packages/ant-cli
pnpm vitest run tests/<area>/<file>.test.ts
```

Frontend-only:

```bash
cd packages/ant-ui
pnpm test
pnpm dev                      # Vite dev 서버만
```

개별 백엔드 프로세스 (디버깅용):

```bash
pnpm dev:api-server           # 4100
pnpm dev:realtime-server      # 4101
pnpm dev:job-worker
pnpm dev:preview-server       # 4102
```

LLM mock 변종 (실제 Anthropic 호출 없음):

```bash
pnpm dev:mock:all
```

## 인증 모드 — `ANT_SERVER_MODE`

`packages/ant-cli/.env` 가 어떤 인증 경로를 도는지 결정. 양 모드 모두
같은 4-프로세스 토폴로지와 동일한 일상 루프 명령을 씁니다.

### 로컬 모드 (기본) — `ANT_SERVER_MODE=local`

테넌트는 `local:local` 로 하드코딩. JWT 쿠키 미발급, BE 가 sign-in 을
요구하지 않음. Figma 는 데스크탑 MCP 트랜스포트 직접 사용. 99% 의
기여자는 이 경로.

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=local
ANT_REDIS_URL=redis://localhost:16379
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=sk-ant-...
```

### 클라우드 모드 — `ANT_SERVER_MODE=cloud`

클라우드 프로덕션과 정확히 같은 코드 경로를 돕니다 — Google OAuth,
JWT 쿠키, organization 온보딩, Figma HTTP 브리지. 인증 / IDE
오케스트레이션 / 온보딩을 iterate 할 때 사용.

| 관심사 | 로컬 | 클라우드 |
|---|---|---|
| 인증 | `local:local` 테넌트, OAuth 없음 | Google OAuth + JWT 쿠키 |
| IDE 오케스트레이터 | Docker | Docker 또는 Kubernetes |
| Figma | 데스크탑 MCP | HTTP 브리지 |
| 쿠키 | JWT 쿠키 미발급 | 프로덕션 attribute 의 JWT 쿠키 |

필수 env 추가:

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=cloud
ANT_JWT_SECRET=$(openssl rand -base64 48)
ANT_API_URL=http://localhost:4100

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback

FRONTEND_URL=http://localhost:5173
ANT_CORS_ORIGINS=http://localhost:5173
```

```bash
# packages/ant-ui/.env.development (FE build-time)
VITE_CLOUD_BACKEND_BASE=http://localhost:4100
```

`VITE_CLOUD_BACKEND_BASE` 는 **FE 가 어느 BE origin 을 호출할지** 만
결정하는 단일 빌드타임 변수입니다. 설정되면 모든 API/Realtime 트래픽이
그 origin 으로, 미설정이면 상대경로 (dev 는 Vite 프록시, single-host
배포는 same-origin). BE 모드 자체는 결정하지 않으며 — 그건
`ANT_SERVER_MODE` (BE 측) 가 SSOT 이고 GNB 의 read-only 배지로
`GET /system/config` 를 통해 표시됩니다.

#### OAuth 클라이언트 셋업

[Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
에서 **OAuth 2.0 Client ID** 생성:

- **Authorized JavaScript origins**: `http://localhost:5173`,
  `http://localhost:4100`
- **Authorized redirect URIs**:
  `http://localhost:4100/api/auth/google/callback`

OAuth 시작은 FE (`:5173`), callback 은 BE (`:4100`) 로 복귀하기 때문에
두 포트 모두 필요.

#### 쿠키 정책

JWT 쿠키 attribute 는
[`JwtService.getCookieOptions`](../../packages/ant-cli/src/infrastructure/auth/JwtService.ts)
에서 설정:

| Attribute | 값 |
|---|---|
| `HttpOnly` | `true` (항상) |
| `Secure` | 프로덕션 `true`, dev `false` (`NODE_ENV` 기반) |
| `SameSite` | `lax` (하드코드) |
| `Domain` | `localhost` / IP / 비known host 에서 unset; `KNOWN_BASE_DOMAINS` 매칭 또는 `COOKIE_DOMAIN` env 설정 시 registrable 도메인 |
| `Path` | `/` |

`localhost` 에서 `Domain` 속성 **생략** → host-only 쿠키 (단일 origin
dev 에 맞음). dev 에서 `Secure=false` 라 쿠키가 plain HTTP 로 전송 —
**편의 위해 프로덕션에서 HTTPS-mode 를 끄지 말 것**. 매칭되는
`getClearCookieOptions` 가 동일한
`domain` / `path` / `sameSite` / `secure` 를 반환해야 — RFC 6265bis 요구.

⚠️ 쿠키 `SameSite=lax` + `Secure=true` 는 cross-site SSO 패턴
(`SameSite=None; Secure`) 과 **동일하지 않습니다**. 배포 모양이
cross-site 쿠키 전송을 필요로 하면 (FE 가 BE 와 다른 registrable
도메인의 CDN 에서 서빙) 코드 변경 필요 — 오늘 시점 env 스위치 없음.

#### End-to-end 스모크

위 클라우드 env 로 `pnpm dev:all` 후
[http://localhost:5173](http://localhost:5173) 방문:

1. **Fresh consumer email 로 가입** (Google 테스트 계정, 예:
   `you@gmail.com`).
2. **온보딩** 이 빈 input 과 함께. Skip → `personal-<userId>` 안착.
   BE 로그: `[Auth] resolveOrganizationId → personal-<id>`.
3. **Fresh business email 로 가입** (`you@acme.io`).
4. **온보딩** 이 `acme` prefill (`suggestedOrganizationName`).
   받아들이면 → `organizationId='acme'`.
5. **같은 도메인의 2번째 business email 로 sign in** — 온보딩이
   동일한 `acme` 를 받아 → 둘 다 같은 organization (handshake 모델).
6. **`_pending` JWT 로 protected route 호출** — `401
   ONBOARDING_REQUIRED` 기대.

#### Local FE → 원격 클라우드 BE (advanced)

로컬 FE 를 원격 클라우드 BE 에 가리키는 것도 가능 — 실제 백엔드로 FE
디버그용. [CORS 매트릭스](cloud-mode/install.md#cors-operating-matrix)
의 ⚠️ 행 참고. 이 shape 은 fragile (원격 도메인 쿠키를
`localhost:5173` 의 JS 가 못 읽음) 하므로 HTTP 요청 디버그 한정 사용;
실제 cloud-mode FE 작업은 단일 호스트 `pnpm dev:all` 권장.

## 코딩 컨벤션

### TypeScript

- Strict mode 켜져 있음. PR 에서 끄지 마세요.
- 모듈 경계 (export 함수, public class) 는 explicit 타입. 지역
  inference 는 OK.
- `any` 대신 `unknown`. `any` 가 필요하면 코멘트로 정당화.

### 주석

- 기본 lean. 코드를 한 줄씩 번역하지 말 것. 비명확한 불변식만 짧게.
- JSDoc 은 public API 와 `@deprecated` 마커에만.
- 근거 + 경계: [AGENTS.md § "Comments — lean by default"](../../AGENTS.md).

### 커밋 메시지

- **영어만**, 대화/주석 언어와 무관.
- **Conventional Commits**: `<type>(<scope>): <summary>`.
- 흔한 type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
  `perf`.

레포 실제 예:

```
feat(preview): Phase 1 service virtualization — ConnectionDetector + @connection grammar
fix(decompose): retry on JsonSyntaxViolation in LLM task JSON parse
refactor(preview): drop mock:* annotation tokens
```

### Prompt 템플릿

`packages/ant-cli/src/core/prompt/templates/` 아래 파일을 건드리면
[AGENTS.md § "Prompt Engineering"](../../AGENTS.md) 먼저 읽으세요.
프롬프트는 에이전트가 서는 공개 표면 — 작은 drift 가 디버그 어려운
회귀를 만듭니다.

세 정책: **FPOP** (Principles over Examples, What over How,
Observable over Assumed, Universal over Specific, Constraints over
Instructions, Reminders for Blind Spots), **SBS** (게이트된 템플릿은
게이트 축에서 구체적, always-on 은 universal 유지), **MECE**
(Service Virtualization SSOT 표가 worked example).

Prompt 파일은 **영어만**. 소스 코멘트는 한국어 OK 지만 `.md` 템플릿은
아닙니다.

## Pull request

체크리스트:

- [ ] `pnpm build` 로컬에서 성공 (테스트가 prebuild gate).
- [ ] `pnpm typecheck` clean.
- [ ] behavior 변경 시 테스트 추가/수정.
- [ ] 코드/문서에 incident 코드네임 / 내부 호스트네임 0.
- [ ] 프롬프트 변경 시 prompt-policy 테스트 실행
      ([AGENTS.md](../../AGENTS.md) "Enforcement" 블록).
- [ ] PR description 이 템플릿 (`.github/PULL_REQUEST_TEMPLATE.md`)
      을 따름.

### 사이즈

- 프로덕션 코드 **< 400 줄 변경**.
- PR 당 단일 관심사 (refactor + feature 분리).
- 테스트는 behavior 와 같은 PR 에.

큰 refactor 는 PR 스택으로 출하; 첫 PR body 에 스택 순서 명시.

### Phase-split 작업

다단계 plan (이 브랜치 `.claude/plans/`) 의 컨벤션:

- 1 phase = 1 PR.
- 각 phase 는 다음 phase 가 열리기 전에 머지.
- 크로스-phase 컨트랙트 (Phase 2 와 Phase 3 사이 `/auth/me` 의
  `needsOnboarding` 필드) 는 plan 에 명시 + 앞 phase 의 regression
  test 로 잠금.

이 시퀀싱이 각 PR 을 독립적으로 review/revert 가능하게 합니다.

## 다음

- [AGENTS.md](../../AGENTS.md) — 인간/AI 기여자 공통 SSOT.
- [internals/](../internals/) — deep dives (Redis key 레이아웃,
  prompt 시스템, node graph, debug logging).
- [internals/37-auth-unified-procedure.md](../internals/37-auth-unified-procedure.md)
  — 인증 flow 내부.
- [testing/](../testing/) — 테스트 전략 + runbook.
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — PR 워크플로
