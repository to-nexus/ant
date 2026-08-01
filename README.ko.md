<h1 align="center">Ant</h1>

<p align="center"><b>스펙 기반 AI 엔지니어링 플랫폼.</b></p>

<p align="center">
  PRD → 시스템 설계 → 코드 → 검증, 한 시스템 안에서 self-host 합니다.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/to-nexus/ant/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/to-nexus/ant/actions/workflows/ci.yml/badge.svg"></a>
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue"></a>
  <a href="docs/ko/local-mode/install.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
</p>

> ⚠️ **상태: pre-alpha.** Ant는 end-to-end로 동작하지만, 첫 정식 릴리즈
> 전까지 공개 API와 파일 레이아웃은 변경될 수 있습니다.

---

## Ant이 뭐가 다른가

대부분의 AI 코딩 도구는 "vibe coding" 위에서 동작합니다 — 모델한테
원하는 걸 말하고, 코드를 받고, 틀리면 다시 말하고, 반복. 이 루프는
데모와 토이 프로젝트까진 가지만, 진짜 엔지니어링은 못 버팁니다.

Ant은 정반대 입장입니다. 엔지니어링이 실제로 굴러가는 방식을 그대로
파이프라인으로 만들었습니다:

1. **PRD**부터 적습니다. `planner` 에이전트가 명세를 다듬어 줍니다.
2. **시스템 설계** (아키텍처, 컨트랙트, 시스템 문서)를 생성합니다.
3. 시스템이 명세 대비 **검증할 수 있는 코드**를 작성합니다.
4. 변경할 때마다 **재검증**합니다.

각 단계는 별도의 에이전트, 별도의 프롬프트 표면, 별도의 검증 게이트를
갖습니다. 결과는 감사 가능한 시스템이지, 가끔 코드를 토해내는 블랙박스가
아닙니다.

---

## 요구 사항

- **Node.js** >= 22.13 · **pnpm** 11.1.0 (`corepack enable && corepack prepare pnpm@11.1.0 --activate`)
- **Docker** + Compose — Redis(필수) 및 선택 사이드카용
- **LLM 프로바이더 키** — [프로바이더](#프로바이더) 참고

## 빠른 시작

```bash
git clone https://github.com/to-nexus/ant && cd ant
pnpm install

cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# packages/ant-cli/.env 편집:
#   ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)

pnpm dev:infra:redis      # Redis — 유일한 필수 인프라
pnpm dev:all              # API + Realtime + Worker + Preview + UI + site
```

[http://localhost:4200](http://localhost:4200)을 열고 첫 디렉티브를
입력합니다 — 예: *"React + Tailwind로 TODO 앱 만들어줘"*.

`pnpm dev:infra`는 ChromaDB와 visual-processor까지 함께 띄웁니다. 둘 다
**선택**입니다 — 벡터 DB는 `ANT_VECTOR_DB_ENABLED=true`를 켜지 않는 한
꺼져 있고(RAG는 git-changes + 키워드 검색으로 degrade), visual-processor는
`visual` 잡에서만 씁니다.

자세한 셋업: [docs/ko/local-mode/install.md](docs/ko/local-mode/install.md).
클라우드 (매니지드 또는 self-host)로 가시려면
[docs/ko/cloud-mode/install.md](docs/ko/cloud-mode/install.md).

---

## 프로바이더

키는 직접 준비합니다. `packages/ant-cli/.env`에 하나 이상 설정하면 잡별 ·
노드별로 모델을 고를 수 있습니다.

| 프로바이더 | 환경 변수            | 비고                                  |
|------------|----------------------|---------------------------------------|
| Anthropic  | `ANTHROPIC_API_KEY`  | 1차 지원 모델                          |
| OpenAI     | `OPENAI_API_KEY`     |                                       |
| Google     | `GEMINI_API_KEY`     |                                       |
| DeepSeek   | `DEEPSEEK_API_KEY`   | third-party · 중국 호스팅 — 동의 게이트 |
| GLM        | `GLM_API_KEY`        | third-party · 중국 호스팅 — 동의 게이트 |
| Kimi       | `KIMI_API_KEY`       | third-party · 중국 호스팅 — 동의 게이트 |

동의 게이트가 걸린 프로바이더는 선택 전에 앱 내 데이터 처리 동의가
필요합니다 — 프롬프트(= 여러분의 소스 코드)가 제3국 사업자로 나가기
때문입니다.

---

## 디자인을 그대로 가져오기

Ant은 **세 가지 디자인 입력**을 1급 시민으로 취급합니다. 도구를 고를
필요 없이, 가진 것을 그대로 떨어뜨리세요:

| 소스                  | 무엇을 떨어뜨리는가                          | 언제 쓰나                                                                  |
|-----------------------|----------------------------------------------|----------------------------------------------------------------------------|
| **Claude artifacts**  | HTML/CSS/Markdown/PNG → `visual/ui/handoff/` | Claude.ai에서 디자인을 굴리던 분에게 가장 적합. 라이선스/셋업/스키마 불필요. |
| **Figma**             | Figma URL → `visual/ui/figma/figma.json`     | 이미 Figma 프로젝트가 있는 팀. 프롬프트 시점에 MCP로 실시간 탐색.          |
| **아직 아무것도 없음** | PRD에 `design` 잡을 돌림                      | Greenfield. Ant이 handoff 번들을 대신 작성.                                |

세 소스는 워크스페이스 단위로 hard-exclusive이며 해석 컨트랙트가 다릅니다.
(Claude handoff은 observation-only / FPOP, Figma는 live-fetched, ant
native JSON은 schema-based.)

**`design` 잡의 산출물은 어느 소스에서 출발했는지에 따라 달라집니다:**

| 인텐트          | 출발점                        | 산출물                                                                 |
|-----------------|-------------------------------|------------------------------------------------------------------------|
| `gen-ui-desc`   | PRD (greenfield)              | `visual/ui/handoff/` — `DESIGN.md`를 루트로 하는 번들 (`styles.css`, `tokens/`, `components/`, `screens/`, `assets/`) |
| `gen-ui-figma`  | `visual/ui/figma/figma.json`  | `visual/ui/ant/` — canonical 3종 `ui-tokens.json` + `ui-assets.json` + `ui-spec.json` |

풀 가이드:
[docs/ko/guides/design-input/claude-handoff.md](docs/ko/guides/design-input/claude-handoff.md).

---

## 동작 방식

```
    ant-ui  4200          ant-site  4300         ← 브라우저 대면
    React SPA (/app/*)    마케팅 (Next.js)
         │
─────────┼──────────────────────────────────────────────────────────
         │
┌────────┴─────────┐    ┌──────────────────┐    ┌──────────────────┐
│   ant-api  4100  │    │  ant-realtime    │    │  ant-preview     │
│  REST + IDE      │    │   4101 SSE       │    │   4102 dev srv   │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └─────────── Redis (Pub/Sub + BullMQ) ──────────┘
                              │
                     ┌────────┴─────────┐
                     │   ant-job        │
                     │   요청마다       │
                     │   job-runner     │
                     │   spawn          │
                     └──────────────────┘

  선택 사이드카:  ChromaDB (vector RAG)   visual-processor 4103
```

백엔드 4개 프로세스, 단일 코드베이스, 오직 Redis로만 통신. 로컬 모드와
클라우드(K8s) 모드는 같은 데이터 플레인을 공유합니다 — 로컬은 단지
"모든 프로세스가 한 머신에" 일 뿐입니다.

각 잡은 LangGraph 에이전트 상태 머신으로 실행됩니다:
`resolve` → `triage` → 잡별 phase → `learn`.

| 에이전트    | 담당 잡                                        |
|-------------|-----------------------------------------------|
| `architect` | `code`, `design`, `learn`, `ask`, `inline-ask` |
| `planner`   | `plan`                                        |
| `creator`   | `visual`                                      |

자세히: [docs/ko/concepts/architecture.md](docs/ko/concepts/architecture.md).

---

## 워크스페이스 모델

한 **프로젝트**의 git 저장소는 하나뿐입니다 — 숨겨진 bare 앵커
`{project}/repo.git`. 모든 **피처**는 동등한 linked worktree
(`features/{feature}/codebase/`)이고, **브랜치 이름은 피처 이름과
정확히 같습니다** — prefix 도, sanitize 도 없습니다. 피처 이름에 `/`를
쓸 수 있어 `feature/base`, `release/1.0` 같은 이름이 그대로 동작합니다.

피처가 없는 프로젝트는 코드베이스가 없습니다. 특권을 가진 "main"
worktree 는 존재하지 않고 모든 피처가 대등합니다.

`codebase/` 옆에는 에이전트 산출물이 함께 놓입니다: `plan/`(PRD),
`architecture/`(시스템 설계 + 스펙), `visual/`(UI · game-art 디자인),
`assets/`, 그리고 에이전트 내부용 `sessions/` · `meta/`.

---

## 무엇을 만들 수 있나

| 도메인                    | 상태       | 예시                                            |
|---------------------------|------------|-------------------------------------------------|
| **Service** (웹/백엔드)   | Stable     | 풀스택 SaaS, 대시보드, REST API                |
| **Game**                  | 개발 중     | Phaser/Web 게임 (sprite + HUD + audio)          |

> **게임 vertical** 은 모드 골격이 준비되어 있습니다 — 도메인 레지스트리,
> `gameArtTier` visual surface, `design-game-art` intent set 이 모두
> 와이어링되어 있습니다 — 그러나
> **아직 프로덕션 준비 상태가 아닙니다**. Stable 표시될 때까지 거친
> 부분과 breaking change 가 있을 수 있습니다. 현재 지원되는 경로는
> service 도메인 워크플로입니다.

두 도메인은 같은 에이전트를 공유하지만 다른 프롬프트 오버레이, 다른
디자인 템플릿, 다른 visual-tier 카탈로그를 갖습니다. 새 도메인 추가는
도메인 레지스트리 변경 한 곳 — fork 불필요.

---

## 주요 기능

- **Claude 디자인 drop-in.** Claude.ai에서 만든 artifact (HTML/CSS/MD)을
  `visual/ui/handoff/`에 떨어뜨리면 Ant이 관찰 전용 디자인 소스로
  취급합니다. 변환도, 스키마도 불필요. 프롬프트 only 도구에서 갈아타는
  팀의 가장 큰 단일 이유입니다.
- **Figma MCP.** Figma MCP 서버를 통해 프롬프트 시점에 실시간 탐색 —
  디스크에 스냅샷을 남기지 않습니다. 디자인 토큰은 canonical
  `visual/ui/ant/` 3종으로 emit.
- **멀티 에이전트 파이프라인.** Planner가 PRD를 쓰고, architect가 시스템
  설계와 코드를 생성하며, 전용 verification 태스크가 동작을 입증해야
  잡이 끝납니다.
- **5 실행 tier.** 원샷 Q&A부터 refs-grounded 멀티태스크 프로젝트까지
  요청에 따라 자동 dispatch.
- **라이브 프리뷰.** feature별 dev server, 핫 리로드, 격리된 워크스페이스.
- **브라우저 IDE.** VSCode + 코드베이스를 한 클릭으로 — 로컬에서는 Docker
  컨테이너, `ANT_K8S_NAMESPACE`를 설정하면 Kubernetes Pod.
- **Self-host.** 6개 프로바이더 중 원하는 LLM 키를 직접 관리, 직접
  인프라에서.

### 클라우드 전용 영역

리포지토리에는 매니지드 서비스용 seam(빌링/크레딧, 조직, 배포, 커스텀
도메인)이 함께 들어 있습니다. self-host 배포에서는 **전부 inert** 입니다 —
capability 게이트가 no-op 구현을 유지하며, 크레딧을 구매하는 대신 LLM
프로바이더에 직접 결제합니다. self-host 경로에서 외부로 신호를 보내는
코드는 없습니다.

---

## 문서

- **[로컬 모드](docs/ko/local-mode/)** — 자기 머신에서 설치 + 개발 (페르소나 A)
- **[클라우드 모드](docs/ko/cloud-mode/)** — 매니지드 (페르소나 B) 또는 self-host (페르소나 C) 설치 + 개발
- **[개념](docs/ko/concepts/)** — 아키텍처, 에이전트, 잡, 실행 tier, spec-driven 철학
- **[가이드](docs/ko/guides/)** — 디자인 입력, 커스텀 프롬프트, 옵저버빌리티
- **[English documentation](README.md)** — 영어 본문

기여자용 (영문):
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, 컨벤션, PR 워크플로
- **[AGENTS.md](AGENTS.md)** — 구속력 있는 아키텍처 규칙 (인간/AI 공통)
- **[docs/internals/](docs/internals/)** — 깊이 있는 SSOT 정책, debug logging

---

## 라이선스

Apache-2.0 — [LICENSE](LICENSE) 참조.
