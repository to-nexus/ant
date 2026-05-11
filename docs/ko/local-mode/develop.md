# 로컬 모드 — 개발

**Ant 코어**를 로컬에서 개발하는 기여자용, 또는 private fork
유지보수자용. Ant을 자기 코드베이스에 대해 그냥 돌리려는 분은
[install.md](install.md)를 보세요.

## 모노레포 레이아웃

```
packages/
├── ant-cli/        Backend: API + Job worker + Realtime + Preview 엔트리포인트
├── ant-ui/         Frontend: React + Vite SPA
└── ant-shared/     Cross-package TypeScript 타입 (런타임 코드 없음)
```

`ant-shared`는 빌드 스텝이 없습니다 — pnpm workspace 해소로 소스에서
직접 참조됩니다.

추가로:

```
packages/ant-site/   마케팅 사이트 (Next.js). 런타임의 일부 아님.
```

## 4-프로세스 아키텍처

`ant-cli`는 단일 코드베이스로 4 별도 프로세스로 출하됩니다. 엔트리
포인트와 env가 어느 것을 띄울지 결정:

| 프로세스 | 포트 | 엔트리 포인트 |
|---|---|---|
| `ant-api` | 4100 | `composition/server.ts` |
| `ant-realtime` | 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| `ant-job` | — | `infrastructure/worker/start-job-worker.ts` |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts` |

프로세스 간 통신은 오직 Redis (Pub/Sub, KV, BullMQ). **프로세스 간
직접 HTTP 없음.** 로컬 모드와 클라우드 모드는 동일 데이터 플레인을
공유 — 로컬은 단지 4개를 한 머신에 띄울 뿐.

Redis key 레이아웃, queue, pub/sub 채널 SSOT:
[../internals/02-infrastructure.md](../../internals/02-infrastructure.md).

## 아키텍처 규칙

Ant은 코어 컨트랙트를 보호하는 소수의 구속력 있는 규칙을 갖습니다.
SSOT는 [AGENTS.md](../../../AGENTS.md) — 아래는 포켓 버전:

- **Unified Distributed System Principle.** Redis / BullMQ에 대한
  in-memory fallback 없음. Redis 없이 못 도는 기능이면 그게 고장 —
  Map을 더하지 말고 고치세요.
- **Phase 노드는 task-type blind.** `nodes/`, `routers/`, `parallel/`,
  `common/tool/handlers/` 안에 `if (task.type === 'verification')` 금지.
  Task-specific 로직은 `tasks/{type}/hooks/`.
- **PromptBuilder가 유일한 prompt 엔트리.** Handlebars나 `render()`
  직접 호출 금지 — system / rules / base / domain / basis / node
  레이어링을 우회.
- **`state.artifacts`는 RAC-bound.** `loadResolvedArtifacts`와
  `appendOrUpdatePool`만 풀에 씁니다. `resolve`에서 wholesale 디스크
  scan 금지.
- **Tier-Verification matrix.** Tier 2 = 1 task with
  `selfVerifyOnDone: true`. Tier 3/4 = 2+ task + final verification.
- **`launchMode` SSOT (Phase 1).** FE state 필드는 `launchMode` —
  `backendMode` 아님. localStorage key는 `ant-ui:launch-mode`.
  Origin-detection helper는 `domain/store/launchModeInit.ts`.
- **Project Lifecycle SSOT.** `repoType` 기본값은 `'cloud'`;
  `launchMode` → `repoType` 자동 매핑 금지.

망설이면 [AGENTS.md](../../../AGENTS.md) 읽으세요. 모든 규칙 옆에
regression-guard 테스트 이름이 적혀 있습니다.

## 일상 루프

```bash
pnpm dev:local:all            # hot reload로 전부 띄움
pnpm test:cli                 # ant-cli vitest
pnpm typecheck                # 모든 패키지
pnpm build                    # 타입체크 + 테스트 + 빌드
```

`pnpm build`는 전체 테스트 슈트를 prebuild gate로 실행 — 실패한 테스트는
빌드를 abort합니다. 우회 금지 (`--no-verify`, `[skip ci]`).

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

## 코딩 컨벤션

### TypeScript

- Strict mode 켜져 있음. PR에서 끄지 마세요.
- 모듈 경계 (export 함수, public class)는 explicit 타입. 지역 inference는 OK.
- `any` 대신 `unknown`. `any`가 필요하면 코멘트로 정당화.

### 주석

- 기본 lean. 코드를 한 줄씩 번역하지 말 것. 비명확한 불변식만 짧게.
- JSDoc은 public API와 `@deprecated` 마커에만.
- 근거 + 경계: [AGENTS.md § "Comments — lean by default"](../../../AGENTS.md).

### 커밋 메시지

- **영어만**, 대화/주석 언어와 무관.
- **Conventional Commits**: `<type>(<scope>): <summary>`.
- 흔한 type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

레포 실제 예:

```
feat(preview): Phase 1 service virtualization — ConnectionDetector + @connection grammar
fix(decompose): retry on JsonSyntaxViolation in LLM task JSON parse
refactor(preview): drop mock:* annotation tokens
```

### Prompt 템플릿

`packages/ant-cli/src/core/prompt/templates/` 아래 파일을 건드리면
[AGENTS.md § "Prompt Engineering"](../../../AGENTS.md) 먼저 읽으세요.
프롬프트는 에이전트가 서는 공개 표면 — 작은 drift가 디버그 어려운
회귀를 만듭니다.

세 정책: **FPOP** (Principles over Examples, What over How, Observable
over Assumed, Universal over Specific, Constraints over Instructions,
Reminders for Blind Spots), **SBS** (게이트된 템플릿은 게이트 축에서
구체적, always-on은 universal 유지), **MECE** (Service Virtualization
SSOT 표가 worked example).

Prompt 파일은 **영어만**. 소스 코멘트는 한국어 OK지만 `.md` 템플릿은
아닙니다.

## Pull request

체크리스트:

- [ ] `pnpm build` 로컬에서 성공 (테스트가 prebuild gate).
- [ ] `pnpm typecheck` clean.
- [ ] behavior 변경 시 테스트 추가/수정.
- [ ] 코드/문서에 incident 코드네임 / 내부 호스트네임 0.
- [ ] 프롬프트 변경 시 prompt-policy 테스트 실행
      ([AGENTS.md](../../../AGENTS.md) "Enforcement" 블록).
- [ ] PR description이 템플릿 (`.github/PULL_REQUEST_TEMPLATE.md`)을 따름.

### 사이즈

- 프로덕션 코드 **< 400 줄 변경**.
- PR 당 단일 관심사 (refactor + feature 분리).
- 테스트는 behavior와 같은 PR에.

큰 refactor는 PR 스택으로 출하; 첫 PR body에 스택 순서 명시.

### Phase-split 작업

다단계 plan (이 브랜치 `.claude/plans/`)의 컨벤션:

- 1 phase = 1 PR.
- 각 phase는 다음 phase가 열리기 전에 머지.
- 크로스-phase 컨트랙트 (Phase 2와 Phase 3 사이 `/auth/me`의
  `needsOnboarding` 필드)는 plan에 명시 + 앞 phase의 regression test로
  잠금.

이 시퀀싱이 각 PR을 독립적으로 review/revert 가능하게 합니다.

## 다음

- [AGENTS.md](../../../AGENTS.md) — 인간/AI 기여자 공통 SSOT.
- [../internals/](../../internals/) — deep dives (Redis key 레이아웃,
  prompt 시스템, node graph, debug logging).
- [../testing/](../../testing/) — 테스트 전략 + runbook.
- [../../CONTRIBUTING.md](../../../CONTRIBUTING.md) — PR 워크플로 + Code of Conduct.
