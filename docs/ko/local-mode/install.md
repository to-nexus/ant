# 로컬 모드 — 설치

자기 머신에서 Ant을 돌립니다. 로컬 모드는 기본값이자 권장 시작점입니다 —
OAuth 없음, Kubernetes 없음, 매니지드 계정 없음. Docker로 Redis 하나
띄우고 Ant 4-프로세스를 노트북에서 실행하면 끝입니다.

이 페이지는 **페르소나 A (OSS local-only)** — 매니지드 컨트롤 플레인
없이 개인용/팀용으로 Ant을 self-host하는 분 대상입니다. 로컬 FE를 원격
클라우드 BE에 붙이려면 [develop.md](../develop.md) 를 참고하세요.

## 사전 준비

| 요구사항 | 버전 | 메모 |
|---|---|---|
| Node.js | 18.17+ | LTS 권장; 20.x OK. |
| pnpm | 10+ | `corepack enable && corepack prepare pnpm@10 --activate` |
| Docker | 24+ | Redis 용. macOS/Windows는 Docker Desktop. |
| Git | 2.40+ | |
| LLM 키 | — | Anthropic Claude (1차) 또는 OpenAI / Gemini. |

확인:

```bash
node --version
pnpm --version
docker --version
git --version
```

## 클론 + 설치

```bash
git clone https://github.com/<org>/ant
cd ant
pnpm install
```

`pnpm install`은 워크스페이스 패키지 (`@ant/cli`, `@ant/ui`,
`@ant/shared`)를 해소하고 Ant이 allow-list한 네이티브 바이너리
(`@vscode/ripgrep` — 로컬 모드에서 중요한 유일한 항목)를 빌드합니다.
ripgrep이 `ENOENT`로 실패하면
[../../getting-started/troubleshooting.md#ripgrep-enoent](../../getting-started/troubleshooting.md#ripgrep-enoent)
참조.

## 필수 env

예제 파일 복사 후 필수 3개 값을 채웁니다:

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
```

최소 viable `.env`:

```
ANT_SERVER_MODE=local
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)   # 64자 hex
ANTHROPIC_API_KEY=sk-ant-...
ANT_WORKSPACE_BASE_PATH=~/ant-workspaces      # 기본값, 원하면 변경
```

로컬 모드가 필요로 하는 전부입니다. `ANT_JWT_SECRET`, `GOOGLE_CLIENT_*`,
`FRONTEND_URL`, `ANT_CORS_ORIGINS`, `GOOGLE_REDIRECT_URI` — 주석 처리된
채 두세요. 로컬 모드는 OAuth를 전부 skip하고 loopback origin을 자동
허용합니다. cloud-only 변수가 로컬 모드 env에 있어도 깨지지는 않지만
효과도 없습니다.

전체 env 레퍼런스: [../reference/env-vars.md](../../reference/env-vars.md).

## 권장 인프라

로컬 모드는 Redis만 필요합니다.

```bash
pnpm dev:infra:redis        # :16379로 redis 기동
```

Docker Compose 서비스입니다. 확인:

```bash
docker ps                    # ant-redis 컨테이너 표시
redis-cli -p 16379 ping      # PONG
```

내릴 때: `pnpm dev:infra:down`.

## 선택 인프라

### Vector DB (RAG)

`ANT_VECTOR_DB_ENABLED=true`로 ChromaDB 기반 코드베이스 인덱싱을
활성화. **기본 OFF — 기능은 와이어링되어 있지만 프로덕션 품질은 아직
아닙니다.** OFF 상태에서 RAG는 `git-changes → keyword` 체인으로
fallback하며, 대부분의 code-job 요구를 storage/embedding 비용 없이
커버합니다.

써보고 싶다면:

```bash
# .env:
ANT_VECTOR_DB_ENABLED=true
CHROMA_URL=http://localhost:8000
EMBEDDER_URL=http://localhost:8001

# 그 다음:
pnpm dev:infra:vector
```

### Visual processor (배경 제거)

이미지 후처리를 위해 creator agent가 사용. 이미지 생성 flow를 안 돌리면
불필요.

```bash
# .env:
ANT_VISUAL_PROCESSOR_URL=http://localhost:4103
```

## 실행

Ant 은 모든 모드에서 **4-프로세스 토폴로지** (API + Realtime + Job +
Preview) 로 돕니다 — 로컬과 클라우드가 동일 데이터 플레인을 공유합니다.
스크립트 이름의 `:cloud` 는 그 토폴로지를 가리키지 배포 대상이 아닙니다.
`.env` 의 `ANT_SERVER_MODE=local` 로 로컬 인증 우회 + Figma 데스크탑
MCP 가 활성화됩니다.

### 개발 (hot reload)

```bash
pnpm dev:all
```

`concurrently` 로 4 BE 프로세스 (`ant-api` :4100, `ant-realtime` :4101,
`ant-job` worker, `ant-preview` :4102) + UI dev 서버 (`ui` :5173) +
마케팅 사이트 (`site`) 를 한 터미널에 띄웁니다.

개별 백엔드 프로세스를 격리해서 띄우려면 (디버깅용):

```bash
pnpm dev:api-server         # API 만 (:4100)
pnpm dev:realtime-server    # Realtime SSE (:4101)
pnpm dev:preview-server     # Preview (:4102)
pnpm dev:job-worker         # BullMQ worker
```

실제 Anthropic 호출 없이 돌리려면 LLM mock 변종:

```bash
pnpm dev:mock:all
```

### Production-style (빌드된 산출물)

```bash
pnpm build               # 타입체크 + 테스트 + 빌드
pnpm start:all     # 4-프로세스 백엔드 + UI + site
```

`pm2` / `systemd` 뒤에선 per-process 스크립트 (`start:api-server`,
`start:realtime-server`, `start:job-worker`, `start:preview-server`)
별로 supervised slot.

## 헬스체크

```bash
curl -s http://localhost:4100/health  | jq .   # ant-api
curl -s http://localhost:4101/health  | jq .   # ant-realtime
curl -s http://localhost:4102/health  | jq .   # ant-preview
curl -s http://localhost:5173/        > /dev/null && echo ok
```

`ant-job`은 HTTP를 노출하지 않습니다 — `docker ps` 또는 BullMQ queue
depth로 확인.

## 로컬 모드 UI 모양

GNB에는 클라우드 모드에서 Sign In/Out이 있던 자리에 **Local Org /
Local User 배지**가 보입니다 (Account Configuration은 같은 dropdown
에서 접근). 이 배지 자체가 모드를 드러내는 신호 — 별도 mode 토글이나
라벨은 없으며, BE 의 `ANT_SERVER_MODE` 가 SSOT 이고 FE 는 그대로
미러링합니다.

로컬 모드는 signup/OAuth 화면이 없습니다 — 모든 것이 고정된
`local:local` 테넌트에 속합니다.

## 외부 워크스페이스 마운트

기본적으로 Ant은 feature 데이터를 `~/ant-workspaces`에 씁니다. 다른
볼륨 (네트워크 드라이브, 더 큰 SSD)에 두려면:

```bash
# .env:
ANT_WORKSPACE_BASE_PATH=/Volumes/work/ant-workspaces
```

경로가 존재하고 Ant 실행 유저가 r/w 가능해야 합니다. 디렉토리 레이아웃은
`~/<workspace-root>/<org>/<user>/<project>/<feature>/`입니다. 로컬
모드에서는 `<org>=local`, `<user>=local`.

## 트러블슈팅

- **포트 충돌 (4100 / 4101 / 4102 / 5173)** — 각 프로세스는 `PORT`
  env로 결정. npm 스크립트가 `PORT=4100`, `PORT=4101`, `PORT=4102`을
  하드코드 ([`packages/ant-cli/package.json`](../../../packages/ant-cli/package.json)).
  Override하려면 per-process 스크립트에 다른 `PORT` 부여:
  `PORT=4200 pnpm dev:api-server`.
- **Redis 미기동** — `dev:all` 전에 `pnpm dev:infra:redis`가
  떠 있어야 합니다. **in-memory fallback 없음** — silent in-process
  queue 대신 fail-fast.
- **클라우드 실험의 OAuth env 잔존** — 로컬 모드는 `FRONTEND_URL` /
  `GOOGLE_CLIENT_ID` / `ANT_JWT_SECRET`을 무시하지만 `[CORS]` 시작
  warn이 뜬다면 `ANT_SERVER_MODE=cloud`를 `FRONTEND_URL` 없이 설정한
  상태입니다. `ANT_SERVER_MODE=local`로.
- **ripgrep spawn `ENOENT`** —
  [../../getting-started/troubleshooting.md#ripgrep-enoent](../../getting-started/troubleshooting.md#ripgrep-enoent).
- **삭제 후 "Project already exists"** —
  [../../getting-started/troubleshooting.md](../../getting-started/troubleshooting.md#project-already-exists-on-createproject).

## 다음

- [개발](../develop.md) — Ant 코어 기여 또는 fork 개발.
- [first-feature.md](../../getting-started/first-feature.md) (EN) — PRD
  → Design → Code end-to-end.
- [Cloud 모드 — 설치](../cloud-mode/install.md) — 매니지드 (Persona B)
  또는 self-host 멀티테넌트 (Persona C).
