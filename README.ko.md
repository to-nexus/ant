<p align="center">
  <img src="docs/assets/wordmark.ko.png" width="450"
       alt="ANT — 스펙 기반 AI 엔지니어링 플랫폼">
</p>

<p align="center">
  구축: <b>PRD → 시스템·UI 설계 → 코드</b> · 이터레이션: <b>스펙 → 코드</b> — 모든 코드 잡은 스스로 검증합니다. Self-host.<br>
  <sub>프론트엔드 · 백엔드 · 확장 가능한 언어/프레임워크 tier · 서비스 연결 & mock 가상화 · 피처별 dev server · 브라우저 IDE · 배포 (매니지드 클라우드)</sub>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/to-nexus/ant/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/to-nexus/ant/actions/workflows/ci.yml/badge.svg"></a>
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue"></a>
  <a href="docs/local-mode/install.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
</p>

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/code-job.gif" width="880"
       alt="코드 잡이 태스크로 분해되어 보드를 가로질러 이동하고, 에이전트 채팅에 작업 카드가 흐르는 화면">
</p>
<p align="center"><sub>디렉티브 하나 → 병렬 실행되는 분해된 태스크, 그리고 마지막에
큐된 verification 태스크. <a href="">▶ 2분 워크스루</a></sub></p>
-->

> ⚠️ **상태: pre-alpha, 1인 개발.** end-to-end로 동작하지만 첫 정식 릴리즈
> 전까지 공개 API와 파일 레이아웃은 변경될 수 있고, 이만큼의 범위를 혼자
> 만들었기에 표면마다 완성도 편차가 있습니다 — 기능별 솔직한 상태는
> **[성숙도](#성숙도)** 를 보세요. 이슈와 PR을 환영하며, 어디에 도움이 가장
> 크게 닿는지는 **[기여하기](#기여하기)** 에 정리해 두었습니다.

---

## Ant이 뭐가 다른가

대부분의 AI 코딩 도구는 "vibe coding" 위에서 동작합니다 — 모델한테
원하는 걸 말하고, 코드를 받고, 틀리면 다시 말하고, 반복. 이 루프는
데모와 토이 프로젝트까진 가지만, 진짜 엔지니어링은 못 버팁니다.

Ant은 정반대 입장입니다. 엔지니어링이 실제로 굴러가는 방식을 그대로
두 개의 루프로 만들었습니다.

**구축 루프** — greenfield, 프로젝트당 한 번:

1. **PRD**부터 적습니다. `planner` 에이전트가 명세를 다듬어 줍니다.
2. **시스템 설계** (아키텍처, API 컨트랙트, 시스템 문서)를 생성합니다.
3. **UI 디자인** (game 도메인이면 **game art**)을 만듭니다 — PRD에서
   생성하거나, 갖고 있는 Figma / Claude artifact를 그대로 떨어뜨립니다
   ([디자인을 그대로 가져오기](#디자인을-그대로-가져오기) 참고).
4. 그 설계들을 근거로 **코드**를 작성합니다.

**이터레이션 루프** — 그 이후의 모든 변경:

5. 다음 작업 단위의 **스펙**을 저작하고, 리뷰하고, 코드 잡이 정확히 그
   스펙 하나를 구현합니다 (`스펙 → 코드`). Claude Code의 plan 모드를
   써봤다면 같은 워크플로우입니다 — 단, plan이 diff 뜨고 리뷰하고 수정할
   수 있는 영속 문서로 남습니다
   (`gen-spec` → `gen-code-spec` → `rev-spec` → 반복).

검증은 일정에 넣는 단계가 아니라 **모든 코드 잡의 속성**입니다: 작업은
태스크로 분해되어 병렬 실행되고, 마지막 verification 태스크가 완료를
게이팅합니다. 게이트가 실패하면 error 태스크가 생겨 고치고 재검증합니다.

각 단계는 별도의 잡이며, 각자의 프롬프트 표면, 도구, 영속 아티팩트를
갖습니다. 결과는 감사 가능한 시스템이지, 가끔 코드를 토해내는 블랙박스가
아닙니다.

<p align="center">
  <img src="docs/assets/build-loop.png" width="880"
       alt="두 개의 파이프라인. 구축 루프(greenfield 또는 대형 신규 피처)는 plan(plan/PRD.md) → 시스템 설계(architecture/system/) → UI·game art(visual/ui/) → code(codebase/) 순으로 흐르고, 그 이후 모든 변경을 담당하는 이터레이션 루프는 plan 과 시스템 설계를 건너뛰고 스펙(architecture/spec/) 에서 곧바로 code 로 가며 rev-spec 순환 화살표가 붙어 있는 다이어그램">
</p>

<!-- 파일을 docs/assets/ 에 넣고 주석을 해제하세요. docs/assets/README.md 참고.
<p align="center">
  <img src="docs/assets/design-job.gif" width="880"
       alt="design 잡이 시스템 설계 문서를 렌더된 마크다운으로 워크스페이스에 실시간 스트리밍하고, 아키텍처 다이어그램에서 끝나는 화면">
</p>
<p align="center"><sub>모든 단계가 실제 경로에 실제 문서를 씁니다 — 읽고, diff 뜨고,
반박할 수 있는. 커밋만이 아니라.</sub></p>
-->

---

## 빠른 시작

**필요한 것** Node.js >= 22.13 · pnpm 11.1.0 (`corepack enable && corepack prepare pnpm@11.1.0 --activate`) · Docker + Compose (Redis용) · [LLM 프로바이더 키](#프로바이더).

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

자세한 셋업: [docs/local-mode/install.md](docs/local-mode/install.md).
클라우드 (매니지드 또는 self-host)로 가시려면
[docs/cloud-mode/install.md](docs/cloud-mode/install.md).

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

Ant은 에이전트 런타임을 직접 구성했으므로 **중간에 라우터가 없습니다**.
세 어댑터 계열 — Anthropic, OpenAI 호환, Gemini — 이 각 벤더의 API에
여러분의 키로 직접 통신합니다. 프로바이더 정가 그대로입니다: 토큰당
마진도, 요청 미터링도 없고, 프롬프트가 여러분이 고르지 않은 제3자를
경유하지 않습니다.

고르기 전에 알아둘 두 가지: DeepSeek · GLM · Kimi는 1급 클라이언트가 아니라
OpenAI 호환 어댑터를 경유하므로 프로바이더 고유 기능이 늦게 반영될 수
있습니다. 그리고 **이미지 생성은 Google 전용**입니다 — `visual` 잡은 다른
곳에서 무엇을 쓰든 `GEMINI_API_KEY`가 필요합니다.

---

## 디자인을 그대로 가져오기

Ant은 **세 가지 디자인 입력**을 1급 시민으로 취급합니다. 도구를 고를
필요 없이, 가진 것을 그대로 떨어뜨리세요:

<p align="center">
  <img src="docs/assets/design-input.png" width="880"
       alt="세 가지 디자인 입력 — visual/ui/handoff/ 에서 observation-only로 읽는 Claude artifacts, MCP로 실시간 조회하는 Figma URL, 아무것도 없으면 design 잡이 번들을 저작 — 이 하나의 UI 디자인 컨트랙트로 합쳐져 code 잡이 그것을 기준으로 구현하는 다이어그램">
</p>

| 소스                  | 무엇을 떨어뜨리는가                          | 언제 쓰나                                                                  |
|-----------------------|----------------------------------------------|----------------------------------------------------------------------------|
| **Claude artifacts**  | HTML/CSS/Markdown/PNG → `visual/ui/handoff/` | Claude.ai에서 디자인을 굴리던 분에게 가장 적합. 라이선스/셋업/스키마 불필요. |
| **Figma**             | Figma URL → `visual/ui/figma/figma.json`     | 이미 Figma 프로젝트가 있는 팀. 프롬프트 시점에 MCP로 실시간 탐색.          |
| **아직 아무것도 없음** | PRD에 `design` 잡을 돌림                      | Greenfield. Ant이 handoff 번들을 대신 작성.                                |

세 소스는 워크스페이스 단위로 hard-exclusive이며 해석 컨트랙트가 다릅니다.
(Claude handoff은 observation-only / FPOP, Figma는 live-fetched, ant
native JSON은 schema-based.)

**`design` 잡의 산출물은 어느 소스에서 출발했는지에 따라 달라집니다.** PRD에서
출발하면 (`gen-ui-desc`) `visual/ui/handoff/` 에 `DESIGN.md`를 루트로 하는 번들
(`styles.css`, `tokens/`, `components/`, `screens/`, `assets/`) 을 쓰고,
`figma.json` 에서 출발하면 (`gen-ui-figma`) `visual/ui/ant/` 에 canonical 3종
`ui-tokens.json` + `ui-assets.json` + `ui-spec.json` 을 씁니다.

풀 가이드:
[docs/guides/design-input/claude-handoff.md](docs/guides/design-input/claude-handoff.md).

---

## 동작 방식

<p align="center">
  <img src="docs/assets/architecture.png" width="880"
       alt="Ant 런타임 토폴로지 — 브라우저의 ant-ui / ant-site 가 단일 HTTP + SSE 경계를 지나 ant-api · ant-realtime · ant-preview 로, 이들이 Pub/Sub · BullMQ · state 를 나르는 Redis 버스로만 통신하고, ant-job 이 잡마다 격리된 job-runner 자식 프로세스를 spawn 하며, ChromaDB / visual-processor 는 선택 사이드카인 다이어그램">
</p>

백엔드 4개 프로세스, 단일 코드베이스, 오직 Redis로만 통신. 로컬 모드와
클라우드(K8s) 모드는 같은 데이터 플레인을 공유합니다 — 로컬은 단지
"모든 프로세스가 한 머신에" 일 뿐입니다.

각 잡은 LangGraph 에이전트 상태 머신으로 실행됩니다:
`resolve` → `triage` → 잡별 phase → `learn`. UI가 이 그래프를 실시간으로
그리므로 지금 어떤 노드가 실행 중이고 병렬 워커가 몇 개 떠 있는지 볼 수
있습니다.

<p align="center">
  <img src="docs/assets/job-anatomy.png" width="880"
       alt="잡이 실행하는 그래프 — architect / planner / creator 에이전트와 담당 잡, resolve → triage → detect → decompose 를 거쳐 setup · feature · ui 태스크로 병렬 fan-out, 완료 전에 작업을 되돌릴 수 있는 Final Verification 으로 수렴한 뒤 learn 으로 끝나는 흐름">
</p>

| 에이전트    | 담당 잡                                        |
|-------------|-----------------------------------------------|
| `architect` | `code`, `design`, `learn`, `ask`, `inline-ask` |
| `planner`   | `plan`                                        |
| `creator`   | `visual`                                      |

`design` 잡 하나가 세 표면을 담당하며 인텐트가 하나를 고릅니다:
시스템 설계(`gen-sys-*`), UI · game-art 디자인(`gen-ui-*` /
`gen-game-art-*`), 스펙 저작(`gen-spec` / `rev-spec`).

자세히: [docs/concepts/architecture.md](docs/concepts/architecture.md).

---

## 워크스페이스 모델

한 **프로젝트**의 git 저장소는 하나뿐입니다 — 숨겨진 bare 앵커
`{project}/repo.git`. 모든 **피처**는 동등한 linked worktree
(`features/{feature}/codebase/`)이고, **브랜치 이름은 피처 이름과
정확히 같습니다** — prefix 도, sanitize 도 없습니다. 피처 이름에 `/`를
쓸 수 있어 `feature/base`, `release/1.0` 같은 이름이 그대로 동작합니다.

<p align="center">
  <img src="docs/assets/workspace.png" width="880"
       alt="프로젝트의 숨겨진 bare 앵커 repo.git 이 세 개의 대등한 피처 worktree 로 뻗고, 각 피처가 codebase/ 와 plan/ · architecture/ · visual/ · assets/ 를 갖고 있으며 브랜치 이름이 피처 이름과 정확히 일치하는 다이어그램">
</p>

피처가 없는 프로젝트는 코드베이스가 없습니다. 특권을 가진 "main"
worktree 는 존재하지 않고 모든 피처가 대등합니다.

`codebase/` 옆에는 에이전트 산출물이 함께 놓입니다: `plan/`(PRD),
`architecture/`(시스템 설계 + 스펙), `visual/`(UI · game-art 디자인),
`assets/`, 그리고 에이전트 내부용 `sessions/` · `meta/`.

피처가 대등한 worktree이기 때문에 여러 피처를 병렬로 진행할 수 있습니다 —
각자 자기 브랜치, 자기 체크아웃, 자기 프리뷰 서버, 자기 아티팩트 셋을
갖고, 여느 브랜치처럼 머지하면 됩니다.

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

- **스펙 단위 이터레이션.** 스펙을 저작하고, 리뷰하고, 코드 잡이 정확히
  그 스펙 하나를 구현합니다 — plan 모드와 같지만, plan이 diff 뜨고 수정할
  수 있는 영속 아티팩트입니다.
- **Claude 디자인 drop-in.** Claude.ai에서 만든 artifact (HTML/CSS/MD)을
  `visual/ui/handoff/`에 떨어뜨리면 Ant이 관찰 전용 디자인 소스로
  취급합니다. 변환도, 스키마도 불필요. 프롬프트 only 도구에서 갈아타는
  팀의 가장 큰 단일 이유입니다.
- **Figma MCP.** Figma MCP 서버를 통해 프롬프트 시점에 실시간 탐색 —
  디스크에 스냅샷을 남기지 않습니다. 디자인 토큰은 canonical
  `visual/ui/ant/` 3종으로 emit.
- **멀티 에이전트 파이프라인.** Planner가 PRD를 쓰고, architect가 시스템
  설계·UI 디자인·코드를 생성합니다. 모든 코드 잡은 완료를 게이팅하는
  verification 태스크로 끝납니다 — 실패하면 fix 태스크가 생겨 재검증합니다.
- **5 실행 tier.** 원샷 Q&A부터 refs-grounded 멀티태스크 프로젝트까지
  요청에 따라 자동 dispatch.
- **스택 불문.** 프론트엔드, 백엔드, 풀스택 — 대상 언어와 프레임워크는
  프롬프트에 하드코딩되지 않고 확장 가능한 tech tier로 기술됩니다.
- **서비스 연결 & 가상화.** 앱이 통신하는 외부 서비스를 선언하면 Ant이
  토글 가능한 mock 어댑터를 생성합니다 — 실제 백엔드가 생기기 전에 앱이
  돌고 데모가 됩니다.
- **병렬 피처 + 라이브 프리뷰.** 각 피처는 자기 브랜치와 핫 리로드 dev
  server를 가진 git worktree — 여러 피처를 동시에 진행하고 브랜치처럼
  머지합니다.
- **브라우저 IDE.** VSCode + 코드베이스를 한 클릭으로 — 로컬에서는 Docker
  컨테이너, `ANT_K8S_NAMESPACE`를 설정하면 Kubernetes Pod.
- **중단 & 재개.** 잡은 phase마다 체크포인트를 남깁니다 — 멈추든, 죽든,
  노트북을 덮든, 멈춘 지점에서 재개합니다.
- **프롬프트 커스터마이징.** 모든 에이전트 프롬프트는 디스크 위의
  Handlebars 템플릿이고 기동 시 자동 등록됩니다 — 여러분 코드베이스에
  맞게 에이전트를 튜닝하세요 ([가이드](docs/guides/custom-prompts.md)).
- **Self-host, 비용 투명성.** 6개 프로바이더 중 원하는 LLM 키를 직접
  관리합니다 — 런타임이 Anthropic, OpenAI 호환, Gemini를 네이티브로
  구사해 각 벤더 엔드포인트에 직접 통신, **라우터 마진 없음** — 그리고
  잡마다 모델별 토큰 / 비용 / 캐시 적중 분해를 확인합니다.

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
| Vector DB / RAG (`learn` 잡) | **Experimental** | end-to-end로 연결돼 있지만 **기본 비활성 — 그리고 끄는 것을 권장합니다** (`ANT_VECTOR_DB_ENABLED=false`; ChromaDB 사이드카 필요; UI 미노출). 청킹 / 인덱싱 전략이 아직 튜닝되지 않아 인덱싱의 실익이 없습니다 — 프레임워크는 향후 조직 공유 vector DB 수요를 내다보고 미리 갖춰둔 것입니다. 꺼도 저하되는 것은 없습니다: 조회는 3단 체인(vector → git-changes → 키워드)입니다. `learn` 노드 자체는 DB가 꺼져 있어도 몫을 합니다 — 모든 잡이 끝날 때의 LLM 잡 요약과 세션 증류를 이 노드가 씁니다. |
| 팀 / 조직 워크스페이스 | **미출시** | 계정 전환은 동작합니다. 팀 생성과 초대는 동작하지 않습니다. |
| 매니지드 클라우드 (빌링, 크레딧, 배포 쿼터, 커스텀 도메인) | **미공개** | self-host 배포에서는 무력화된 no-op seam. |

Experimental 항목이 발목을 잡으면 이슈로 알려주세요 — 사람들이 실제로 어디에
부딪히는지 아는 게 로드맵 추측보다 훨씬 쓸모 있습니다.

---

## 문서

- **[로컬 모드](docs/local-mode/)** — 자기 머신에서 설치 + 개발 (페르소나 A)
- **[클라우드 모드](docs/cloud-mode/)** — 매니지드 (페르소나 B) 또는 self-host (페르소나 C) 설치 + 개발
- **[개념](docs/concepts/)** — 아키텍처, 에이전트, 잡, 실행 tier, spec-driven 철학
- **[가이드](docs/guides/)** — 디자인 입력, 커스텀 프롬프트, 옵저버빌리티
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
| **문서** | 문서를 읽다가 헷갈린 부분을 고치는 게 가장 가치 있는 첫 PR입니다. 문서는 영어로만 유지합니다 — 한국어는 최상위 [README.ko.md](README.ko.md) 하나뿐입니다. |
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
