<h1 align="center">Ant</h1>

<p align="center"><b>스펙 기반 AI 엔지니어링 플랫폼.</b></p>

<p align="center">
  PRD → 시스템 설계 → 코드 → 검증, 한 시스템 안에서 self-host 합니다.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue"></a>
  <a href="docs/ko/getting-started/quickstart.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
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

## 빠른 시작

```bash
git clone https://github.com/<org>/ant && cd ant
pnpm install
pnpm dev:infra            # Redis + ChromaDB (Docker)
pnpm dev:local:all        # API + Realtime + Worker + Preview + UI
```

[http://localhost:5173](http://localhost:5173)을 열고 첫 디렉티브를
입력합니다 — 예: *"Phaser로 Pong 게임 만들어줘"*.

LLM 프로바이더 키가 필요합니다. Anthropic Claude가 1차 지원 모델이고,
OpenAI도 대부분의 잡에서 동작합니다.

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# packages/ant-cli/.env 편집:
#   ANT_ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

자세한 셋업: [docs/ko/getting-started/quickstart.md](docs/ko/getting-started/quickstart.md).

---

## 디자인을 그대로 가져오기

Ant은 **세 가지 디자인 입력**을 1급 시민으로 취급합니다. 도구를 고를
필요 없이, 가진 것을 그대로 떨어뜨리세요:

| 소스                  | 무엇을 떨어뜨리는가                                 | 언제 쓰나                                                                  |
|-----------------------|-----------------------------------------------------|----------------------------------------------------------------------------|
| **Claude artifacts**  | HTML/CSS/Markdown/PNG → `visual/ui/handoff/`        | Claude.ai에서 디자인을 굴리던 분에게 가장 적합. 라이선스/셋업/스키마 불필요. |
| **Figma**             | Figma URL → `visual/ui/figma/figma.json`            | 이미 Figma 프로젝트가 있는 팀. 프롬프트 시점에 MCP로 실시간 탐색.          |
| **Native tokens**     | 디렉티브에 `design` 잡을 돌림                        | Greenfield. Ant이 `ui-tokens.json` + `ui-spec.json`을 직접 생성.           |

세 소스는 워크스페이스 단위로 hard-exclusive이며 해석 컨트랙트가 다릅니다.
(Claude handoff은 observation-only / FPOP, Figma는 live-fetched, ant
native는 schema-based.) 풀 가이드:
[docs/ko/guides/design-input/claude-handoff.md](docs/ko/guides/design-input/claude-handoff.md).

---

## 동작 방식

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
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
```

4개 프로세스, 단일 코드베이스, 오직 Redis로만 통신. 로컬 모드와
클라우드(K8s) 모드는 같은 데이터 플레인을 공유합니다 — 로컬은 단지
"모든 프로세스가 한 머신에" 일 뿐입니다.

각 잡은 LangGraph 에이전트 상태 머신으로 실행됩니다:
`resolve` → `triage` → 잡별 phase → `learn`.

자세히: [docs/ko/concepts/architecture.md](docs/ko/concepts/architecture.md).

---

## 무엇을 만들 수 있나

| 도메인                    | 예시                                            |
|---------------------------|-------------------------------------------------|
| **Service** (웹/백엔드)   | 풀스택 SaaS, 대시보드, REST API                |
| **Game**                  | Phaser/Web 게임 (sprite + HUD + audio)          |

두 도메인은 같은 에이전트를 공유하지만 다른 프롬프트 오버레이, 다른
디자인 템플릿, 다른 visual-tier 카탈로그를 갖습니다. 새 도메인 추가는
도메인 레지스트리 한 줄 — fork 불필요.

---

## 주요 기능

- **Claude 디자인 drop-in.** Claude.ai에서 만든 artifact (HTML/CSS/MD)을
  `visual/ui/handoff/`에 떨어뜨리면 Ant이 관찰 전용 디자인 소스로
  취급합니다. 변환도, 스키마도 불필요. 프롬프트 only 도구에서 갈아타는
  팀의 가장 큰 단일 이유입니다.
- **양방향 Figma MCP.** Figma MCP 서버를 통한 실시간 탐색. 디자인 토큰
  자동 emit, Code Connect 라운드트립.
- **멀티 에이전트 파이프라인.** Planner가 PRD를 쓰고, architect가 시스템
  설계와 코드를 생성하고, verifier가 동작을 입증합니다.
- **5 실행 tier.** 원샷 Q&A부터 refs-grounded 멀티태스크 프로젝트까지
  요청에 따라 자동 dispatch.
- **라이브 프리뷰.** feature별 dev server, 핫 리로드, 격리된 워크스페이스.
- **Cloud IDE.** Pod에 VSCode + 코드베이스를 한 클릭으로 (K8s 모드).
- **Self-host.** 직접 LLM 키 (Anthropic/OpenAI) 관리, 직접 인프라에서.

---

## 문서

- **[시작하기](docs/ko/getting-started/)** — 설치, 빠른 시작, 첫 feature, 트러블슈팅
- **[개념](docs/ko/concepts/)** — 아키텍처, 에이전트, 잡, 실행 tier, spec-driven 철학
- **[가이드](docs/ko/guides/)** — self-host, 클라우드 배포, 디자인 입력, 커스텀 프롬프트
- **[English documentation](README.md)** — 영어 본문

기여자용 (영문):
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, 컨벤션, PR 워크플로
- **[AGENTS.md](AGENTS.md)** — 구속력 있는 아키텍처 규칙 (인간/AI 공통)
- **[docs/internals/](docs/internals/)** — 깊이 있는 SSOT 정책, debug logging

---

## 라이선스

Apache-2.0 — [LICENSE](LICENSE) 참조.
