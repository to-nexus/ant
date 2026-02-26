# Figma -> Ant UI Documents Workflow

Figma 디자인 파일에서 Ant의 3개 UI 문서(ui-tokens.json, ui-assets.json, ui-spec.json)와
실제 에셋 파일을 추출하는 반복 가능한 워크플로우.

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
- 스크린샷 비주얼 분석

### 추출 프로세스

각 주요 섹션에 대해 `get_design_context(fileKey, nodeId)` 호출:

```
get_design_context(fileKey, nodeId="<events-page>")
get_design_context(fileKey, nodeId="<detail-page>")
get_design_context(fileKey, nodeId="<portfolio-page>")
...
```

반환된 코드에서 CSS variable 정의와 인라인 스타일을 추출한다.

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
    "sectionPattern": "category"
  },
  "colors": {
    "<semantic-name>": { "value": "<hex>", "usage": "<사용 위치>" }
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

### 핵심 원칙
- Figma에서 추출한 **정확한 값** 사용 (근사값 금지)
- **시맨틱 키** 사용 (목적 기반 네이밍: `bg-default` not `color-ffffff`)
- 모든 고유한 시각적 값 캡처
- `_meta.sectionPattern`은 `"category"` 사용

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
- `inputs/references/` 스크린샷 (비주얼 관찰)
- `get_design_context` (레이아웃 구조 데이터)
- `inputs/sources/prd.md` (화면 목록, 사용자 흐름, 기능 요구사항)
- Phase 1 ui-tokens.json (REFERENCE)
- Phase 2 ui-assets.json (REFERENCE)

### Observation Protocol (순서대로 수행)

**Step 1: Container Structure**
- 각 섹션의 주요 컨테이너 구조 결정
- flexDirection: row vs column
- 중첩 구조 식별 (outer -> inner)

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
      "components": { }
    }
  },
  "overlays": { }
}
```

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

### Phase 0: 에셋/스크린샷 다운로드
- [ ] PAT 유효성 확인 (REST API 테스트 호출)
- [ ] 모든 커스텀 에셋 nodeId 확보 (컴포넌트 원본 ID)
- [ ] SVG 에셋 다운로드 후 viewBox/크기 검증
- [ ] PNG 에셋 다운로드 후 파일 타입/크기 검증
- [ ] 주요 페이지 스크린샷 다운로드

### Phase 1: ui-tokens.json
- [ ] 모든 고유 색상 값 캡처 (도메인 색상 포함)
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
- [ ] sections/pages/overlays 구조 분리
- [ ] 모든 컨테이너에 contentOrder 포함
- [ ] intent 필드 포함
- [ ] 관찰되지 않은 속성 미추가
