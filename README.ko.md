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

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/hero-kanban.gif" width="880"
       alt="코드 잡을 태스크로 분해하고 병렬 실행한 뒤 최종 검증 태스크로 완료를 게이팅하는 Ant">
</p>
<p align="center"><sub><a href="">▶ 2분 워크스루 보기</a></sub></p>
-->

> ⚠️ **상태: pre-alpha, 1인 개발.** Ant는 한 사람이 만들었습니다. end-to-end로
> 동작하지만 첫 정식 릴리즈 전까지 공개 API와 파일 레이아웃은 변경될 수 있고,
> 이만큼의 범위를 혼자 만들었기에 표면마다 완성도 편차가 있습니다 — 기능별
> 솔직한 상태는 **[성숙도](#성숙도)** 를 보세요. 이슈와 PR을 진심으로
> 환영합니다. 어디에 도움이 가장 크게 닿는지는 **[기여하기](#기여하기)** 에
> 정리해 두었습니다.

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

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/spec-artifacts.png" width="880"
       alt="워크스페이스 아티팩트 트리와 아키텍처 다이어그램이 렌더된 시스템 설계 문서">
</p>
<p align="center"><sub>모든 단계가 읽고, diff 뜨고, 반박할 수 있는 문서를
남깁니다 — 커밋만이 아니라.</sub></p>
-->

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

고르기 전에 알아둘 두 가지: DeepSeek · GLM · Kimi는 1급 클라이언트가 아니라
OpenAI 호환 어댑터를 경유하므로 프로바이더 고유 기능이 늦게 반영될 수
있습니다. 그리고 **이미지 생성은 Google 전용**입니다 — `visual` 잡은 다른
곳에서 무엇을 쓰든 `GEMINI_API_KEY`가 필요합니다.

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

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/basis-moodboard.png" width="880"
       alt="각 스타일의 실제 팔레트로 그려진 20종 미니 앱 목업이 놓인 비주얼 티어 선택 화면">
</p>
<p align="center"><sub>그린필드로 시작하나요? 비주얼 방향만 고르면 Ant이
디자인 번들을 저작합니다.</sub></p>
-->

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
`resolve` → `triage` → 잡별 phase → `learn`. UI가 이 그래프를 실시간으로
그리므로 지금 어떤 노드가 실행 중이고 병렬 워커가 몇 개 떠 있는지 볼 수
있습니다.

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/agent-graph.gif" width="880"
       alt="실행 중인 노드가 강조되고 그 아래로 병렬 워커 칩이 펼쳐지는 라이브 에이전트 그래프">
</p>
-->


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
| **Game**                  | Experimental | Phaser/Web 게임 (sprite + HUD + audio)        |

여기서 "Experimental"이 구체적으로 무슨 뜻인지는 [성숙도](#성숙도)를 보세요.

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

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
|  |  |
|---|---|
| <img src="docs/assets/shell-3pane.png" alt="탐색기·태스크 보드·에이전트 채팅 3-pane 작업 화면"> | <img src="docs/assets/token-cost.png" alt="캐시 적중률을 포함한 모델별 토큰·비용 분해"> |
| 탐색기 · 태스크 보드 · 에이전트 채팅을 한 화면에 | 잡 단위 모델별 비용과 캐시 효율 |
| <img src="docs/assets/preview-console.png" alt="탐지된 서비스 연결과 빌드 로그가 흐르는 프리뷰 설정 화면"> | <img src="docs/assets/browser-ide.png" alt="피처 worktree 위에서 브라우저로 실행되는 VS Code"> |
| 서비스 연결과 실시간 빌드 콘솔 | 피처 worktree 위의 브라우저 VS Code |
-->

### 클라우드 전용 영역

리포지토리에는 매니지드 서비스용 seam(빌링/크레딧, 조직, 배포, 커스텀
도메인)이 함께 들어 있습니다. self-host 배포에서는 **전부 inert** 입니다 —
capability 게이트가 no-op 구현을 유지하며, 크레딧을 구매하는 대신 LLM
프로바이더에 직접 결제합니다. self-host 경로에서 외부로 신호를 보내는
코드는 없습니다. 이건 CI가 강제합니다 — 클라우드 전용 심볼이 오픈소스
번들에 새어 들어가면 빌드가 실패합니다.

---

## 성숙도

Ant은 1인 프로젝트치고 다루는 범위가 넓고, 그만큼 완성도가 고르지
않습니다. 아래가 솔직한 버전입니다. 체인지로그 각주에 숨겨둔 것은 없습니다.

| 표면 | 상태 | 실제로 무슨 뜻인가 |
|---|---|---|
| `code` / `design` / `plan` 잡 — service 도메인 | **Stable** | 지원되는 경로. 매일 쓰이는 부분입니다. |
| 라이브 프리뷰, 브라우저 IDE | **Stable** | 테스트 커버리지가 두껍고 상시 사용됩니다. |
| 서비스 연결 & 가상화 | **Beta** | 연결 설정 · 자동 탐지 · mock 어댑터 모두 출하돼 있고 테스트도 있습니다. 빠진 것은 **생성된 어댑터가 실제 서비스와 일치함을 증명하는 검증 게이트** 입니다 — 생성된 연동 코드는 실제 백엔드로 테스트한 뒤 신뢰하세요. |
| `creator` 에이전트 / `visual` 잡 | **Experimental** | **Google Gemini 전용** — 다른 곳에서 무엇을 쓰든 `GEMINI_API_KEY`가 필요합니다. 배경 제거는 선택 사이드카가 필요합니다. **그래프 중간 재개 불가**: 중단되면 잡이 처음부터 다시 시작됩니다. 그래프 노드에 실행 테스트가 없습니다. |
| Game 도메인 | **Experimental** | **그린필드 전용** — 기존 코드베이스에서는 game-art 티어가 억제됩니다. Phaser 전용(3D는 별도 엔진이 아니라 `enable3d` 확장). design 잡과 visual 잡 사이의 스프라이트 아틀라스 인계가 닫혀 있지 않아 프로덕션 아트는 직접 배치해야 합니다. |
| `learn` 잡 (벡터 인덱싱 / RAG) | **Incomplete** | 기본 비활성(`ANT_VECTOR_DB_ENABLED=false`), ChromaDB 사이드카 필요, **모든 UI 표면에서 숨겨져 있습니다** — 직접 API 호출로만 도달 가능. 검색은 git-changes + 키워드로 degrade 되며 그쪽이 정상 경로이고 충분히 동작합니다. |
| 팀 / 조직 워크스페이스 | **미출시** | 계정 전환은 동작합니다. 팀 생성과 초대는 동작하지 않습니다. |
| 매니지드 클라우드 (빌링, 크레딧, 배포 쿼터, 커스텀 도메인) | **미공개** | self-host 배포에서는 무력화된 no-op seam. |

Experimental 항목이 발목을 잡으면 이슈로 알려주세요 — 사람들이 실제로 어디에
부딪히는지 아는 게 로드맵 추측보다 훨씬 쓸모 있습니다.

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

## 스택

**백엔드** — Node.js 22+, TypeScript(strict), Express, LangGraph,
Anthropic / OpenAI / Google SDK, BullMQ, ioredis, Handlebars, Zod.

**프론트엔드** — React 18, Vite, Zustand, Tailwind CSS, Radix UI, ReactFlow.
마케팅 사이트(`ant-site`)는 정적 export 된 Next.js 앱입니다.

**인프라** — pnpm 워크스페이스, Redis, Docker, Kubernetes, 클라우드 모드의
공유 워크스페이스 볼륨용 EFS.

---

## 기여하기

**Ant은 1인 개발입니다.** 한 사람이 에이전트, 프롬프트, 프론트엔드, 문서를
전부 썼습니다. 그래서 리뷰는 당일이 아니라 best-effort 이고, 로드맵은
위원회 결정이 아니라 판단입니다. PR이나 이슈에 일주일째 답이 없으면 코멘트로
찔러 주세요 — 무례한 게 아니라 도움이 됩니다.

동시에 외부의 도움이 실제로 유용하다는 뜻이기도 합니다. 필요한 맥락이 가장
적으면서 기여가 가장 크게 닿는 지점들입니다:

| 영역 | 왜 좋은 진입점인가 |
|---|---|
| **문서 · 한↔영 미러** | [`docs/ko/`](docs/ko/)는 부분 번역이고 자체 README에 무엇이 빠졌는지 적혀 있습니다. 문서를 읽다가 헷갈린 부분을 고치는 게 가장 가치 있는 첫 PR입니다. |
| **LLM 프로바이더 어댑터** | 6개 중 3개가 OpenAI 호환 shim 경유입니다. 하나를 1급 클라이언트로 승격하는 작업은 범위가 명확하고 독립적입니다. |
| **`visual` 잡 테스트** | `creator` 에이전트 그래프에 실행 테스트가 없습니다. 여기 추가되는 건 전부 순증 커버리지입니다. |
| **프론트엔드 테스트** | `ant-ui`는 백엔드에 비해 커버리지가 얇습니다. |
| **재현 절차가 있는 버그 리포트** | 재현 절차는 패치보다 가치 있습니다. 버그를 재현하게 해주는 리포트는 이미 수정의 대부분입니다. |

에이전트 그래프를 깊이 건드리기 전에는 이슈부터 열어 주세요. LangGraph
코어에는 diff에 드러나지 않는 불변식이 있어서, 먼저 설계를 이야기하는 편이
나중의 재작업을 아낍니다.

셋업과 PR 워크플로는 [CONTRIBUTING.md](CONTRIBUTING.md), 구속력 있는 아키텍처
규칙은 [AGENTS.md](AGENTS.md)를 보세요. AGENTS.md는 보이는 것보다 중요합니다 —
대부분의 규칙에 회귀 가드 테스트가 붙어 있어, 위반하면 리뷰가 아니라 CI가
실패합니다.

---

## 라이선스

Apache-2.0 — [LICENSE](LICENSE) 참조. 서드파티 의존성 고지는
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.

기여는 동일 라이선스(Apache-2.0 §5)로 받습니다. 서명할 CLA도, DCO
sign-off도 필요 없습니다.
