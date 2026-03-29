# UI Design Pipeline

## 개요

UI Design 파이프라인은 design job의 `workType === 'ui-design'`일 때 실행되는 문서 생성 파이프라인이다. 두 가지 상호배타적 소스 모드(by-ref, by-figma)가 있으며, 동일한 출력(ui-tokens.json, ui-assets.json, ui-spec.json)을 생성한다.

## 소스 모드

### 모드 결정

`detectEnvironment` 노드에서 `state.uiDesignSource`를 결정한다.

```
isFigmaDataPopulated(state.figmaConfig) === true  →  'figma'
inputs/references/ 또는 inputs/assets/ 존재      →  'references'
둘 다 없음                                        →  'none' (ui-design 아님)
```

Figma 모드가 우선한다. figma.json이 populated이면 references/에 파일이 있어도 무시된다.

### 입출력 요약

| 항목 | by-ref | by-figma |
|------|--------|----------|
| 입력 소스 | `inputs/references/` 이미지 | `inputs/figma.json` 설정 |
| 보조 입력 | `inputs/assets/` (사용자 제공) | `inputs/assets/` (사용자 제공) |
| 출력 | `outputs/design/ui-tokens.json`, `ui-assets.json`, `ui-spec.json` | 동일 |
| 문서 의존 체인 | tokens → assets → spec | 동일 |

## 공통 구조

양쪽 모드가 공유하는 실행 구조:

### 그래프 흐름

```
detectEnvironment
  → [figma 모드] figmaExplore → decompose → plan → docGen ⇄ tool → checkTaskStatus → ...
  → [ref 모드]                   decompose → plan → docGen ⇄ tool → checkTaskStatus → ...
```

### 태스크 분해 (decompose)

decompose가 문서별 chaptering을 수행한다:

- ch1: ui-tokens (의존 없음)
- ch2: ui-assets (ui-tokens 참조)
- ch3~chN: ui-spec (ui-tokens + ui-assets 참조, 복잡도에 따라 다중 챕터)

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

## by-ref 파이프라인 (Reference/Screenshot 기반)

### 방법론

LLM이 멀티모달 입력으로 스크린샷 이미지를 직접 분석하여 디자인 토큰, 에셋 구조, UI 스펙을 추출한다.

### 데이터 플로우

```
inputs/references/ (이미지)
  → detectEnvironment: uiReferences = [파일 경로 목록]
  → decompose: referenceCount 기반 복잡도 평가 → taskQueue
  → docGen: buildResourcesSummary(uiReferences) → LLM 프롬프트 주입
  → LLM: read_reference_image 도구로 이미지 분석 → JSON 문서 생성
```

### 도구 세트 (TOOL_SETS.uiDesign)

| 도구 | 역할 |
|------|------|
| `read_reference_image` | 스크린샷 이미지를 멀티모달 입력으로 읽기 |
| `list_reference_images` | inputs/references/ 파일 목록 |
| `list_assets` | inputs/assets/ 파일 목록 |
| `read_file` | 기존 문서, PRD 읽기 |
| `edit_file` | 문서 수정 |
| `list_files`, `delete_file`, `mkdir` | 파일 조작 |

### 프롬프트 템플릿

```
templates/design/phases/execute/
  base-ui-design-by-ref.md           ← 최상위 템플릿 (WHAT)
  rules-ui-design-by-ref.md          ← 모드 규칙 (HOW)
  injections/
    ui-tokens-guide-by-ref.md        ← 토큰 추출 가이드
    ui-assets-guide-by-ref.md        ← 에셋 분류 가이드
    ui-spec-guide-by-ref.md          ← 스펙 작성 가이드
    ui-continuation.md               ← Turn 2+ 이어쓰기 안내

templates/design/phases/decompose/
  base-ui-design-by-ref.md           ← decompose 템플릿
  rules-ui-design-by-ref.md          ← decompose 규칙
```

## by-figma 파이프라인 (Figma MCP 기반)

### 방법론

Figma Desktop MCP 도구로 디자인 데이터를 구조적으로 추출한다. 스크린샷 시각 분석이 아닌 노드 트리, CSS 변수, 디자인 변수를 프로그래매틱하게 해석한다.

### 그래프 흐름 (figmaExplore 포함)

```
detectEnvironment (uiDesignSource = 'figma')
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
inputs/figma.json
  → resolve: state.figmaConfig 로드
  → detectEnvironment: uiDesignSource = 'figma', uiReferences = undefined
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

### 2계층 분리 (by-ref / by-figma)

by-ref과 by-figma가 각각 독립적인 규칙 세트를 가진다. 공통 규칙은 각 규칙 파일 내에서 중복 없이 관리한다.

### 코드 레이어 분기 (uiDesignPrompt.ts)

```
buildUiDesignSystemPrompt():
  uiDesignSource === 'figma'
    → 'design/phases/execute/base-ui-design-by-figma'
    → figmaExplorationResult 변수 주입
  uiDesignSource === 'references'
    → 'design/phases/execute/base-ui-design-by-ref'
    → uiReferences 변수 주입

buildResourcesSummary():
  figma 모드 → MCP 도구 안내 + 매트릭스 요약 + 에셋 카운트
  ref 모드   → Reference Images + Asset Files 목록
```

docGen/index.ts에서 도구 세트 선택:

```
uiDesignSource === 'figma' → TOOL_SETS.uiDesignFigma
otherwise                  → TOOL_SETS.uiDesign
```

### nodeSummary LLM 표시 (buildNodeSummaryDisplay)

docGen 프롬프트에 nodeSummary를 표시할 때, 토큰 크기에 따라 전략이 다르다:

- `NODESUMMARY_TOKEN_THRESHOLD = 2500` 이하: 전체 nodeSummary를 그대로 표시 (각 노드에 dimensions, isComponent 표시)
- 초과 시: 구조적 아웃라인으로 전환 — depth 0-1 노드 + COMPONENT_SET/SECTION 노드만 + 하위 노드 수 카운트

### nodeSummary 도구 결과 트렁케이션 (toolResultManager)

figma_get_metadata 등 도구 결과가 클 때, `buildFigmaChildOutline`이 자식 노드를 아웃라인으로 축약한다. 각 자식 노드에 dimensions 정보를 포함하여 레이아웃 판단을 지원한다.

## Figma 연동 인프라

→ 상세: [26-figma-integration-infra.md](26-figma-integration-infra.md) (감지·인증·연결 흐름, MCP 전송 경로, 프론트엔드 상태 판정)

### inputs/figma.json

Figma 연동의 유일한 정규 입력 파일. 피처 생성 시 빈 문서로 자동 생성된다.

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

Figma 모드는 Full MCP 접근이 필수다. `detectEnvironment`에서 MCP 가용성을 검증한다. MCP 불완전 시 `designError`로 잡을 차단하고 연동 완료를 안내한다. MCP 전송 경로(로컬/클라우드)는 [26-figma-integration-infra.md](26-figma-integration-infra.md) 참조.

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

## 경계

- Design Job 개요: [15-design-job.md](15-design-job.md)
- Figma 연동 인프라: [26-figma-integration-infra.md](26-figma-integration-infra.md)
- Code Job의 UI 문서 소비: [14-code-job.md](14-code-job.md)
- 프롬프트 시스템: [13-prompt-system.md](13-prompt-system.md)
- 공유 계약 타입: [01-shared-contracts.md](01-shared-contracts.md)
