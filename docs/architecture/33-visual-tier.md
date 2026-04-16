# 33. Visual Tier System

Visual Tier는 6개 레이어로 구성된 시각 디자인 정책 시스템이다. 사용자가 상위 3개 레이어를 선택하면, 하위 3개 레이어가 자동 유도된다.

## Part 1: 시스템 설계

### 6-Layer 구조

| # | Layer | 역할 | 선택 방식 |
|---|-------|------|----------|
| 1 | `visualLanguage` | 전체 정체성, 색상, 폰트, 고유 시각 효과 (Signature) | 사용자 선택 |
| 2 | `surfaceSystem` | 패널/컨테이너 표면 처리 (깊이, 보더, 그림자, 투명도) | 사용자 선택 |
| 3 | `spatialSystem` | 간격 리듬, 밀도, base unit | 사용자 선택 |
| 4 | `interactionGrammar` | 마이크로 인터랙션 + 매크로 프레젠테이션 모션 | 자동 유도 (VL → IG) |
| 5 | `componentSemantics` | 컴포넌트 역할 편향 (메트릭/액션/콘텐츠/유틸리티) | 자동 유도 (screenContext → CS) |
| 6 | `visualHierarchyRules` | 시각 위계 규칙 (무엇이 먼저 보이는가) | 자동 유도 (VL + SS → VH) |

### 자동 유도 매트릭스

`visual-tier-registry.ts`에 정의된 pure function들이 파생 레이어를 결정한다:

- **`deriveInteractionGrammar(visualLanguage)`**: `INTERACTION_GRAMMAR_MAP` 룩업. VL variant → IG variant 1:1 매핑.
- **`deriveVisualHierarchyRules(visualLanguage, spatialSystem)`**: `VH_MAP` 룩업. `"VL|SS"` 복합키 → VH variant 매핑.
- **`deriveComponentSemantics(screenContext)`**: `CS_KEYWORDS` 정규식 매칭. 첫 번째 매치된 variant 반환.

이 함수들은 `@ant/shared`에 위치하며 FE(배지 표시)와 BE(프롬프트 빌드) 양쪽에서 사용된다.

### `resolveVisualTier()` 함수

사용자 선택(`userSelection`)과 자동 감지(`autoDetected`)를 병합하고, 파생 레이어를 계산하여 완전한 `VisualTier` 객체를 반환한다.

```
resolveVisualTier(userSelection?, autoDetected?, screenContext?) → Partial<VisualTier>
```

우선순위: `userSelection > autoDetected > derive > undefined`

### Authority 체계

프롬프트에서 시각 정책의 우선순위:

1. **UI artifacts** (디자인 문서의 구체적 지시) — 최고 우선
2. **VL tokens** (Palette, Typography의 구체 값)
3. **VL principles** (Identity, Signature의 방향성)
4. **Framework defaults** — 최저 우선

### `designSystem` 슬롯

`VisualTier.designSystem`은 외부 디자인 시스템(shadcn, Ant Design 등)을 지정하는 별도 슬롯이다. 6-layer 시스템과 독립적으로 동작하며, 디자인 시스템 템플릿은 `basis/visualTier/design-system/{name}` 경로에 위치한다.

### `supportedModes`

`BasisOption.supportedModes` 필드는 VL variant가 지원하는 색상 모드를 나타낸다:
- `'light'`: Light Mode 전용
- `'dark'`: Dark Mode 전용
- `'both'`: Light + Dark 양쪽 지원

VL 템플릿의 Palette 섹션은 `supportedModes`에 따라 해당 모드의 서브섹션만 포함한다.

---

## Part 2: 템플릿 작성 원칙 (전 레이어 공통)

Visual Tier의 모든 레이어 템플릿 작성 시 반드시 준수해야 하는 규칙.

### FPOP 준수 원칙

- 토큰(색상 값, 폰트 이름, radius 값)은 **사양 데이터(Specification)**. 예시(Example)가 아님.
- 토큰의 **적용 방법(How)**은 절대 서술하지 않음. LLM이 이미 아는 영역.
- Constraint는 "하지 말 것"으로 기술. "하라"가 아님.

### 레이어 간 역할 경계

각 레이어 템플릿은 **자기 역할만 기술**한다. 다른 레이어 영역을 침범하지 않는다.

| Layer | 관할 | 침범 금지 |
|-------|------|----------|
| visualLanguage | 정체성, 색상, 폰트, 고유 시각 효과 | hover 효과, 패널 깊이, 간격 값 |
| surfaceSystem | 패널/컨테이너 표면 처리 | 색상 토큰, 인터랙션 |
| spatialSystem | 간격 리듬, 밀도 | 표면 처리, 색상 |
| interactionGrammar | 마이크로 + 매크로 모션 | 색상, 레이아웃, 표면 |
| componentSemantics | 컴포넌트 역할 편향 | 스타일링 구체 값 |
| visualHierarchyRules | 시각 위계 규칙 | 스타일링 구체 값 |

### 공통 구조 규칙

- 모든 레이어 템플릿은 `## {Layer}: {Variant}` 헤딩으로 시작
- Constraint 문은 `Constraint:` 접두사로 시작 (파싱 가능)
- 템플릿당 최대 60줄 이내 (프롬프트 토큰 효율)
- 영어 전용 (FPOP: Universal over Specific)

---

## Part 3: Visual Language 템플릿 작성 규칙

VL 레이어에만 적용되는 추가 규칙.

### 필수 5개 섹션 (순서 고정)

1. **`### Identity`** — 1-2문장. 이 스타일의 핵심 철학과 인식 포인트.
2. **`### Palette`** — oklch 색공간 토큰. `supportedModes`에 따라 Light/Dark 서브섹션.
3. **`### Typography`** — Google Fonts CDN 전용. `--font-heading`, `--font-body`, `--font-mono` 3개 토큰 필수. 타이포 캐릭터 1-2문장.
4. **`### Signature`** — 이 VL만의 고유 시각 DNA 2-4항목. 다른 레이어가 커버하지 않는 것만.
5. **`### Constraints`** — 금지 사항 3-5개.

### Palette 토큰 필수 목록

`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--accent`, `--muted`, `--muted-foreground`, `--destructive`, `--border`, `--radius`

### Signature 작성 규칙

- WHAT만 기술 (어떤 효과), HOW는 기술하지 않음 (구체 CSS 속성)
- 다른 레이어 영역(hover 효과, 패널 깊이, 간격 값)을 침범하지 않음

### supportedModes 규칙

- `light`: Light Mode 토큰만. Dark Mode 서브섹션 없음.
- `dark`: Dark Mode 토큰만. Light Mode 서브섹션 없음.
- `both`: Light + Dark 두 서브섹션 모두 필수.

### 폰트 규칙

- Google Fonts CDN에서 로드 가능한 폰트만 사용
- 시스템 폰트(SF Pro, Segoe UI 등) 금지
- npm 패키지 전용 폰트(Geist 등) 금지
- 폰트 이름만 지정. weight/line-height는 Typography 캐릭터 문장으로 방향만 제시

---

## Part 4: 비-VL 레이어 템플릿 작성 규칙

surfaceSystem, spatialSystem, interactionGrammar, componentSemantics, visualHierarchyRules에 적용.

### 공통 구조

- `## {Layer}: {Variant}` 헤딩
- 설명 1문장
- 관심사별 `**Bold Label**:` 패턴으로 항목 나열
- `Constraint:` 접두사 제약 2-3개
- 원칙 기반 (구체 값 대신 방향/제약 제시). 토큰 없음.

### interactionGrammar 추가 규칙

- 필수 2개 섹션: `### Micro-interaction` + `### Presentation Motion`
- Micro: Hover, Focus, Active, Loading, Empty, Error 상태
- Macro: Page entrance, Section reveal, Parallax, Hero 연출, Duration/stagger
- `Constraint: All motion MUST respect prefers-reduced-motion.` 필수 포함

---

## 프롬프트 로딩 순서

`PromptBuilder.buildBasisSection()`에서 Visual Tier 템플릿은 다음 순서로 로드된다:

1. `_preamble.md` (공통 전문)
2. `visualLanguage/_token-rules.md` (토큰 제약 규칙)
3. 레이어별 variant 템플릿 (`VISUAL_TIER_LAYER_KEYS` 순서)
4. job-specific preamble (있는 경우)

---

## 파일 구조

```
packages/ant-shared/src/
├── rac.ts                        # 타입 정의 (6개 variant type + VisualTier interface)
├── visual-tier-registry.ts       # 레지스트리 (variants, options, derive functions, template paths)
└── tech-tier-registry.ts         # BasisOption interface

packages/ant-cli/src/core/prompt/
├── builder/PromptBuilder.ts      # Visual Tier 템플릿 로딩
└── templates/basis/visualTier/
    ├── _preamble.md
    ├── visualLanguage/
    │   ├── _token-rules.md       # 공통 토큰 제약 partial
    │   ├── cleanBright.md        # 14개 VL variant
    │   └── ...
    ├── surfaceSystem/
    ├── spatialSystem/
    ├── interactionGrammar/
    │   ├── restrained.md
    │   ├── subtleProduct.md
    │   ├── calmPremium.md
    │   ├── expressivePlayful.md
    │   ├── cinematicReveal.md
    │   └── rawInstant.md
    ├── componentSemantics/
    └── visualHierarchyRules/

packages/ant-ui/src/presentation/components/Actions/basis/
├── BasisSummaryBar.tsx           # 자동 유도 레이어 배지 표시
├── BasisWizard.tsx               # DecidedLayersBreadcrumb 통합
├── DecidedLayersBreadcrumb.tsx   # 파생 레이어 pill 표시
└── useBasisWizard.ts             # derivedLayers 계산
```
