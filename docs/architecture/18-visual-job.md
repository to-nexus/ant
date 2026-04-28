# Visual Job (Creator Agent)

## 개요

Visual Job은 Creator 에이전트의 첫 번째 job 타입으로, AI 이미지 생성 모델(Gemini Nano Banana)을 사용하여 프로젝트에 필요한 비주얼 에셋을 생성한다. Creator 에이전트는 에셋 생산 전반(visual, audible, animation 등)을 담당하며, visual job은 그중 이미지/SVG 영역을 다룬다. 대화형 워크플로우로 점진적 개선(Progressive Refinement)을 지원한다.

## 사용자가 할 수 있는 것

| 기능 | 설명 |
|------|------|
| 이미지 생성 | PNG, WebP, JPEG 형태의 이미지 에셋 생성 |
| SVG 코드 생성 | 단순 도형, 아이콘 등을 SVG 코드로 생성 |
| 시안 탐색 | 복수 후보를 생성하여 비교/선택 후 고품질 렌더링 |
| 직접 렌더링 | 명확한 요청은 시안 단계 없이 바로 최종 이미지 생성 |
| 대화형 반복 | 이전 결과를 기반으로 추가 수정/재생성 요청 |

## 워크플로우

```
__start__ → resolve → triage → classify → direct → (conditional)
                         │                   │
                         │     ┌─────────────┼─────────────┬──────────────┬──────────────┐
                         │     ▼             ▼             ▼              ▼              ▼
                         │   sketch        render        engrave       explain        __end__
                         │     │             │             │              │          (clarify/end)
                         │     ▼             ▼             ▼              ▼
                         │   deliver       deliver       deliver       __end__
                         │     │             │             │
                         │     ▼             ▼             ▼
                         │   __end__       __end__       __end__
                         │
                         └── explain (mode=explain, classify 분기) → __end__

Safety blocked (sketch/render) → direct로 루프백 (classify 재실행 불필요)
```

## 노드 역할

| 노드 | 모델 | 역할 |
|------|------|------|
| resolve | - | 세션 로드, conversation 복원 |
| triage | gemini-3-flash-preview | 의도 분류 (공통 노드) |
| classify | deps.llm (Flash) | 에셋 타입 분류 → VisualAssetType (logo/icon/hero/illustration/general), mode=explain 분기 |
| direct | deps.directLLM (Pro) | 아트 디렉션: assetType 기반 가이드 주입, 프롬프트 엔지니어링, 라우팅 결정 |
| sketch | gemini-3.1-flash-image-preview | 스케치 후보 이미지 생성 (빠르고 저비용) |
| render | gemini-3-pro-image-preview | 최종 고품질 이미지 렌더링 |
| engrave | gemini-3.1-pro-preview | SVG 코드 생성 (텍스트 모델) |
| explain | deps.explainLLM | 에셋 설명/분석 (이미지 생성 없이 대화 응답) |
| deliver | - | 파일 저장, 썸네일 생성, 채팅 알림, 상태 초기화 |

## Direct 노드 라우팅

Direct 노드(아트 디렉터)가 요청을 분석하여 다음 중 하나로 라우팅한다:

| Route | 조건 | 설명 |
|-------|------|------|
| `sketch` | 복잡/창의적 요청 | Flash 모델로 N개 후보 생성 |
| `render` | 명확한 요청 | Pro 모델로 바로 최종 이미지 생성 |
| `engrave` | 단순 도형/아이콘 SVG 요청 | 텍스트 모델로 SVG 코드 생성 |
| `clarify` | 주제가 불명확 | 질문 후 종료 (다음 턴에 재시작) |
| `end` | 비주얼 생성 아님 | 종료 |

> classify 노드에서 `mode=explain`이면 direct를 거치지 않고 explain 노드로 직행한다.

## LLM 모델 전략

| 역할 | 모델 | 용도 |
|------|------|------|
| Logic (Opus급) | gemini-3.1-pro-preview | 복잡한 추론, 프롬프트 엔지니어링 |
| Logic (Sonnet급) | gemini-3-flash-preview | 빠른 처리, triage 판단 |
| Visual (Pro급) | gemini-3-pro-image-preview | 최고 품질 이미지 렌더링 |
| Visual (Mainstream) | gemini-3.1-flash-image-preview | 고속 드래프트 생성 |

Visual job의 모든 노드는 Gemini 모델만 사용한다.

## 포맷 결정 매트릭스

| 용도 | 포맷 |
|------|------|
| 투명도 필요 (로고, 아이콘, UI 요소) | PNG |
| 히어로 이미지, 배경 | WebP |
| 참조용, 드래프트 | JPEG |
| 단순 도형, 아이콘 | SVG |

사용자가 명시적으로 포맷을 지정하면 매트릭스를 무시한다.

## 에러 처리

| 에러 | 처리 |
|------|------|
| Safety Filter 차단 | `safetyBlocked=true` → direct로 루프백, 프롬프트 수정 유도 |
| 이미지 생성 실패 | `visualError` 기록 → direct에서 사용자에게 안내 |
| LLM JSON parse 실패 | direct에서 clarify 경로로 복구 |
| 전체 그래프 실패 | throw → orchestrator에서 처리 |

## 출력

### 저장 위치

| 종류 | 경로 |
|------|------|
| 최종 이미지 | `{featurePath}/assets/gen/gen-{timestamp}.{ext}` |
| 썸네일 | `{featurePath}/assets/gen/gen-{timestamp}-thumb.jpeg` |
| 스케치 이미지 | `{featurePath}/assets/gen/sketches/sketch-{timestamp}-{index}.{ext}` |
| SVG | `{featurePath}/assets/gen/gen-{timestamp}.svg` |

### 채팅 알림

| 상황 | 방식 | UI 컴포넌트 |
|------|------|-------------|
| 최종 이미지/SVG 저장 | `showChatStatus('downloaded', ...)` | WorkingCard (이미지 프리뷰) |
| 스케치 후보 생성 | `sendClarifyCards([{options: ImageOption[], allowRegenerate}])` → `choice_card(clarifying)` | ChoiceCard > ClarifyingVariant |

#### 스케치 선택 UI

Sketch 노드가 복수의 스케치를 생성하면, Deliver 노드가 각 스케치의 썸네일을 생성하고 `choice_card(clarifying)` 상태를 전송한다. 스케치 선택은 Clarify 시스템의 이미지 옵션 확장으로 통합되어 있다.

```
deliver → sharp 썸네일 생성 → chatAPI.sendClarifyCards([{options: ImageOption[]}])
  → SSE → ChoiceCard(variant='clarifying')
    → SketchRow × N (세로 리스트, 각 행에 썸네일 + "Select" 버튼)
    → 썸네일 클릭 → DraftLightbox (좌우 화살표 네비게이션 + "Select Sketch N" 버튼)
    → 선택 시: runJob(directive="[SKETCH_FINALIZE:N]")
    → 자유 입력: runJob(directive="[SKETCH_FEEDBACK] 사용자 텍스트")
    → 재생성: runJob(directive="[SKETCH_REGENERATE]")
```

스케치 저장 경로:
- 원본: `sketches/sketch-{ts}-{index}.{ext}`
- 썸네일: `sketches/sketch-{ts}-{index}-thumb.jpeg`

Lightbox는 `BaseLightbox`를 공유 기반으로 하며, 기존 Figma 스크린샷용 `ImageLightbox`와 드래프트용 `DraftLightbox`로 분리된다.

## 컨텍스트 관리

| 영속 | 임시 (deliver 후 클리어) |
|------|------------------------|
| `conversation` (대화 이력) | `sketchImages` |
| `directive` | `svgSketches` |
| `tokenUsage` | `engineeredPrompt` |
| | `finalImage`, `selectedSketchIndex` |
| | `routeDecision`, `needsSketches`, `isSvgRequest` |

Deliver 노드 완료 시 임시 상태를 초기화하고, conversation에 `ConversationEntry`(role='system') chapter marker를 추가한다. `ConversationEntry`는 Plan과 동일한 통합 타입(`core/types/session.ts`)을 사용하며, `savedAsset`, `chapterSummary` metadata로 에셋 경로와 요약을 기록한다.

## 세션

`{featurePath}/sessions/creator/visual.json`에 저장. `conversation` 배열이 핵심 상태이며, 중단/재개 시 대화 맥락이 복원된다. `compactJob` LLM 요약 결과는 `applyCompactionToConversation`을 통해 세션 저장 시 반영되어 conversation 무한 성장을 방지한다.

## 프롬프트 체계

Visual job은 PromptEngine 6-phase가 아닌 `promptPort.render()` 직접 호출 패턴을 사용한다. 모든 프롬프트는 Handlebars 템플릿으로 관리되며, TypeScript 소스코드에 프롬프트 문자열을 하드코딩하지 않는다.

### 템플릿 구조

```
core/prompt/templates/
├── agents/creator/
│   ├── base.md                        # 크리에이터 에이전트 공통 아이덴티티
│   └── rules.md                       # 크리에이터 에이전트 공통 규칙
└── visual/
    └── nodes/
        ├── direct/
        │   ├── base.md                # 시스템 프롬프트 (아트 디렉션, 2차 호출)
        │   ├── rules.md               # 라우팅/포맷/조건부 에셋가이드/응답 규칙
        │   ├── context.md             # 유저 프롬프트 (대화 이력, 현재 요청, 에러)
        │   └── classify.md            # 에셋 타입 분류 프롬프트 (1차 호출)
        └── engrave/
            ├── base.md                # 시스템 프롬프트 (SVG 생성)
            └── rules.md               # SVG 코드 규칙
```

### 프롬프트 조립 흐름

**Classify 노드** (별도 LangGraph 노드, deps.llm 사용):

```
classify.md → { conversationContext, currentDirective }
→ LLM 응답: <classify>{ "assetType": "logo", "reasoning": "..." }</classify>
→ classifyParser.ts → state.assetType (VisualAssetType)
```

- 코드 잡의 `detect` 노드와 동일한 정규화 응답 패턴
- 실패 시 `'general'`로 fallback

**Direct 노드** (별도 LangGraph 노드, deps.directLLM 사용):

```
base.md → { isLogo, isIcon, isHero, isIllustration } (state.assetType에서 파생)
  ├── agents/creator/base (파셜)
  ├── agents/creator/rules (파셜)
  └── visual/nodes/direct/rules (파셜, 조건부 에셋 가이드)
context.md → { conversationContext, currentDirective, safetyBlocked, ... }
```

- `state.assetType`을 읽어 해당 타입의 가이드만 Handlebars `{{#if}}` 블록으로 선택 주입
- `rules.md`에 로고/아이콘/히어로/일러스트레이션 가이드가 조건부로 내장, `general`이면 가이드 없이 4축 방법론만 동작

**Engrave 노드**:
- 시스템 프롬프트: `visual/nodes/engrave/base.md` → 내부에서 `visual/nodes/engrave/rules` 파셜 포함

## 파일 구조

```
packages/ant-cli/src/agents/creator/
├── index.ts                          # Creator 에이전트 진입점
└── graph/visual/
    ├── graph.ts                      # LangGraph 정의, runVisualGraph
    ├── types.ts                      # VisualGraphState, SketchImage, SvgSketch, VisualAssetType
    └── nodes/
        ├── resolve.ts                # 세션 로드, conversation 복원
        ├── classify.ts               # 에셋 타입 분류 노드 (deps.llm)
        ├── classifyParser.ts         # 에셋 타입 분류 응답 파서
        ├── direct.ts                 # 아트 디렉션 (deps.directLLM, state.assetType 참조)
        ├── sketch.ts                 # 드래프트 후보 생성 (Flash 모델)
        ├── render.ts                 # 최종 고품질 렌더링 (Pro 모델)
        ├── engrave.ts                # SVG 코드 생성 (promptPort.render 사용)
        ├── explain.ts                # 에셋 설명/분석 (텍스트만 응답)
        └── deliver.ts                # 파일 저장, 썸네일, 알림, 상태 초기화
```

## 경계

- Visual Processor (배경 제거 사이드카): [27-visual-processor.md](27-visual-processor.md)
- 에이전트 아키텍처: [11-agent-architecture.md](11-agent-architecture.md)
- Job 생명주기: [10-job-lifecycle.md](10-job-lifecycle.md)
- Triage 라우팅: [12-triage-routing.md](12-triage-routing.md)
- 프롬프트 시스템: [13-prompt-system.md](13-prompt-system.md)
- 채팅 시스템: [31-chat-system.md](31-chat-system.md)
