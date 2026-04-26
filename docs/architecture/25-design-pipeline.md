# Design Pipeline

## 개요

Design Job 의 두 surface — **UI Design** (서비스 도메인 전용) 과 **Game-Art Design** (게임 도메인 전용) — 는 동일한 graph (`detect → decompose → docGen ⇄ tool`) 를 공유하지만 산출물·자산 풀·decision tag 가 다른 sibling 파이프라인이다. 두 surface 는 **수직 도메인 분리** (D28) — 한 워크스페이스에 한 surface 만 활성된다.

### Surface 분리 (D17 / D18 / D28)

- **UI Design** (`intentGroup === 'design-ui'`) — `outputs/design/ui/{ant,figma,handoff}/...` 산출 (3-source canonical). LLM 결정 태그 `<visualTier>`. basis tier `[visualTier, gameContentTier]`. **도메인=`service` 만 활성** (D28 — `TIER_DOMAIN_MATRIX.visualTier === ['service']`, ActionDefinition.domainGate=['service']). `gen-ui-figma` / `gen-ui-desc` / `rev-ui` / `explain-ui` intent.
- **Game-Art Design** (`intentGroup === 'design-game-art'`) — `outputs/design/game-art/ant/{game-art-tokens,game-art-assets,game-art-spec}.json` 산출 (D24-revised v8 — sub-sourced canonical, `outputs/design/ui/ant/` 와 동형. `figma/`/`handoff/` 는 Phase 5+ hook). LLM 결정 태그 `<gameArtTier>`. basis tier `[gameArtTier, gameContentTier]`. **도메인=`game` 만 활성** (D22/D28 — `TIER_DOMAIN_MATRIX.gameArtTier === ['game']`, ActionDefinition.domainGate=['game']). `gen-game-art-figma` / `gen-game-art-desc` / `rev-game-art` / `explain-game-art` intent.

두 surface 는 **수직 도메인 분리** (D28) — 게임 워크스페이스는 game-art surface 만 활성, 서비스 워크스페이스는 UI surface 만 활성. 게임의 HUD / 메뉴 / 컨트롤은 별도 산출물 (`outputs/design/ui/...`) 이 아니라 `game-art-tokens.json` 의 HUD CSS 토큰 + `game-art-spec.json` 의 `hud` / `menu` / `dialog` 카테고리 안에 통합 카탈로그화된다 (D25 의 dictionary 형식이 자연스럽게 흡수).

### Asset Surface Boundary (I6)

자산 풀은 도메인 1:1 분리:

- `inputs/assets/service/{icons,images,fonts,misc}` — `ui-assets.json` (도메인=service 전용)
- `inputs/assets/game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}` — `game-art-assets.json` (도메인=game 전용, HUD 자산 + 게임 자산 통합)

Cross-pollution 금지: `ui-assets.json` 의 src 가 `inputs/assets/game/...` 시작이거나, `game-art-assets.json` 의 `kind: 'external'` src 가 `inputs/assets/service/...` 시작이면 lint 실패. 회귀 가드 — `tests/asset-surface-boundary.test.ts` + production validator `infrastructure/workspace/gameArtAssetValidator.ts` (Phase 2).

### Domain-Surface Boundary (I7-revised — D28)

Game-Art design template 본문에 `visualLanguage` / `surfaceSystem` / `spatialSystem` 등 UI surface 어휘가 등장하면 lint 실패 (단, backtick 으로 감싼 명시적 boundary disclaimer 는 허용). 반대로 UI design template 에 `sprite tween` / `oscillator` / `particle system` 등 art 어휘가 등장해도 실패. 회귀 가드 — `tests/game-art-design-surface.test.ts` + `tests/domain-surface-boundary.test.ts` (18 케이스: 매트릭스 / 액션 카드 / 코드 인텐트 ref/ctx 라우팅 / service 도메인 영향 zero).

### 명명 일원화 (D28 — `art-*` → `game-art-*`)

산출물 디렉토리 / 파일 / canonical / ARTIFACT_PREFIX / tier 이름 (`gameArtTier`) 모두 `game-art-*` SSOT 인데 v7 이전엔 인텐트 / IntentGroup / prompt 디렉토리 / 인젝션 / 코드 파일이 `art-*` 잔재였다. D28 이 hard rename 으로 정합 — 자세한 매핑 표는 [domain-and-game-tier-system-handoff.md §2.4 D28](../tmp/domain-and-game-tier-system-handoff.md) 참조.

### 자산 풀 부팅 마이그레이션 (D19-revised + D22)

기존 `inputs/assets/{icons,images,misc}/` 자산은 워크스페이스 부팅 시 `migrateAssetsToDomain` 가 한 번 idempotent 실행되어 `inputs/assets/{service|game}/{icons,images,misc}/` 로 이동한다. `outputs/design/ui/ant/ui-assets.json` 의 `src` 도 함께 갱신된다. 두 호출 트리거 (Phase 2 — D22):

- **워크스페이스 부팅** — `ensureCanonicalStructure(featurePath)` 끝에서 `reconcileAssetsToDomain(featurePath)` 가 sibling `config.json` 의 `domain` 을 자동 발견해 호출 (canonical 구조 invariant 와 동일한 entry point).
- **도메인 토글** — `ProjectCrudService.updateProjectConfig` 가 이전/새 `domain` 을 비교, 변경 시 `reconcileProjectAssetsToDomain({ projectPathAbs, domain })` 로 모든 feature 일괄 마이그레이션.

회귀 가드 — `tests/reconcile-assets-to-domain.test.ts` (9 케이스).

---

# UI Design Pipeline

UI Design 파이프라인은 design job의 `intentGroup === 'design-ui'`일 때 실행되는 문서 생성 파이프라인이다. 두 가지 상호배타적 소스 모드(by-desc, by-figma)가 있으며, 동일한 출력(ui-tokens.json, ui-assets.json, ui-spec.json)을 생성한다.

## 소스 모드

### 모드 결정

`detect` 노드에서 `resolvedAction.intent`와 `isFigmaPipeline()` 헬퍼로 파이프라인을 결정한다.

```
isFigmaPipeline(resolvedAction.intent, isFigmaDataPopulated(figmaConfig))
  intent === 'gen-ui-figma'                       →  figma 파이프라인
  intent === 'rev-ui' && figmaConfig populated    →  figma 파이프라인
  그 외 (gen-ui-desc, rev-ui 등)                  →  description (by-desc) 파이프라인
```

Figma 파이프라인이 우선한다. `gen-ui-figma` intent이거나, `rev-ui`에서 figma.json이 populated이면 Figma 모드로 진입한다.

`outputs/design/ui/handoff/` (자유 형식 시각 자료) 는 design-job 디컴포즈 입력이 아니라 코드 잡 멀티모달 채널의 추가 컨텍스트로만 쓰인다. design-job 자체는 directive + PRD 만으로 by-desc 모드를 진행한다.

### 입출력 요약

| 항목 | by-desc | by-figma |
|------|---------|----------|
| 입력 소스 | 디렉티브 + PRD (`inputs/sources/`) | `outputs/design/ui/figma/figma.json` 설정 |
| 보조 입력 | `inputs/assets/` (사용자 제공) | `inputs/assets/` (사용자 제공) |
| 출력 | `outputs/design/ui/ant/{ui-tokens,ui-assets,ui-spec}.json` | 동일 |
| 문서 의존 체인 | tokens ∥ assets → spec | 동일 |

## 공통 구조

양쪽 모드가 공유하는 실행 구조:

### 그래프 흐름

```
detect
  → [figma 모드] figmaExplore → decompose → plan → docGen ⇄ tool → checkTaskStatus → ...
  → [ref 모드]                   decompose → plan → docGen ⇄ tool → checkTaskStatus → ...
```

### 태스크 분해 (decompose)

decompose가 문서별 chaptering을 수행한다:

- ch1~chN: ui-tokens (의존 없음, 챕터 간 병렬)
- ch1~chN: ui-assets (의존 없음, tokens와 병렬, 챕터 간 순차)
- ch1~chN: ui-spec (ui-tokens + ui-assets 참조, 복잡도에 따라 다중 챕터)

각 챕터가 하나의 DesignTask로 taskQueue에 들어가며, plan → docGen → tool 루프를 개별 실행한다.

### 문서 생성 (docGen)

XML 스트리밍 방식으로 JSON 문서를 생성한다. `<file>` 태그로 신규 파일, `<append>` 태그로 기존 파일 확장. `<done>true</done>` 시그널로 태스크 완료를 선언한다. conversationHistory 기반 멀티턴 대화로 tool calling을 포함한다.

JSON 파일의 `<append>` 처리는 `FileRenderer.handleDesignAppend`가 담당하며, 기존 JSON과 새 JSON을 `deepMerge`로 합친다 (객체는 재귀 병합, 배열은 연결, 원시값은 소스 우선).

### 대형 문서 처리 전략

챕터 이어쓰기 시 기존 문서의 전체 내용을 프롬프트에 주입하지 않는다. 대신:

- `previousChaptersSummary`: 기존 최상위 키/섹션 이름 목록만 주입 (중복 방지용)
- `lastSectionNumber`: 이전 마지막 섹션 번호 (연속 번호 보장)
- `sectionPattern`: 기존 문서의 구조 패턴 (`top-level` 또는 `nested`)
- LLM이 상세 확인이 필요하면 `read_file`로 특정 구간을 드릴링

Refactor 모드(기존 섹션 수정)에서도 전체 파일을 프롬프트에 넣지 않고, `read_file` + `edit_file`로 외과적 수정을 수행한다.

### Document Authority (Code Job 계약)

Design Job이 생성하는 문서의 Code Job에서의 권위 수준:

- **ui-tokens.json**: SSOT — 시각적 값의 유일한 원천. fallback 없음
- **ui-assets.json**: SSOT — 에셋 경로의 유일한 원천. fallback 없음
- **ui-spec.json**: Primary — 레이아웃의 1차 참조. spec이 침묵하는 세부사항은 프레임워크 best practices 적용

## by-desc 파이프라인 (Description / Directive 기반)

### 방법론

LLM이 디렉티브 + PRD / source documents 만으로 디자인 토큰, 에셋 구조, UI 스펙을 직접 작성한다. 멀티모달 시각 입력 없이 directive 의 explicit 요구와 PRD intent 가 설계 권위다.

### 데이터 플로우

```
inputs/sources/ + directive (+ visualTier)
  → detect: 디렉티브 + PRD / 자산 카운트만 워크스페이스 스캔
  → decompose: PRD 분량 + visualTier 기반 복잡도 평가 → taskQueue
  → docGen: buildResourcesSummary(directive/PRD/assets) → LLM 프롬프트 주입
  → LLM: 직접 JSON 문서 생성 (필요 시 list_assets / read_file 만 호출)
```

### 도구 세트 (TOOL_SETS.uiDesign)

| 도구 | 역할 |
|------|------|
| `list_assets` | inputs/assets/ 파일 목록 |
| `read_file` | 기존 문서, PRD 읽기 |
| `edit_file` | 문서 수정 |
| `list_files`, `delete_file`, `mkdir` | 파일 조작 |

### 프롬프트 템플릿

```
templates/jobs/design/nodes/execute/
  variants/ui-design-by-desc/{base,rules}.md
  injections/
    ui-tokens-guide-by-desc.md       ← 토큰 작성 가이드
    ui-assets-guide-by-desc.md       ← 에셋 분류 가이드
    ui-spec-guide-by-desc.md         ← 스펙 작성 가이드

templates/jobs/design/nodes/decompose/
  variants/ui-design-by-desc/{base,rules}.md
```

## by-figma 파이프라인 (Figma MCP 기반)

### 방법론

Figma Desktop MCP 도구로 디자인 데이터를 구조적으로 추출한다. 스크린샷 시각 분석이 아닌 노드 트리, CSS 변수, 디자인 변수를 프로그래매틱하게 해석한다.

### 그래프 흐름 (figmaExplore 포함)

```
detect (isFigmaPipeline → true)
  → figmaExplore (Phase 0: 프로그래밍적 구조 탐색 + 매트릭스 생성)
  → decompose (매트릭스 기반 태스크 분해)
  → plan → docGen ⇄ tool (Phase 1-3: 문서 생성)
```

### Phase 0: figmaExplore 노드

프로그래밍적으로 Figma MCP 어댑터를 직접 호출하는 노드. LLM 호출이나 프롬프트 템플릿 없이, 코드 로직으로 Figma 파일의 구조를 탐색하고 후속 문서 생성을 위한 매트릭스를 생성한다.

수행 작업:

- 페이지 목록 조회 (`figma.json`의 URL에서 추출한 fileKey + rootNodeId 기반)
- `get_metadata`로 노드 트리 탐색
- **Variation Matrix** 생성: 섹션별 페이지 프레임 + 테마 변형 (light/dark)
- **Annotation** 수집: 섹션 직속 text 노드 (디자이너 주석)
- **Component State Matrix** 생성: COMPONENT_SET 하위 변형 프레임 + variant 파싱
- **nodeSummary** 생성: 노드 트리를 컴팩트한 목록으로 변환 (LLM이 특정 nodeId로 조회할 수 있게 가이드)
- `get_variable_defs`로 디자인 변수 확인

출력: `state.figmaExplorationResult` + 사이드카 파일 `figma-exploration.json`, `figma-exploration-debug.json`

도구 세트: `TOOL_SETS.figmaExplore` (`read_file`, `edit_file`, `list_files`, `mkdir`, `figma_get_metadata`, `figma_get_design_context`, `figma_get_screenshot`, `figma_get_variable_defs`)

### figmaExplore 핵심 알고리즘

**nodeSummary 생성** (`scanAllNodes` + `buildNodeSummary`):

- `NODE_SUMMARY_MAX_ENTRIES = 300` — 엔트리 예산 기반 adaptive depth
- 깊이 0부터 시작하여 예산 내에서 최대 깊이까지 수집
- 수집 대상 노드 타입: `NODE_SUMMARY_TYPES` (FRAME, COMPONENT, COMPONENT_SET, INSTANCE, GROUP, SECTION, TEXT, VECTOR, BOOLEAN_OPERATION)
- 각 엔트리에 `dimensions` (width/height)과 `isComponent` 플래그 포함

**Component State Matrix** (`buildComponentStateMatrix`):

- COMPONENT_SET 노드의 children을 순회
- `parseVariantName(name)` 함수가 "Property1=Value1, Property2=Value2" 포맷을 파싱하여 `VariantProperty[]` 생성
- 결과: `ComponentStateEntry.variantAxes` (프로퍼티 이름 목록), `frames[].variantProperties` (프레임별 variant 값)

**Variable Definitions** (`extractVariableDefsSummary`):

- `get_variable_defs` 결과를 요약 (컬렉션별 변수 수)
- `modes` 또는 `valuesByMode` 키가 있으면 모드 목록도 보존
- 토큰 예산: `MAX_VARIABLE_DEFS_TOKENS = 8000` 초과 시 요약으로 전환

### Phase 1: ui-tokens.json 생성

- `get_design_context` 반환 코드에서 CSS variable 정의 추출
- Variation Matrix에서 light/dark 쌍 식별하여 양쪽 호출
- CSS 변수 fallback 값 비교로 dual-theme 토큰 도출
- `get_variable_defs` 데이터 활용 (spacing, sizing, color)
- Mode Support: Figma 변수에 modes/valuesByMode가 있으면 모드별 값 구조를 보존

### Phase 2: ui-assets.json 생성

- 사용자 제공 inputs/assets/ 기반 에셋 분류
- 에셋 분류: iconLibrary, icons, images, dynamicAssets
- figmaNodeId 필수 기록 (재 export 용)
- rendering 필드, SVG themeAdaptation 포함

### Phase 3: ui-spec.json 생성

- Variation Matrix 모든 프레임에 대해 `get_design_context` 개별 호출
- Component State Matrix 모든 프레임 개별 호출
- 공용 컴포넌트 추출 (2+ 페이지 반복 패턴)
- 컴포넌트 최소 깊이 검증

### 데이터 플로우

```
outputs/design/ui/figma/figma.json
  → resolve: state.figmaConfig 로드
  → detect: isFigmaPipeline(intent, figmaPopulated) → true
  → figmaExplore: MCP 어댑터 직접 호출 → state.figmaExplorationResult
  → decompose: 매트릭스 기반 복잡도 평가 → taskQueue
  → docGen: buildResourcesSummary(figmaExplorationResult) → LLM 프롬프트 주입
  → LLM: figma_get_design_context 등으로 상세 데이터 추출 → JSON 문서 생성
```

### 도구 세트 (TOOL_SETS.uiDesignFigma)

| 도구 | 역할 |
|------|------|
| `figma_get_metadata` | 노드 트리 구조 (XML) |
| `figma_get_design_context` | 상세 디자인 데이터 (코드 + 스크린샷 + 힌트) |
| `figma_get_screenshot` | 노드 스크린샷 |
| `figma_get_variable_defs` | Figma Variables 정의 |
| `list_assets` | inputs/assets/ 파일 목록 |
| `download_asset` | 에셋 다운로드 |
| `read_file` | 기존 문서, PRD 읽기 |
| `edit_file` | 문서 수정 |
| `list_files`, `delete_file`, `mkdir` | 파일 조작 |

### 프롬프트 템플릿

```
templates/design/phases/execute/
  base-ui-design-by-figma.md         ← 최상위 템플릿 (WHAT)
  rules-ui-design-by-figma.md        ← 모드 규칙 (HOW)
  injections/
    ui-tokens-guide-by-figma.md      ← MCP 기반 토큰 추출 가이드
    ui-assets-guide-by-figma.md      ← 에셋 매핑 가이드
    ui-spec-guide-by-figma.md        ← 매트릭스 기반 스펙 작성 가이드
    ui-continuation-by-figma.md      ← 이어쓰기 안내

templates/design/phases/decompose/
  base-ui-design-by-figma.md         ← decompose 템플릿
  rules-ui-design-by-figma.md        ← decompose 규칙
```

## 템플릿 구조

### 2계층 분리 (by-desc / by-figma)

by-desc과 by-figma가 각각 독립적인 규칙 세트를 가진다. 공통 규칙은 각 규칙 파일 내에서 중복 없이 관리한다.

### 코드 레이어 분기 (docGen/intent/ui.ts)

```
buildUiDesignSystemPrompt():
  isFigmaPipeline(resolvedAction.intent, figmaPopulated)
    → 'jobs/design/nodes/execute/variants/ui-design-by-figma/base'
    → figmaExplorationResult 변수 주입
  otherwise
    → 'jobs/design/nodes/execute/variants/ui-design-by-desc/base'

buildResourcesSummary():
  figma 파이프라인 → MCP 도구 안내 + 매트릭스 요약 + 에셋 카운트
  desc 파이프라인  → directive / PRD / asset 카운트 안내
```

docGen/index.ts에서 도구 세트 선택:

```
isFigmaPipeline(intent, figmaPopulated) → TOOL_SETS.uiDesignFigma
otherwise                               → TOOL_SETS.uiDesign
```

### nodeSummary LLM 표시 (buildNodeSummaryDisplay)

docGen 프롬프트에 nodeSummary를 표시할 때, 토큰 크기에 따라 전략이 다르다:

- `NODESUMMARY_TOKEN_THRESHOLD = 2500` 이하: 전체 nodeSummary를 그대로 표시 (각 노드에 dimensions, isComponent 표시)
- 초과 시: 구조적 아웃라인으로 전환 — depth 0-1 노드 + COMPONENT_SET/SECTION 노드만 + 하위 노드 수 카운트

### nodeSummary 도구 결과 트렁케이션 (toolResultManager)

figma_get_metadata 등 도구 결과가 클 때, `buildFigmaChildOutline`이 자식 노드를 아웃라인으로 축약한다. 각 자식 노드에 dimensions 정보를 포함하여 레이아웃 판단을 지원한다.

## Figma 연동 인프라

→ 상세: [26-figma-integration-infra.md](26-figma-integration-infra.md) (감지·인증·연결 흐름, MCP 전송 경로, 프론트엔드 상태 판정)

### outputs/design/ui/figma/figma.json (canonical)

Figma 연동의 유일한 정규 참조 파일 (`FIGMA_CONFIG_PATH`). 피처 생성 시 빈 문서로 자동 생성되며, URL/fileKey/nodeId 메타 외에 어떤 탐색 결과도 저장하지 않는다.

```json
{
  "files": [
    "https://www.figma.com/design/ABC/My-Design?node-id=0-1"
  ]
}
```

타입: `FigmaDataConfig` (`@ant/shared/figma.ts`). `files`는 Figma URL 문자열 배열이며, `parseFigmaUrl()`이 fileKey와 nodeId를 추출한다.

레거시 형식(객체 배열, config 포함)은 `migrateFigmaConfig()`으로 자동 변환된다.

### Figma 연동 조건 (All-or-Nothing)

Figma 모드는 Full MCP 접근이 필수다. `detect`에서 MCP 가용성을 검증한다. MCP 불완전 시 `designError`로 잡을 차단하고 연동 완료를 안내한다. MCP 전송 경로(로컬/클라우드)는 [26-figma-integration-infra.md](26-figma-integration-infra.md) 참조.

### FigmaExplorationResult

figmaExplore 노드의 출력 타입. `@ant/shared/figma.ts`에 정의되며 DesignGraphState에 저장된다.

```typescript
interface FigmaExplorationResult {
  variationMatrix: VariationMatrixEntry[];
  annotations: AnnotationEntry[];
  componentStateMatrix: ComponentStateEntry[];
  variableDefs?: unknown;
  totalFrameCount: number;
  downloadedAssets: string[];
  nodeSummary?: FigmaNodeSummary[];
}
```

`ComponentStateEntry`는 `variantAxes?: string[]`와 `frames[].variantProperties?: VariantProperty[]`를 포함하며, `parseVariantName()`이 variant 이름에서 구조적 데이터를 추출한다.

`FigmaNodeSummary`는 `dimensions?: { width: number; height: number }`와 `isComponent?: boolean` 필드를 포함한다.

### 알려진 제약

- `downloadedAssets`는 현재 항상 빈 배열. 에셋 자동 다운로드 기능은 미구현 상태이며, 사용자가 `inputs/assets/`에 수동 배치한다
- figmaExplore는 프롬프트 템플릿 없이 순수 코드 노드로 동작 (`templates/design/phases/explore/` 디렉터리 없음)

## Code Job에서의 소비

→ 상세: [14-code-job.md](14-code-job.md) "UI Design Document Consumption" 섹션

Design Job 산출물(ui-tokens.json, ui-assets.json, ui-spec.json)은 Code Job에서 `ArtifactService.loadParsedUiContext()`를 통해 로딩되며, `UiDocParser`가 ui-spec.json을 메모리상에서 논리적 섹션으로 분할하여 태스크별로 필요한 부분만 주입한다.

---

# Game-Art Design Pipeline

Game-Art Design 파이프라인은 design job 의 `intentGroup === 'design-game-art'` 일 때 실행되는 문서 생성 파이프라인이다. 워크스페이스 도메인이 `game` 일 때만 ActionsPanel 에 카드가 노출된다 (D22 매트릭스 게이트). 도메인이 `service` 면 이 섹션 전체가 비활성이다.

## 산출물 / 자산 풀

UI Design 과의 직접 비교:

| 항목 | UI Design | Game-Art Design |
|------|-----------|-----------------|
| intent | `gen-ui-figma` / `gen-ui-desc` / `rev-ui` / `explain-ui` | `gen-game-art-figma` / `gen-game-art-desc` / `rev-game-art` / `explain-game-art` |
| 활성 도메인 (D28) | service 만 | game 만 |
| 산출물 | `outputs/design/ui/{ant,figma,handoff}/...` (3-source canonical) | `outputs/design/game-art/ant/{game-art-tokens,game-art-assets,game-art-spec}.json` (D24-revised v8 — sub-sourced canonical, `figma/`/`handoff/` 는 Phase 5+ hook) |
| 활성 자산 풀 | `inputs/assets/service/{icons,images,fonts,misc}` | `inputs/assets/game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}` (HUD 자산 + 게임 자산 통합) |
| LLM 결정 태그 | `<visualTier>` | `<gameArtTier>` (visualTier 미발행, D18) |
| basis tier | `[visualTier, gameContentTier]` | `[gameArtTier, gameContentTier]` |

## 분해 (`decomposeGameArtDesign`)

`packages/ant-cli/src/agents/architect/graph/design/nodes/decompose/gameArtDesignDecompose.ts` 가 `intentGroup === 'design-game-art'` 일 때 진입. UI 분해와 다른 점:

- **카테고리 dictionary 분해 (D25)**: `game-art-spec.json` / `game-art-assets.json` 의 sub-section 이 chapter (페이지 영역) 가 아니라 카테고리 키 dictionary (`effects` / `characters` / `projectiles` / `npcs` / `objectives` / `hud` / `menu` / `dialog` 등 — D28 으로 HUD 영역도 동일 dictionary 안). 표준 카테고리 가이드는 prompt overlay 에서만 제공하고 schema 가 강제하지 않는다.
- **task 분해**: `game-art-tokens` 단일 task + `game-art-assets-{category}` parallel + `game-art-spec-{category}` parallel. 카테고리 종류는 LLM 이 게임 컨텍스트 (`gameContentTier.genre` + `gameArtTier.entityCatalog`) 에 따라 동적으로 결정한다.
- **RAC pool**: `inputs/sources/` + `outputs/design/game-art/ant/` (D28 — UI ant docs cross-surface context 폐기, game 도메인은 game-art 단일 surface).
- **decision tag**: 응답에서 `<gameArtTier>` 를 `parseDecisionTags` 로 흡수해 `state.resolvedAction.basis.gameArtTier` 에 적용 (explicit 선행, LLM 채움이 후행).

## 모드 (`game-art-design-by-desc` / `game-art-design-by-figma`)

UI Design 의 두 모드 (by-desc / by-figma) 와 1:1 대응. 모드 결정은 `intent` 매핑:

- `gen-game-art-desc` / `rev-game-art` (figma 미연결) → by-desc 모드
- `gen-game-art-figma` → by-figma 모드 (Figma MCP 통한 game-art 자산 / 컨셉 보드 탐색)

도구 세트는 `TOOL_SETS.gameArtDesign` (by-desc) 와 `TOOL_SETS.gameArtDesignFigma` (by-figma) — UI 측 도구 세트와 형태가 같지만 작성 대상이 `game-art-*.json` 으로 바뀐다.

## Asset entries — `kind: 'inline' | 'external'` (D20/D21)

`game-art-assets.json` 의 항목은 두 종류:

| `kind`     | 출처                                                   | Phase 3 css-only scope |
|------------|--------------------------------------------------------|------------------------|
| `inline`   | LLM 이 JSON 안에 직접 작성 (`css` / `svg` / `oscillator`) | ✅ 단순 도형 / 단순 사운드 한정 (D21) |
| `external` | 사용자가 `inputs/assets/game/{cat}/` 에 배치한 파일      | 모든 production 자산 (mp3 / png / 3D 모델 등) |

런타임 검증:

- `validateAssetReferences` 가 `kind: 'external'` src 경로만 디스크 검증, `kind: 'inline'` 은 skip (`design/graph.ts` 의 `extractGameArtExternalSrcs` 헬퍼).
- `infrastructure/workspace/gameArtAssetValidator.ts` 가 D20 + I6 invariant 를 programmatic backstop 으로 강제 — `kind: 'external'` 인데 src 가 service 풀로 시작하면 throw, 게임 풀 외부면 issue, 미존재면 issue. 회귀 가드 `tests/art-asset-validation.test.ts` (9 케이스).

## Phase scope (`_meta.phaseScope` — D21)

`game-art-assets.json` 은 `_meta.phaseScope` 마커를 carry 한다:

| `phaseScope` | Phase | 효과 |
|--------------|-------|------|
| `'p2-css-only'` | 3 default | inline + external 모두 readable. external audio (`sfx`/`bgm`) 는 코드-시점에 suppressed — procedural OscillatorNode 가 유일한 audio path. |
| `'p4-external-enabled'` | 4+ | external entry 전부 load. file-based audio 활성. |

코드 잡은 LLM-emit `audioProfile` 보다 `phaseScope` 마커를 우선한다 (Phase 3 boundary 보호). 자세한 contract 는 `templates/jobs/code/basis/gameArtTier/_preamble.md`.

## 도구 라우팅 (D22 — `pickAssetsRoot`)

`download_asset` / `list_assets` 두 도구는 도메인-keyed 풀로만 라우팅된다:

```
workspaceDomain  ?? racDomain
  ?? (intentGroup === 'design-game-art' ? 'game' : 'service')
  ?? 'service'
```

순수 helper `pickAssetsRoot` 는 `infrastructure/...handlers/assets.ts` 에 export — 회귀 가드 `tests/assets-handler-routing.test.ts` (12 케이스) 가 surface-isolation 보장 (service 워크스페이스가 game 풀로 절대 가지 않음).

## 경계

- Design Job 개요: [15-design-job.md](15-design-job.md)
- Figma 연동 인프라: [26-figma-integration-infra.md](26-figma-integration-infra.md)
- Code Job 의 UI/Game-Art 문서 소비: [14-code-job.md](14-code-job.md)
- 프롬프트 시스템: [13-prompt-system.md](13-prompt-system.md)
- 공유 계약 타입: [01-shared-contracts.md](01-shared-contracts.md)
