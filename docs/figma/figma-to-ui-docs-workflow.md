# Figma -> Ant UI Documents Workflow

Figma 디자인 파일에서 Ant의 3개 UI 문서(ui-tokens.json, ui-assets.json, ui-spec.json)와
실제 에셋 파일을 추출하는 반복 가능한 워크플로우.

## 파이프라인 전제

> **Code Job은 JSON 문서만 소비한다.**
> `inputs/references/` 스크린샷은 Code Job에 전달되지 않는다.
> 따라서 이 워크플로우의 모든 탐색과 관찰은
> **ui-spec.json에 정확하고 풍부한 정보가 기록되는 것**을 최종 목표로 한다.
> 스크린샷은 이 에이전트가 ui-spec을 작성할 때 참고하는 보조 수단일 뿐이다.

## 사전 조건

- Cursor IDE에서 **Figma MCP 서버** 연결/인증 완료
- **Figma Personal Access Token (PAT)** 확보 (에셋 다운로드용)
  - Figma > Settings > Personal Access Tokens > Generate new token
- Figma 디자인 URL 확보

## 도구 역할 분담

| 용도 | 도구 | 비고 |
|------|------|------|
| 디자인 구조 탐색, 토큰/스펙 추출 | **Figma MCP** | `get_metadata`, `get_design_context` |
| 에셋 파일 다운로드 (SVG/PNG) | **Figma REST API** | `GET /v1/images/:fileKey` + PAT |
| 페이지 스크린샷 다운로드 | **Figma REST API** | 동일 엔드포인트, format=png |

> **왜 REST API가 필요한가**: Figma MCP의 `get_screenshot`은 inline 이미지만 반환하고 파일로 저장할 수 없다.
> 에셋/스크린샷을 실제 파일로 다운로드하려면 Figma REST API의 Image Export 엔드포인트를 사용해야 한다.

## 출력 파일 의존성 체인

```
inputs/assets/       (0th - Figma에서 에셋 다운로드)
inputs/references/   (0th - Figma에서 스크린샷 다운로드)
      |
ui-tokens.json       (1st - 의존성 없음)
      |
ui-assets.json       (2nd - tokens 참조, assets 파일 매핑)
      |
ui-spec.json         (3rd - tokens + assets 참조)
```

---

## Phase 0: Figma 디자인 탐색 및 에셋 다운로드

### 0-1. URL 파싱

Figma URL에서 추출:

```
URL: https://figma.com/design/IroxZNpULlpgvizN95vkqF/Design?node-id=0-1
                                ^^^^^^^^^^^^^^^^^^^^^^        ^^^
                                fileKey                       nodeId (0-1 → 0:1)
```

- **fileKey**: `/design/` 뒤 세그먼트
- **nodeId**: `node-id` 파라미터 값 (URL의 `-`는 API에서 `:`로 변환)

### 0-2. PAT 유효성 확인 및 페이지 목록 조회

```bash
# PAT 테스트 + 페이지 목록 한 번에 확인
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=1"
```

응답에서 `document.children[]`의 각 페이지 `name`과 `id`를 기록한다.

### 0-3. 메타데이터로 노드 트리 파악

```
get_metadata(fileKey, nodeId="0:1")
```

전체 페이지의 프레임/섹션 목록과 child node ID를 확보한다.
주요 스크린(1440px width 프레임)을 식별하고 nodeId를 기록한다.

**주의 사항**:
- Header, Footer 등이 `INSTANCE` 타입이면 컴포넌트 원본을 따로 탐색해야 한다
- 컴포넌트 페이지(보통 별도 Figma 페이지)의 ID를 Phase 0-2에서 확인해둘 것

### 0-3a. Variation Matrix 작성

`get_metadata` 결과에서 **섹션 역할**을 하는 컨테이너와 그 아래 모든 `<frame>` 자식을 목록화한다.
각 프레임은 같은 페이지의 **상태 변형(state variation)**이다.
Annotation에서 "라이트모드"/"다크모드"가 식별되면 **테마 변형**으로 분류한다.

**구조 가정 완화**: `get_metadata` XML에 `<section>` 노드가 없을 수 있다. Figma 파일마다 PAGE > FRAME, PAGE > GROUP > FRAME 등 구조가 다르다. 이 경우 **페이지 직속의 named GROUP** 또는 **동일 부모 아래의 FRAME 묶음**을 섹션으로 간주하고 Variation Matrix를 작성한다. XML 요소명이 `section`이 아닐 수 있음(SECTION, FRAME, GROUP 등) — **이름·계층 구조**로 "여러 프레임을 묶는 컨테이너"를 식별하면 된다.

```
# get_metadata 결과에서 section 하위 frame을 추출
<section id="272:7347" name="events/detail">
  <frame id="272:8710" name="events/detail" ...>   ← 변형 1
  <frame id="292:8947" name="events/detail" ...>   ← 변형 2
  <frame id="321:4175" name="events/detail" ...>   ← 변형 3
  ...
```

**Variation Matrix 예시**:

```
Section: events
| nodeId     | 변형 설명           | 테마  | 비고                         |
|------------|-------------------|-------|------------------------------|
| 272:5257   | events (기본)      | light | 라이트모드                    |
| 292:8139   | events (기본)      | dark  | 다크모드                      |
| 272:6209   | events (필터 활성화) | light | 드롭다운 필터                  |
| 272:6519   | events (필터 메뉴)   | light | 필터 드롭다운 메뉴 오픈          |

Section: events/detail
| nodeId     | 변형 설명              | 테마  | 비고 (annotation에서 도출)     |
|------------|----------------------|-------|-------------------------------|
| 272:8710   | Multi Yes/No (기본)   | light | 모든 옵션 닫힘                 |
| 292:7834   | Multi Yes/No (기본)   | dark  | 다크모드                       |
| 292:8947   | Multi Yes/No (확장)   | light | 첫 번째 옵션 오더북 열림         |
| 292:9721   | Multi Yes/No (확장)   | dark  | 다크모드                       |
| 321:4175   | Single Yes/No        | light | 오더북 직접 노출, 기본 열림      |
| 329:3565   | Single Yes/No        | dark  | 다크모드                       |
| 279:9759   | Up/Down (진행중)       | light | 라운드 기반 마켓               |
| 292:13221  | 종료된 마켓 (Share 보유) | light | 결과 표시 + 클레임 버튼         |
| 312:3644   | 종료된 마켓 (Share 미보유)| light | 결과만 표시                    |
| 321:3387   | Merge/Split           | light | 사이드바 UI 변경               |
```

> **테마 변형 식별법**: Annotation에 "라이트모드"/"다크모드"가 명시되어 있거나,
> 같은 레이아웃의 프레임이 x좌표만 다르게 나란히 배치된 경우 (예: x=579 light, x=2260 dark)

이 매트릭스는 Phase 3에서 `get_design_context` 호출 대상 목록으로 직접 사용된다.
**모든 변형을 빠짐없이 식별하는 것이 ui-spec.json 품질의 핵심이다.**

> **왜 중요한가**: 한 페이지에 여러 변형이 있을 때 대표 프레임 하나만 분석하면,
> 변형 간 레이아웃 차이(예: 오더북 위치, 기본 상태, 컬러 분기)가 ui-spec.json에 누락된다.
> Code Job은 JSON만 읽으므로 누락된 정보는 구현에 반영되지 않는다.

### 0-3b. Annotation 수집

`get_metadata` 결과에서 **section 직속 `<text>` 노드** (프레임 내부가 아닌)를 추출한다.
이것들은 디자이너가 남긴 주석으로, 동작 사양(behavior spec)을 담고 있다.

```xml
<!-- section 직속 text = 디자이너 주석 -->
<section id="272:7347" name="events/detail">
  <frame ...>...</frame>
  <frame ...>...</frame>
  <text id="292:5612" name="Yes/No 복수형" />          ← 주석!
  <text id="292:5946" name="목록명 : 기본적으로 다 닫혀있음..." />  ← 주석!
  <text id="292:5614" name="목록명 대신 '오더북'으로 표기..." />   ← 주석!
```

**식별 기준**:
- section 또는 named-group 레벨의 `<text>` 노드 (frame 내부가 아님)
- 한국어 텍스트이거나, 설명적 문장 형태
- 프레임 외부 좌표에 위치 (프레임의 x/y 범위 밖)

**수집 결과 예시**:

```
Section: events/detail
- "Yes/No 복수형" → 해당 변형의 레이블
- "목록명 : 기본적으로 다 닫혀있음 가장 상단 목록 Yes 활성화 상태가 기본"
  → behavior: accordion defaultState = all-closed, first option Yes active
- "목록명 대신 '오더북'으로 표기 기본적으로 열려있음"
  → behavior: single-market orderbook defaultState = open, label = "Order Book"
- "복수형은 차트 컬러 아래와 같이 반영"
  → behavior: multi-market uses per-option chart colors
- "단수형은 차트 컬러 purple 반영"
  → behavior: single-market chart color = purple
```

이 주석들은 Phase 3에서 ui-spec.json의 `behavior` 필드로 직접 반영된다.

### 0-3c. Component State Matrix 작성

`get_metadata` 결과에서 section 외부 또는 별도 그룹에 있는 **개별 컴포넌트 변형**을 목록화한다.
Variation Matrix (0-3a)가 **페이지 레벨** 변형만 다루는 반면,
Component State Matrix는 **컴포넌트 레벨** 변형을 포착한다.

**식별 기준**:
- section 외부에 있는 프레임 중 컴포넌트 이름이 포함된 것 (예: `Card_xxx_Closed`, `Card_xxx_Upcoming`)
- named group으로 묶여 있는 프레임 세트 (예: `Group 10`, `Group 11`로 묶인 카드 변형)
- 같은 width/height를 공유하는 유사 프레임 클러스터

**Component State Matrix 예시**:

```
| 컴포넌트 | 상태 | nodeId | 비고 |
|---------|------|--------|------|
| Card_YesNo | Active | (in-page) | events 페이지 내 |
| Card_YesNo | Closed | 329:10078 | 결과 아이콘 표시 |
| Card_YesNo | Upcoming | 329:10129 | "-" 플레이스홀더 |
| Card_Multi | Active | (in-page) | events 페이지 내 |
| Card_Multi | Closed | 329:10098 | 옵션별 결과 아이콘 |
| Card_Multi | Upcoming | 329:10161 | "-" 플레이스홀더 |
```

이 매트릭스는 Phase 3에서 각 컴포넌트의 `states` 블록으로 반영된다.

> **왜 중요한가**: 카드, 버튼 등 재사용 컴포넌트는 Active/Closed/Upcoming 등 여러 상태를 가진다.
> 대표 상태(Active)만 분석하면 나머지 상태의 시각적 차이가 ui-spec.json에 누락되고,
> Code Job은 해당 상태를 구현하지 않는다.

### 0-3d. Interaction State 수집

`get_metadata`에서 **디자이너 어노테이션이 인터랙션 상태를 명시하는 프레임 그룹**을 식별한다.
이것은 hover/focus/error 등 사용자 인터랙션에 따른 시각적 변화를 담고 있다.

**식별 패턴**:
- 프레임 그룹 이름에 상태 키워드: "호버", "포커스", "에러", "열림", "닫힘"
- 같은 컴포넌트의 여러 상태가 나란히 배치된 프레임
- 어노테이션 텍스트에 "(기본)", "호버 시", "포커스 시", "에러 + 메시지" 등

**수집 결과 예시**:

```
Section: events/detail
- 어마운트 입력 (292:3212): default, hover, focus (stroke 1->1.5), error+message, preset-hover
- 어마운트 입력 (292:11217): hover, focus, error (Split/Merge용)
- 오더서머리 (292:3598): expanded ("오더 서머리 열림"), collapsed ("오더 서머리 닫힘 (기본)")
- 거래 방식 드랍다운 (292:2829): expanded dropdown menu
- 거래 버튼 (292:2825): Buy hover, Sell hover
```

이 정보는 Phase 3에서 각 요소의 `interactionStates` 블록으로 반영된다.

> **주의**: Variation Matrix는 section 내 **페이지 프레임**만 대상으로 한다.
> Section 외부 또는 별도 그룹의 **컴포넌트 변형**은 0-3c에서,
> **인터랙션 상태**는 0-3d에서 별도로 처리한다.
> 세 매트릭스를 합치면 피그마의 모든 프레임이 빠짐없이 커버된다.

### 0-3e. 메타데이터가 잘린 경우

`get_metadata` 응답이 잘려서 섹션·프레임 목록이 불완전할 때는 Figma REST API로 노드 트리를 보완한다.

```bash
# 동일 페이지(또는 루트)의 하위 트리를 JSON으로 조회
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=0:1&depth=4"
```

응답의 `nodes.<nodeId>.document` 하위에서 섹션·프레임·노드 ID 목록을 추출한다. 이 목록으로 Variation Matrix와 Component State Matrix를 채운 뒤, Phase 1~3은 동일하게 진행한다.

### 0-4. 컴포넌트 내부 에셋 노드 탐색

인스턴스 내부의 커스텀 아이콘/로고 등의 실제 nodeId를 찾는 과정:

```bash
# 1) 컴포넌트 페이지에서 Header/Footer 등의 컴포넌트 ID 확인
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$COMPONENT_PAGE_ID&depth=2"

# 2) 컴포넌트 내부 깊이 탐색으로 에셋 노드 특정
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$COMPONENT_ID&depth=5"
```

**함정 주의**:
- 인스턴스 내부 노드 ID (`I272:5258;224:726` 형태)는 export API에서 사용 불가
- 반드시 **컴포넌트 원본**의 nodeId를 사용해야 한다
- 프레임(Frame) vs 벡터(Vector) 선택: 아이콘은 **컨테이너 프레임**을 export해야 viewBox가 올바르게 설정된다
- 부모 프레임을 잘못 선택하면 주변 요소까지 포함되어 export된다 (파일 크기로 검증 가능)

### 0-5. Figma REST API로 에셋 다운로드

#### SVG 에셋 export

```bash
# 1) Export URL 획득
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_IDS&format=svg"

# 응답 형태:
# { "images": { "68:902": "https://figma-alpha-api.s3....", ... } }

# 2) 각 URL을 다운로드
curl -sL "$IMAGE_URL" -o "inputs/assets/icon-name.svg"
```

#### PNG 에셋 export

```bash
# scale=2 로 고해상도 export
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_IDS&format=png&scale=2"
```

#### 다운로드 후 검증

```bash
# 파일 크기 확인 (비정상적으로 크면 잘못된 nodeId)
ls -lh inputs/assets/

# SVG 파일 내용 확인 (viewBox 크기가 예상과 맞는지)
head -1 inputs/assets/*.svg

# PNG 파일 타입 확인
file inputs/assets/*.png
```

### 0-6. 페이지 스크린샷 다운로드

주요 페이지 프레임을 PNG로 export하여 `inputs/references/`에 저장:

```bash
curl -s -H "X-Figma-Token: $FIGMA_PAT" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$PAGE_NODE_IDS&format=png&scale=1"

# 각 URL 다운로드
curl -sL "$URL" -o "inputs/references/events.png"
curl -sL "$URL" -o "inputs/references/market-detail.png"
# ...
```

### 0-7. 디자인 변수 확인

```
get_variable_defs(fileKey, nodeId="<any-node-id>")
```

Figma에 정의된 디자인 변수(Variables)가 있으면 토큰 추출에 직접 활용한다.

> **주의**: `get_variable_defs`는 `nodeId`가 필수 파라미터다. fileKey만으로는 호출 불가.

---

## Phase 1: ui-tokens.json 생성

### 입력 소스
- `get_design_context` 반환 데이터의 CSS 변수 정의
- `get_variable_defs` 반환 데이터 (있는 경우)
- Phase 0-3a Variation Matrix (테마 변형 식별 — **라이트/다크 모드 쌍**)

### 추출 프로세스

각 주요 섹션에 대해 `get_design_context(fileKey, nodeId)` 호출:

```
get_design_context(fileKey, nodeId="<events-page>")
get_design_context(fileKey, nodeId="<detail-page>")
get_design_context(fileKey, nodeId="<portfolio-page>")
...
```

반환된 코드에서 CSS variable 정의와 인라인 스타일을 추출한다.

### 다크/라이트 모드 토큰 추출

Variation Matrix에서 같은 페이지의 라이트/다크 쌍이 식별되면,
**양쪽 모두** `get_design_context`를 호출하여 CSS 변수의 fallback 값을 비교한다.

```
# 라이트 모드 프레임
get_design_context(fileKey, nodeId="272:5257")  # events (light)
→ bg-default: white, text-highlight: black, bullish-intense: #1e9171

# 다크 모드 프레임
get_design_context(fileKey, nodeId="292:8139")  # events (dark)
→ bg-default: #1e232e, text-highlight: white, bullish-intense: #0bdfa5
```

같은 CSS 변수명인데 fallback 값이 다르면 → 다크 모드 토큰 세트가 존재하는 것이다.
**두 세트 모두 ui-tokens.json에 기록한다.**

### 추출 항목

| 카테고리 | 추출 대상 | 소스 필드 |
|----------|-----------|-----------|
| `colors` | 배경, 텍스트, 강조, 테두리, 도메인 색상 | fills, strokes, effect colors |
| `typography` | 폰트 패밀리, 크기, 굵기, 행간, 자간 | font family, size, weight, lineHeight |
| `spacing` | 여백, 패딩, 간격, 반경 | padding, gap, itemSpacing, cornerRadius |
| `effects` | 그림자, 블러 | shadows, blur |

### 출력 형식

```json
{
  "_meta": {
    "lastSection": 4,
    "sectionPattern": "category",
    "themes": ["light", "dark"]
  },
  "colors": {
    "<semantic-name>": {
      "light": "<hex>",
      "dark": "<hex>",
      "usage": "<사용 위치>"
    }
  },
  "typography": {
    "<style-name>": {
      "fontFamily": "<font>",
      "fontSize": "<px>",
      "fontWeight": "<number>",
      "lineHeight": "<ratio>",
      "letterSpacing": "<value>",
      "usage": "<사용 위치>"
    }
  },
  "spacing": {
    "<name>": { "value": "<px>", "usage": "<사용 위치>" }
  },
  "effects": {
    "<name>": { "value": "<css-value>", "usage": "<사용 위치>" }
  }
}
```

**다크 모드가 없는 경우 (단일 테마):**

```json
"colors": {
  "<semantic-name>": { "value": "<hex>", "usage": "<사용 위치>" }
}
```

**다크 모드가 있는 경우 (듀얼 테마):**

```json
"colors": {
  "bg-default":            { "light": "#ffffff", "dark": "#1e232e", "usage": "페이지 배경" },
  "bg-subtle":             { "light": "#f3f6f8", "dark": "#161a21", "usage": "페이지 외부 배경" },
  "surface-default-base":  { "light": "#ffffff", "dark": "#1e232e", "usage": "카드, 컨테이너 배경" },
  "surface-subtle-base":   { "light": "#f3f6f8", "dark": "#252b39", "usage": "옵션 버튼, 입력 배경" },
  "surface-strong":        { "light": "#ecf0f2", "dark": "#363b4c", "usage": "프로그레스 바 배경" },
  "text-highlight":        { "light": "#000000", "dark": "#ffffff", "usage": "제목, 강조 텍스트" },
  "text-primary-base":     { "light": "#1e232e", "dark": "#ecf0f2", "usage": "본문 텍스트" },
  "text-tertiary-base":    { "light": "#a2aaba", "dark": "#62697a", "usage": "비활성 메뉴, 보조 텍스트" },
  "border-subtle":         { "light": "#f3f6f8", "dark": "#252b39", "usage": "카드 테두리" },
  "border-strong":         { "light": "#000000", "dark": "#ffffff", "usage": "활성 탭 밑줄" },
  "bullish-intense":       { "light": "#1e9171", "dark": "#0bdfa5", "usage": "상승/Yes 텍스트" },
  "bearish-intense":       { "light": "#d20625", "dark": "#ec3c56", "usage": "하락/No 텍스트" }
}
```

### 핵심 원칙
- Figma에서 추출한 **정확한 값** 사용 (근사값 금지)
- **시맨틱 키** 사용 (목적 기반 네이밍: `bg-default` not `color-ffffff`)
- 모든 고유한 시각적 값 캡처
- `_meta.sectionPattern`은 `"category"` 사용
- **다크/라이트 테마가 존재하면 반드시 양쪽 값 모두 추출** — 한쪽만 추출하면 불완전

---

## Phase 2: ui-assets.json 생성

### 입력 소스
- Phase 0에서 다운로드한 `inputs/assets/` 파일 목록
- `get_metadata`에서 식별한 에셋 노드 정보
- Phase 1의 ui-tokens.json (REFERENCE)

### 에셋 분류

| 유형 | 설명 | 파일 다운로드 | JSON 위치 |
|------|------|-------------|-----------|
| 아이콘 라이브러리 | Lucide 등 npm 패키지 아이콘 | 불필요 | `iconLibrary` |
| 커스텀 아이콘 (SVG) | 로고, 커스텀 아이콘 | Phase 0에서 다운로드 | `icons` |
| 이미지 (PNG/JPG) | 메달, 일러스트 등 | Phase 0에서 다운로드 | `images` |
| 동적 에셋 | API에서 로드되는 이미지 | 불필요 (런타임) | `dynamicAssets` |

### 출력 형식

```json
{
  "_meta": {
    "lastSection": 3,
    "sectionPattern": "top-level",
    "pathPattern": {
      "icons": "public/icons/",
      "images": "public/images/"
    }
  },
  "iconLibrary": {
    "name": "<library-name>",
    "package": "<npm-package>",
    "defaultSize": "<px>",
    "icons": {
      "<icon-name>": { "usage": "<사용 위치>", "sizes": ["<px>"], "color": "<token>" }
    }
  },
  "icons": {
    "<asset-id>": {
      "src": "inputs/assets/<filename>",
      "dest": "public/icons/<filename>",
      "format": "svg",
      "figmaNodeId": "<nodeId>",
      "usage": "<사용 위치>",
      "rendering": { "method": "explicit", "width": "<number>", "height": "<number>" }
    }
  },
  "images": {
    "<asset-id>": {
      "src": "inputs/assets/<filename>",
      "dest": "public/images/<filename>",
      "format": "png",
      "figmaNodeId": "<nodeId>",
      "usage": "<사용 위치>",
      "rendering": { "method": "explicit", "width": "<number>", "height": "<number>" }
    }
  },
  "dynamicAssets": {
    "<asset-id>": {
      "format": "<type>",
      "sizes": { "<context>": "<px>" },
      "fallback": "<fallback 설명>",
      "usage": "<사용 위치>"
    }
  }
}
```

### rendering.method 결정 기준

| method | 사용 시점 | 필수 필드 |
|--------|-----------|-----------|
| `explicit` | 로고, 아이콘 (고정 크기) | `width`, `height` (px) |
| `fill` | 카드 배경, 썸네일 | `containerSize` (예: "300x200") |
| `css-background` | 풀 섹션 배경 | `containerSize: "full-width"` |

### 핵심 원칙
- `rendering` 필드 필수 (Code Job이 사이즈를 추측하지 않도록)
- `figmaNodeId` 기록 (추후 재 export 시 사용)
- 카테고리는 디자인 구조에서 관찰하여 결정

---

## Phase 3: ui-spec.json 생성

### 입력 소스
- Phase 0-3a **Variation Matrix** (변형별 nodeId 목록 — 핵심 입력)
- Phase 0-3b **Annotation 수집 결과** (디자이너 주석 → behavior spec)
- Phase 0-3c **Component State Matrix** (컴포넌트별 상태 변형 → `states` 블록)
- Phase 0-3d **Interaction State 수집 결과** (인터랙션 상태 → `interactionStates` 블록)
- `get_design_context` (변형별 개별 호출)
- `get_metadata` 좌표 데이터 (레이아웃 구조 검증용)
- `inputs/sources/prd.md` (화면 목록, 사용자 흐름, 기능 요구사항; 없으면 Figma 메타데이터·Annotation만으로 화면 목록·동작 사양 도출)
- Phase 1 ui-tokens.json (REFERENCE)
- Phase 2 ui-assets.json (REFERENCE)
- `inputs/references/` 스크린샷 (보조 — Code Job에는 전달되지 않음)

PRD가 없으면: Figma 메타데이터의 페이지/프레임 목록과 Annotation만으로 화면 목록과 동작 사양을 도출한다. 페이지 의도(intent)는 프레임/섹션 이름과 Annotation에서 추론한다.

### 변형별 탐색 프로세스 (Variation Matrix 기반)

Phase 0-3a에서 작성한 Variation Matrix의 **모든 프레임**에 대해 개별적으로
`get_design_context`를 호출한다. 대표 프레임 1개만 호출하면 안 된다.

```
# Variation Matrix 기반 호출 — events/detail 예시
get_design_context(fileKey, nodeId="272:8710")   # Multi Yes/No (기본)
get_design_context(fileKey, nodeId="292:8947")   # Multi Yes/No (오더북 확장)
get_design_context(fileKey, nodeId="321:4175")   # Single Yes/No
get_design_context(fileKey, nodeId="279:9759")   # Up/Down
get_design_context(fileKey, nodeId="292:13221")  # 종료된 마켓
...
```

각 호출 결과에서 다음을 비교 분석한다:

1. **레이아웃 구조 diff**: 변형 간 컴포넌트 배치가 다른지 확인
   - 예: Multi-market에서 오더북이 Left Column에 있지만, 구현에서 Sidebar로 잘못 배치
2. **기본 상태(defaultState)**: Annotation에서 도출한 동작 사양과 매칭
   - 예: "기본적으로 다 닫혀있음" → accordion defaultState = closed
3. **조건부 속성**: 변형에만 존재하는 요소 식별
   - 예: 종료된 마켓에만 "Claim" 버튼 존재

**대용량 프레임 처리**: `get_design_context` 응답이 불완전하거나 잘린 경우, 해당 프레임의 **주요 자식 노드 ID**를 `get_metadata`에서 확인한 뒤 **자식 단위로 개별 `get_design_context`** 호출한다. 필요 시 MCP의 `forceCode` 옵션을 사용할 수 있다. 자세한 절차는 문서 말미의 "대용량 디자인 처리"를 참고한다.

### 좌표 기반 레이아웃 구조 파악

`get_metadata`의 좌표(x, y, width)로 레이아웃 구조를 **검증**한다.
`get_design_context`의 코드만으로는 컬럼 배치를 오독할 수 있기 때문이다.

```
# 좌표로 two-column 레이아웃 파악
<frame name="Left Column" x="0" width="968">    ← x=0, w=968
<frame name="Sidebar" x="1000" width="360">     ← x=1000, w=360
→ two-column layout: left 968px + gap 32px + sidebar 360px

# 좌표로 vertical stack 파악
<frame name="Chart" x="0" y="128">
<frame name="Order Book" x="0" y="417">         ← 같은 x, 다른 y
→ column stack: Chart → Order Book (Left Column 내부)
```

**규칙**:
- 같은 parent 내에서 **x가 다르면** → row 레이아웃
- 같은 parent 내에서 **x가 같고 y가 다르면** → column 스택
- width 비율에서 컬럼 비중을 도출 (예: 968/1360 ≈ 71% | 360/1360 ≈ 26%)

### Observation Protocol (순서대로 수행)

**Step 1: Container Structure**
- 각 섹션의 주요 컨테이너 구조 결정
- flexDirection: row vs column
- 중첩 구조 식별 (outer -> inner)
- **좌표 검증**: `get_metadata`의 x/y/width로 row vs column 판정 확인

**Step 2: Child Arrangement**
- Direction: 수평(row) or 수직(column)
- Main Axis (justifyContent): 자식 요소 분배 방식
- Cross Axis (alignItems): 교차축 정렬 (필수 관찰!)
- Edge Position: space-between 시 가장자리 접촉 여부

**Step 3: Element Details**
- 색상/타이포/간격 -> 모두 token 참조
- 이미지 -> objectFit (cover/contain/fill)
- 상태 -> hover, active, focus
- gradient/overlay -> 관찰된 경우만 추가 (추측 금지)

**Step 4: Behavior Spec 반영**
- Phase 0-3b에서 수집한 Annotation을 각 컴포넌트의 `behavior` 필드로 반영
- 기본 상태 (defaultState), 조건부 표시, 컬러 분기 등

### 출력 형식

```json
{
  "_meta": {
    "lastSection": "<number>",
    "sectionPattern": "page"
  },
  "meta": {
    "viewport": "<px> (desktop-first)",
    "breakpoints": { "xl": "<px>", "lg": "<px>", "md": "<px>", "sm": "<px>" },
    "fontFamily": "<font>",
    "colorScheme": "light"
  },
  "layout": {
    "type": "vertical-stack",
    "maxWidth": "<px>",
    "structure": ["header", "titleBar", "content", "footer"],
    "pagePadding": { "horizontal": "<spacing-token>" }
  },
  "sections": {
    "<section-id>": {
      "intent": "<이 디자인 선택의 이유>",
      "layout": { "direction": "<row|column>", "justify": "<value>", "align": "<value>" },
      "contentOrder": ["<first>", "<second>"],
      "elements": { }
    }
  },
  "pages": {
    "<page-id>": {
      "intent": "<페이지 목적>",
      "background": "<token>",
      "variants": { },
      "components": { }
    }
  },
  "overlays": { }
}
```

**Ant 호환성**: Ant의 Code Job과 UiDocParser는 `sections`, `pages`, `overlays` 등 모든 top-level 컨테이너를 섹션으로 파싱한다. ui-spec 최상위에 `sections`(공통 영역), `pages`(페이지별·variants), `overlays`를 두면 그대로 사용 가능하다. `_meta.sectionPattern`은 `"top-level"` 또는 `"page"` 모두 처리 가능하며, Ant 가이드와의 일관성을 위해 `"top-level"` 사용을 권장한다.

### variants 구조 (페이지 변형이 있는 경우 필수)

Figma에서 같은 페이지의 다양한 상태 변형이 별도 프레임으로 존재하면,
`variants` 블록에 각 변형의 **레이아웃, 동작, 기본 상태**를 명시한다.

**왜 필요한가**: Code Job은 JSON만 읽는다. 변형 간 레이아웃 차이(예: 컴포넌트 배치 위치,
기본 열림/닫힘 상태)가 `variants`에 없으면 Code Job은 대표 변형의 레이아웃만 구현한다.

```json
{
  "pages": {
    "marketDetail": {
      "variants": {
        "multi-market": {
          "figmaNodeIds": ["272:8710", "292:8947"],
          "layout": {
            "type": "two-column",
            "leftColumn": {
              "width": "968px",
              "content": ["eventInfo", "chart", "marketOptionsAccordion", "rules"]
            },
            "sidebar": {
              "width": "360px",
              "content": ["equityCard", "tradingPanel"]
            }
          },
          "behavior": {
            "marketOptionsAccordion": "all closed by default, first option Yes active",
            "chartColors": "per-option series: bullish, bearish, series-3, series-4"
          }
        },
        "single-yesno": {
          "figmaNodeIds": ["321:4175", "329:3565"],
          "layout": {
            "type": "two-column",
            "leftColumn": {
              "width": "968px",
              "content": ["eventInfo", "chart", "orderbookDirect", "rules"]
            },
            "sidebar": {
              "width": "360px",
              "content": ["equityCard", "tradingPanel"]
            }
          },
          "behavior": {
            "orderbookDirect": "open by default, label: 'Order Book' instead of option name",
            "chartColors": "single purple line"
          }
        },
        "updown": {
          "figmaNodeIds": ["279:9759"],
          "behavior": {
            "roundBased": true,
            "chartMode": "probability and price toggle"
          }
        },
        "closed": {
          "figmaNodeIds": ["292:13221", "312:3644"],
          "behavior": {
            "withShares": "show claim button + result display",
            "withoutShares": "show result display only"
          }
        }
      },
      "components": { }
    }
  }
}
```

**variants 작성 규칙**:
- `figmaNodeIds`: Variation Matrix에서 해당 변형에 속하는 프레임 ID
- `layout`: 대표 변형과 **레이아웃 구조가 다른 경우** 반드시 명시
  - `layout.leftColumn.content` / `layout.sidebar.content`로 어떤 컴포넌트가 어느 영역에 배치되는지 기술
- `behavior`: Annotation에서 도출한 동작 사양 (기본 상태, 컬러 분기, 조건부 표시 등)
- 레이아웃이 동일하고 behavior만 다르면 layout은 생략 가능

### 요소 분류 기준

| 조건 | 기록 위치 |
|------|-----------|
| 모든 페이지에 표시되는 요소 (Header, Footer 등) | `sections` |
| 페이지별 고유 컴포넌트 | `pages.<page>.components` |
| 페이지 위에 떠있는 요소 (모달, 토스트) | `overlays` |

### 핵심 원칙
- **Token-First**: 모든 시각적 값은 `ui-tokens.json`의 토큰 참조 (raw hex/px 금지)
- **Asset Reference**: 모든 에셋은 `ui-assets.json`의 ID 참조
- **contentOrder 필수**: 2개 이상 자식 요소가 있는 모든 컨테이너
- **intent 필드**: 주요 레이아웃 결정에 대한 "왜" 설명
- **PRD 대조**: PRD에 정의된 모든 페이지가 포함되었는지 확인
- **관찰 기반**: 스크린샷에서 보이지 않는 속성 추가 금지
- **패턴 일관성**: 시각적으로 동일한 구조 -> 동일한 스펙
- **Variation 완전성**: Variation Matrix의 모든 변형이 `variants` 블록에 반영됨
- **Layout 정확성**: 좌표 데이터로 검증된 레이아웃 구조 (컬럼 배치, 스택 순서)
- **Behavior 명시성**: Annotation에서 도출한 동작 사양이 `behavior` 필드에 기록됨

---

## 파일 저장 위치

```
<feature-dir>/
  inputs/
    sources/
      prd.md              <- 제품 요구사항 문서
    references/            <- Figma 스크린샷 (REST API로 다운로드)
      events.png
      market-detail.png
      portfolio.png
      ...
    assets/                <- Figma 에셋 (REST API로 다운로드)
      x-logo.svg
      medal-gold.png
      ...
  outputs/
    design/
      ui-tokens.json       <- Phase 1 출력
      ui-assets.json       <- Phase 2 출력
      ui-spec.json         <- Phase 3 출력
```

---

## Figma REST API 레퍼런스

### Image Export API

```bash
GET https://api.figma.com/v1/images/:file_key
  ?ids=<node_id_1>,<node_id_2>,...
  &format=svg|png|jpg|pdf
  &scale=1|2|3|4              # PNG/JPG만 해당
  &svg_include_id=false        # SVG: 노드 ID 포함 여부

Headers:
  X-Figma-Token: <personal-access-token>
```

**응답**:
```json
{
  "err": null,
  "images": {
    "<node_id>": "<download_url>"
  }
}
```

반환된 URL은 임시 S3 URL (유효 기간 ~30분). 즉시 다운로드할 것.

### File API (페이지/노드 조회)

```bash
# 파일 최상위 구조
GET https://api.figma.com/v1/files/:file_key?depth=1

# 특정 노드 하위 트리
GET https://api.figma.com/v1/files/:file_key/nodes?ids=<node_ids>&depth=5
```

## Figma MCP 도구 레퍼런스

| 도구 | 용도 | 제약사항 |
|------|------|----------|
| `get_metadata` | 노드 트리 구조 (XML) | 대용량 디자인은 응답이 잘릴 수 있음 |
| `get_design_context` | 상세 디자인 데이터 (React+Tailwind 코드) | 노드 단위 호출, 큰 프레임은 분할 필요 |
| `get_screenshot` | 노드 스크린샷 | **inline 이미지만 반환, 파일 저장 불가** |
| `get_variable_defs` | Figma Variables | **nodeId 필수** (fileKey만으로 호출 불가) |

### 대용량 디자인 처리

디자인이 복잡하여 `get_design_context` 응답이 잘리는 경우:
1. `get_metadata`로 전체 노드 맵 확인
2. 주요 child node ID 식별
3. 각 child에 대해 개별적으로 `get_design_context` 호출

---

## 실전 함정 및 해결책

### 인스턴스 vs 컴포넌트 nodeId

Header/Footer가 `INSTANCE` 타입이면, 내부 자식의 nodeId가 `I272:5258;224:726` 형태다.
이 ID는 REST API Image Export에서 사용 불가. 반드시 **컴포넌트 원본**의 nodeId로 export해야 한다.

```
❌ I272:5258;224:726  (인스턴스 내부 참조 ID)
✅ 224:726            (컴포넌트 원본 ID)
```

### 프레임 vs 벡터 export

아이콘을 export할 때:
- **벡터(VECTOR)만 export**: viewBox 없이 path만 나옴 → 사용 곤란할 수 있음
- **컨테이너 프레임 export**: 올바른 viewBox + 내부 요소 포함 → 권장

단, 프레임에 보더/배경이 있으면 함께 export된다. 아이콘만 필요하면 벡터 노드를 사용.

### 잘못된 nodeId 감지

export 후 파일 크기로 빠르게 검증:
- 10x26px 아이콘 SVG: ~100-500 bytes가 정상
- 91KB SVG: 부모 프레임이나 텍스트까지 포함된 것 → nodeId 재확인 필요
- PNG 이미지가 0 bytes: nodeId 오류 또는 빈 프레임

### get_variable_defs 에러

`get_variable_defs`는 `nodeId`가 필수인데, 문서에 명시되어 있지 않을 수 있다.
에러 발생 시 임의 nodeId(예: 메인 페이지 ID)를 전달하면 된다.

---

## 체크리스트

### Phase 0: 에셋/스크린샷/변형 탐색
- [ ] PAT 유효성 확인 (REST API 테스트 호출)
- [ ] get_metadata로 모든 페이지/섹션을 한 번씩 조회했는가?
- [ ] 메타데이터가 잘렸다면 REST API nodes로 노드 목록을 보완했는가?
- [ ] 모든 커스텀 에셋 nodeId 확보 (컴포넌트 원본 ID)
- [ ] SVG 에셋 다운로드 후 viewBox/크기 검증
- [ ] PNG 에셋 다운로드 후 파일 타입/크기 검증
- [ ] 주요 페이지 스크린샷 다운로드
- [ ] **Variation Matrix 완성**: 모든 섹션의 모든 프레임 변형이 식별됨
- [ ] **테마 변형 식별**: 라이트/다크 모드 쌍이 Variation Matrix에 테마 컬럼으로 구분됨
- [ ] **Annotation 수집 완료**: 섹션 직속 text 노드에서 디자이너 주석 추출됨

### Phase 1: ui-tokens.json
- [ ] 모든 고유 색상 값 캡처 (도메인 색상 포함)
- [ ] **다크/라이트 모드 토큰 쌍 추출**: 같은 CSS 변수의 라이트/다크 fallback 값이 모두 기록됨
- [ ] 모든 타이포그래피 패턴 캡처
- [ ] 시맨틱 키 사용 (목적 기반)
- [ ] 유효한 JSON 구문

### Phase 2: ui-assets.json
- [ ] `inputs/assets/` 의 모든 파일이 매핑됨
- [ ] 아이콘 라이브러리(Lucide 등) 별도 섹션으로 분리
- [ ] 모든 에셋에 `rendering` 필드 포함
- [ ] 모든 에셋에 `dest` 필드 포함
- [ ] `_meta.pathPattern` 정의
- [ ] `figmaNodeId` 기록 (재 export 대비)

### Phase 3: ui-spec.json
- [ ] 모든 값이 토큰 참조 (raw hex/px 없음)
- [ ] PRD의 모든 페이지가 포함됨
- [ ] sections/pages/modals/overlays 구조 분리
- [ ] 모든 컨테이너에 contentOrder 포함
- [ ] intent 필드 포함
- [ ] 관찰되지 않은 속성 미추가
- [ ] **Variation Matrix의 모든 변형에 대해 `get_design_context` 호출됨**
- [ ] **변형이 있는 페이지에 `variants` 블록 포함**
- [ ] **각 variant의 `layout.content`가 좌표 데이터와 일치** (교차검증)
- [ ] **Annotation에서 도출한 behavior spec이 `behavior` 필드에 반영됨**
- [ ] **컬럼 배치 검증**: `get_metadata` 좌표의 x/width로 도출한 컬럼 구조가 `layout`과 일치
- [ ] **Component State Matrix의 모든 상태가 해당 컴포넌트의 `states` 블록에 반영됨**
- [ ] **Interaction State의 모든 인터랙션이 해당 요소의 `interactionStates`에 반영됨**
- [ ] **독립 테이블 컴포넌트가 각각 별도로 정의됨** (공유 참조가 아닌 개별 컬럼 명세)
- [ ] **모달의 다단계 플로우가 `flow` 블록에 순서대로 정의됨**
- [ ] **종료 상태 변형의 레이아웃이 활성 상태와 다를 경우 별도 layout 명시됨**
