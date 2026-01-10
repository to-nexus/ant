# 문서 흐름 및 우선순위 체계

## 📋 개요

Code Job의 각 단계(Detect, Decompose, Plan, Execute)에서 사용하는 문서들의 역할, 보완 관계, 우선순위를 명확히 정의합니다.

---

## 🗂️ 문서 종류 및 정의

### 1. **directive** (사용자 지시)
- **정의**: 사용자가 작성한 원본 요청
- **위치**: `features/<feature>/inputs/directive.md` 또는 chat input
- **내용**: "landing page 구현", "버그 수정", "API 추가" 등
- **특징**: 
  - 간단명료 (1-3 문장)
  - 구체적 세부사항 없음
  - Ground truth (원본 요청)

**예시**:
```markdown
// directive.md
ant-ogf 프로젝트의 landing page를 구현해줘
```

---

### 2. **prd** (Product Requirements Document)
- **정의**: Design Job의 PRD 산출물
- **위치**: `features/<feature>/outputs/prd/prd.md`
- **내용**: 제품 요구사항, 기능 명세, 사용자 스토리, **콘텐츠 텍스트**
- **특징**:
  - 비기술적 (what to build)
  - 비즈니스 요구사항 + **실제 콘텐츠**
  - Design Job에서 생성
  - **Code Job의 Execute 단계에서 사용**

**예시**:
```markdown
// prd.md
## Landing Page Requirements

### Hero Section
- Headline: "Build faster with AI-powered development"
- Subheading: "Transform your ideas into production-ready code in minutes"
- CTA Primary: "Start Free Trial"
- CTA Secondary: "Watch Demo"

### Features Showcase
Feature 1: "Intelligent Code Generation"
  - Description: "Our AI understands context and generates clean, maintainable code"
  
Feature 2: "Real-time Collaboration"
  - Description: "Work with your team seamlessly in a shared workspace"
  
Feature 3: "Built-in Best Practices"
  - Description: "Automatic code reviews and security checks"
```

**역할**: 
- ✅ **콘텐츠 텍스트 제공** (Headline, descriptions, button labels)
- ✅ 비즈니스 요구사항
- ✅ Design이 커버하지 못하는 세부 텍스트

---

### 3. **design** (System Design Document)
- **정의**: Design Job의 system-design 산출물
- **위치**: 
  - `features/<feature>/outputs/design/fe-system-design.md`
  - `features/<feature>/outputs/design/be-system-design.md`
- **내용**: 
  - 기술적 설계 (architecture, components, API)
  - Stack 선택 (React, Express, PostgreSQL 등)
  - File structure, data models
- **특징**:
  - 기술적 (how to build)
  - Architecture decisions
  - **Code Job의 PRIMARY spec**

**예시**:
```markdown
// fe-system-design.md
## Tech Stack
- Framework: Next.js 14 (App Router)
- Styling: Tailwind CSS

## Components
- Header: Logo, Navigation
- Hero: Full-width background, CTA buttons
- Features: 3-column grid layout
```

---

### 4. **uiDoc** (UI Specification)
- **정의**: Design Job의 ui-spec 산출물
- **위치**: `features/<feature>/outputs/design/ui-spec.md`
- **내용**:
  - UI 컴포넌트 상세 specs (layout, typography, colors)
  - Responsive breakpoints
  - Interactions (hover, click, animations)
- **특징**:
  - Figma-derived (디자인 툴 기반)
  - UI 태스크에만 injection
  - **UI 구현의 SSOT**

**예시**:
```markdown
// ui-spec.md
## Hero Section
- Layout: Full-width, centered content
- Background: Image (bg-main.png)
- Typography: H1 (64px, bold), Body (18px)
- CTA Buttons: Primary (blue), Secondary (white)
- Responsive: Mobile (stack vertical), Desktop (horizontal)
```

---

### 5. **uiAssets** (UI Assets Mapping)
- **정의**: Design Job의 ui-assets 산출물
- **위치**: `features/<feature>/outputs/design/ui-assets.md`
- **내용**:
  - Asset Dependency Map (어떤 섹션이 어떤 asset 사용)
  - Source → Destination 경로 매핑
  - Asset metadata (크기, 용도)
- **특징**:
  - Asset 복사 지침서
  - UI 태스크에만 injection
  - **Asset 관리의 SSOT**

**예시**:
```markdown
// ui-assets.md
## Asset Dependency Map

### Hero Section
- bg.hero: inputs/assets/bg/bg-main.png
  Usage: Full-width background image
  Destination: codebase/public/assets/images/bg-main.png

### Features Section
- icon.feature-1: inputs/assets/icons/icon-speed.svg
  Usage: Feature card icon
  Destination: codebase/public/assets/icons/icon-speed.svg
```

---

## 🔄 문서 흐름 (Design Job → Code Job)

### Design Job 산출물
```
User Input (directive)
↓
Design Job
├─ prd.md (PRD)
├─ fe-system-design.md (Frontend Design)
├─ be-system-design.md (Backend Design)
├─ ui-spec.md (UI Specification)
├─ ui-assets.md (Asset Mapping)
└─ ui-tokens.md (Design Tokens)
```

### Code Job 입력
```
Code Job receives:
- directive: 원본 사용자 지시
- prd: PRD 문서 (optional)
- design: fe-system-design + be-system-design (unified)
- uiDoc: ui-spec (UI 태스크에만)
- uiAssets: ui-assets (UI 태스크에만)
```

---

## 🎯 각 단계별 문서 사용

### 1️⃣ Detect 단계

**목적**: Mode(generate/refactor/explain), Environment(frontend/backend/fullstack) 판단

**입력**:
```typescript
{
  directive: string,           // 사용자 지시 (primary)
  prdSpec?: string,            // PRD 문서 (optional, 보조)
  designDocs?: string,         // Design 문서들 (optional, 보조)
  profile?: CodebaseProfile    // Existing codebase profile
}
```

**사용 우선순위**:
1. **directive** - Mode 판단 (error 키워드? feature 키워드?)
2. **designDocs** - Environment 판단 (fe-system-design? be-system-design?)
3. **prdSpec** - 보조 정보

**출력**:
```typescript
{
  mode: 'generate' | 'refactor' | 'explain',
  environment: 'frontend' | 'backend' | 'fullstack' | 'unknown'
}
```

---

### 2️⃣ Decompose 단계

**목적**: 태스크 분해 (큰 방향 제시)

**입력**:
```typescript
{
  spec: string,                // = directive (Decompose에서는 spec이란 변수명)
  designDoc: string,           // = design (fe + be unified)
  hasDesignDoc: boolean,
  mode: string,
  profile: CodebaseProfile,
  codebaseFilePaths?: string[] // RAG 결과 (existing codebase)
}
```

**프롬프트 injection**:
```markdown
SPECIFICATION:
{{spec}}  ← directive가 여기에 injection

{{#if designDoc}}
## 📐 DESIGN SPECIFICATION AVAILABLE
{{designDoc}}  ← fe-system-design + be-system-design unified
{{/if}}
```

**사용 우선순위**:
1. **designDoc (design)** - PRIMARY spec (architecture, components)
2. **spec (directive)** - High-level goal
3. **codebaseFilePaths** - Existing code 참고

**역할**:
- ✅ 큰 방향만 제시 ("landing page 구현", "API 구현")
- ✅ designDoc 기반 태스크 분해
- ❌ 세부사항 명시 금지 ("3 cards", "5 buttons" 등)

---

### 3️⃣ Plan 단계

**목적**: 문서 기반 완전 계획

**입력**:
```typescript
{
  taskName: string,
  taskDescription: string,     // Decompose 출력 (방향만)
  directive: string,           // 원본 지시 (ground truth)
  designDoc?: string,          // design (API Contract)
  uiDoc?: string,              // ui-spec (UI tasks only)
  projectCodeContext?: any,    // Existing codebase
  // ... more
}
```

**프롬프트 injection**:
```markdown
## Task (Starting Point)
{{taskName}}
{{taskDescription}}

## Original Directive (Ground Truth)
{{directive}}

{{#if designDoc}}
## 📐 DESIGN SPECIFICATION (SOURCE OF TRUTH)
{{designDoc}}
{{/if}}

{{#if hasUiDoc}}
## 🎨 UI SPECIFICATION & ASSETS
{{uiDoc}}
{{/if}}
```

**사용 우선순위** (UI 태스크):
1. **uiDoc (ui-spec.md)** - UI 구현의 SSOT
2. **uiAssets (ui-assets.md)** - Asset 복사 지침서
3. **designDoc (design)** - 보조 (architecture context)
4. **taskDescription** - 방향 참고만
5. **directive** - Ground truth (objective facts)

**사용 우선순위** (API 태스크):
1. **designDoc (design)** - API Contract (endpoints, types)
2. **taskDescription** - 방향 참고
3. **directive** - Ground truth
4. **projectCodeContext** - Existing code 통합

**역할**:
- ✅ Task description은 방향만 (출발점)
- ✅ 문서를 READ → 완전한 요구사항 추출
- ✅ 문서의 모든 내용을 Plan에 포함
- ✅ UI 태스크: Asset Inventory + Layout & Component Specs 필수

---

### 4️⃣ Execute 단계

**목적**: Plan 충실히 따름

**입력**:
```typescript
{
  currentTask: CodeTask,
  planText: string,            // Plan 단계 출력 (SSOT)
  directive?: string,          // 보조 (context)
  designDoc?: string,          // 보조 (API Contract)
  prdSpec?: string,            // ✅ 콘텐츠 텍스트 (button labels, descriptions)
  uiDoc?: string,              // 보조 (UI 태스크)
  uiAssets?: string,           // 보조 (Asset 매핑)
  projectCodeContext?: any,
  // ... more
}
```

**프롬프트 injection**:
```markdown
## Task
{{currentTask.name}}

## Implementation Plan
{{planText}}  ← Plan 출력 (PRIMARY)

{{#if prdSpec}}
## Requirements (PRD)
{{prdSpec}}  ← 콘텐츠 텍스트
{{/if}}

{{#if designDoc}}
## 📋 DESIGN SPECIFICATION
{{designDoc}}
{{/if}}

{{#if uiDoc}}
## 🎨 UI SPEC (Figma-derived)
### 🚨 FOLLOW THE PLAN
{{uiDoc}}
{{/if}}
```

**사용 우선순위**:
1. **planText** - PRIMARY SSOT (구현 계획)
2. **prdSpec** - 콘텐츠 텍스트 (headline, descriptions, labels)
3. **designDoc** - Spec 참조 (필요시)
4. **uiDoc** - UI Spec 참조 (필요시)
5. **directive** - Context only

**역할**:
- ✅ planText가 구현 SSOT
- ✅ prdSpec에서 실제 콘텐츠 텍스트 추출
- ✅ planText에 N개 assets → N개 모두 복사
- ✅ planText에 명시된 layout → 정확히 구현
- ❌ 문서를 직접 해석하지 않음 (Plan이 이미 했음)

---

## 📊 문서 간 보완 관계

### UI 태스크의 경우

```
Decompose:
  Input: directive + design
  Output: "Implement landing page based on design specs"
  Role: 방향만 제시
  
Plan:
  Input: task + directive + design + uiDoc + uiAssets
  Priority: uiDoc (SSOT) > uiAssets (Asset map) > design (context)
  Output: Asset Inventory (15 assets) + Layout Specs + Implementation Plan
  Role: 문서 조회 → 완전 계획
  
Execute:
  Input: planText + design + uiDoc + uiAssets
  Priority: planText (SSOT) > design/uiDoc (참고만)
  Output: 실제 코드 (15 assets 모두 복사 & 참조)
  Role: Plan 충실히 따름
```

### API 태스크의 경우

```
Decompose:
  Input: directive + design
  Output: "Implement User API endpoints"
  Role: 방향만 제시
  
Plan:
  Input: task + directive + design + projectCodeContext
  Priority: design (API Contract SSOT) > projectCodeContext (통합)
  Output: Exact endpoints + Request/Response types + Integration plan
  Role: design의 API Contract 정확히 추출
  
Execute:
  Input: planText + design + projectCodeContext
  Priority: planText (SSOT) > design (Spec 참조)
  Output: 실제 API 코드
  Role: Plan의 API Contract 정확히 구현
```

---

## 🔥 우선순위 규칙

### Rule 1: 단계별 SSOT

| 단계 | SSOT | 보조 (콘텐츠/컨텍스트) |
|------|------|------------------------|
| **Detect** | directive | prdSpec, designDocs |
| **Decompose** | designDoc (design) | spec (directive) |
| **Plan** (UI) | uiDoc + uiAssets | designDoc, prdSpec (콘텐츠), directive |
| **Plan** (API) | designDoc (API Contract) | prdSpec (콘텐츠), directive |
| **Execute** | planText | prdSpec (콘텐츠), designDoc, uiDoc |

### Rule 2: 문서 충돌 시

```
Priority: planText > prdSpec (content) > designDoc > uiDoc > directive

이유:
- planText: 이미 모든 문서를 분석하고 통합함 (구현 계획)
- prdSpec: 실제 콘텐츠 텍스트 (headlines, descriptions, button labels)
- designDoc: 기술적 SSOT (architecture, API)
- uiDoc: UI SSOT (UI 태스크만)
- directive: Ground truth (facts only, not specs)
```

### Rule 3: UI vs Non-UI

**UI 태스크**:
```
Primary: uiDoc (ui-spec.md) - Layout, components, interactions
Asset Map: uiAssets (ui-assets.md) - Asset 복사 지침
Content: prdSpec (prd.md) - 실제 텍스트 (headlines, descriptions)
Context: designDoc (architecture)
```

**Non-UI 태스크**:
```
Primary: designDoc (system-design) - API, architecture
Content: prdSpec (prd.md) - 실제 텍스트, 비즈니스 로직
Context: directive
```

---

## ❌ 현재 문제점 → ✅ 실제 상황

### ~~1. PRD 문서가 사용 안 됨~~ → ✅ 실제로 사용됨!
- **실제 상황**: Execute 단계에서 `prdSpec`으로 injection
- **용도**: 
  - **콘텐츠 텍스트** (headlines, descriptions, button labels)
  - 비즈니스 요구사항
  - Design 문서에 없는 세부 텍스트
- **injection 위치**: 
  ```typescript
  // codeGen/promptBuilder.ts Line 129
  state.prd ? `# Requirements\n\n${state.prd}` : null
  ```

**결론**: PRD는 **콘텐츠 소스**로 중요한 역할 수행 중! ✅

### 2. directive vs design의 역할 혼재
- **현상**: Decompose에서 `spec={{directive}}` 사용하지만, `designDoc`도 받음
- **혼란**: 어느 것이 primary spec인가?

**현재 해결책**:
```markdown
Decompose prompt:
"ARCHITECTURE DECISIONS ARE IN THE SPEC"
→ designDoc이 primary, directive는 high-level goal
```

**더 나은 해결책**:
- Decompose 프롬프트에 우선순위 명시
- `designDoc = PRIMARY spec (what to build + how)`
- `directive = User's original request (context)`

### 3. uiDoc injection 조건 불명확
- **현상**: UI 태스크 판단이 `task.ui` flag에 의존
- **문제**: Decompose가 flag를 잘못 설정하면 uiDoc 누락

**현재 검증**:
```typescript
// validation.ts
for (const t of tasks) {
  if (typeof (t as any).ui !== 'boolean') {
    throw new Error(`Task ${t.id} missing ui flag`);
  }
}
```

**좋은 점**: Flag 필수화로 deterministic
**개선 가능**: Decompose 프롬프트에 UI flag 가이드라인 강화 (이미 함)

---

## ✅ 리팩토링 필요 여부

### 현재 구조는 전반적으로 **잘 설계됨**

**장점**:
1. ✅ 문서 흐름 명확 (Design Job → Code Job)
2. ✅ 단계별 SSOT 정의됨
3. ✅ UI/Non-UI 태스크 분리 injection
4. ✅ Plan이 문서 통합 역할 수행
5. ✅ **PRD가 콘텐츠 소스로 Execute에서 사용됨**

**개선 필요**:
1. ⚠️ **Decompose 프롬프트 우선순위 명시** (designDoc > directive)
2. ⚠️ **문서 우선순위를 프롬프트에 명시**
3. ✅ **Plan 프롬프트 강화** (이미 완료)

---

## 🎯 권장 개선 사항

### 1. Decompose 프롬프트에 우선순위 명시

**현재**:
```markdown
SPECIFICATION:
{{spec}}

{{#if designDoc}}
DESIGN SPECIFICATION AVAILABLE
{{designDoc}}
{{/if}}
```

**개선**:
```markdown
SPECIFICATIONS:

## Primary Spec: Design Document
{{designDoc}}

## User Directive (High-level Goal)
{{directive}}

**Priority: Design Document is the PRIMARY spec (what + how)**
**Directive is the original request (context)**
```

### 2. ~~PRD 역할 명확화~~ → ✅ 이미 명확함

PRD는 **콘텐츠 소스**로 Execute 단계에서 사용 중:
- Headlines, descriptions, button labels
- 비즈니스 요구사항 텍스트
- Design 문서가 커버하지 못하는 세부 텍스트

**현재 injection**:
```typescript
// codeGen/promptBuilder.ts
state.prd ? `# Requirements\n\n${state.prd}` : null
```

**개선**: 프롬프트에 PRD 용도 명시
```markdown
{{#if prdSpec}}
## Requirements (PRD - Content Source)
{{prdSpec}}

**Use this for**: Actual content text (headlines, descriptions, labels)
**Not for**: Technical architecture (that's in Design Doc)
{{/if}}
```

### 3. Execute 프롬프트에 문서 역할 명시

**추가** (Execute base.md 또는 injection에):
```markdown
## Document Roles in Implementation

**PRIMARY**: Implementation Plan (planText)
- Your complete implementation guide
- Already analyzed all documents below

**CONTENT**: Requirements (PRD)
- Actual text content: headlines, descriptions, button labels
- Business requirements text
- Use for: Copy-paste ready content

**REFERENCE**: Design Specification (designDoc)
- Technical architecture, API contracts
- Use when: Plan unclear or need API details

**REFERENCE**: UI Specification (uiDoc)
- UI layout, components, interactions
- Use when: Plan unclear or need UI details

**Rule**: Follow plan first. Use other docs only for content/clarification.
```

---

## 📚 요약

### 문서 역할
- **directive**: 사용자 원본 지시 (ground truth)
- **prd**: ✅ **콘텐츠 소스** (headlines, descriptions, labels) + 비기술 요구사항
- **design**: 기술 설계 (Code Job PRIMARY spec)
- **uiDoc**: UI 상세 specs (UI 태스크 SSOT)
- **uiAssets**: Asset 매핑 (Asset 복사 지침)

### 단계별 SSOT
- **Decompose**: designDoc (+ directive context)
- **Plan (UI)**: uiDoc + uiAssets (+ prdSpec content)
- **Plan (API)**: designDoc (API Contract) (+ prdSpec content)
- **Execute**: planText (+ prdSpec content source)

### 보완 관계
```
directive (원본) → prd (콘텐츠) → design (기술 설계) → uiDoc (UI 상세)
                                                       ↓
                                   Plan (통합 & 상세화)
                                                       ↓
                    Execute (구현 + prd에서 콘텐츠 추출)
```

### 핵심 원칙
1. **각 단계마다 명확한 SSOT 존재**
2. **Plan이 모든 문서 통합 역할**
3. **Execute는 Plan + PRD(콘텐츠) 사용**
4. **UI/Non-UI 태스크별 다른 문서 우선순위**
5. **PRD는 콘텐츠 소스 (중요!)** ✅

---

**최종 결론**: 현재 구조는 잘 설계되었고, **PRD는 콘텐츠 소스로 중요한 역할 수행 중**입니다. 프롬프트에 문서 역할만 명시하면 완벽합니다.
