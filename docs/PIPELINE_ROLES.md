# Code Job Pipeline 역할 정의

## 📋 개요

Code Job은 3단계로 구성: **Decompose → Plan → Execute**

각 단계는 명확한 역할 분리를 통해 보완적으로 작동합니다.

---

## 🎯 각 단계의 역할

### 1️⃣ Decompose (태스크 분해)

**역할**: 큰 방향 제시

**입력**:
- User directive (원본 요청)
- Specification (디자인 문서, API 계약 등)
- Existing codebase (있는 경우)

**출력**:
```json
{
  "id": "landing-page",
  "name": "Implement Landing Page",
  "description": "<ui> Implement landing page based on design specifications",
  "ui": true,
  "priority": 210
}
```

**핵심 원칙**:
- ✅ **방향만 제시**: "어떤 영역을 작업할지" (landing page, header, API 등)
- ✅ **범용적**: 언어/플랫폼 중립적
- ❌ **세부사항 금지**: 구체적 컴포넌트/에셋 개수 명시 금지

**UI 태스크 Description 가이드라인**:
```
❌ BAD: "Create landing page with hero section, 3 feature cards, and footer"
✅ GOOD: "Implement landing page based on design specifications"

Why: "3 cards"를 명시하면 Plan이 문서에서 "5 cards"를 발견해도 놓칠 수 있음
```

**Template**:
```
"<ui> Implement [section/component name] based on design specifications"
```

---

### 2️⃣ Plan (구현 계획)

**역할**: 문서 기반 완전 계획

**입력**:
- Task description (방향)
- Original directive (ground truth)
- Design documents (ui-spec.md, ui-assets.md, ui-tokens.md)
- API Contract (있는 경우)
- Existing codebase (있는 경우)

**출력** (UI 태스크):
```markdown
#### 1. ASSET INVENTORY
- bg-hero.png: inputs/assets/bg-hero.png → codebase/public/assets/bg-hero.png
- icon-1.svg, icon-2.svg, ..., icon-15.svg
Total: 16 assets
cp commands...

#### 2. LAYOUT & COMPONENT SPECS
- Hero: full-width, bg image, centered text, 2 CTA buttons
- Features: 3-column grid (mobile: 1, tablet: 2, desktop: 3)
  - Each card: icon (64x64), title, description
- Footer: 4-column links, social icons (5개), copyright

#### 3. IMPLEMENTATION PLAN
1. Copy 16 assets
2. Create Hero.tsx, Features.tsx, Footer.tsx
3. Implement responsive layouts (breakpoints: 768px, 1024px)
4. Apply design tokens (colors, typography, spacing)
```

**핵심 원칙**:
```markdown
🚨 CRITICAL PRINCIPLE: Task Description is INCOMPLETE by Design

Task = GUIDE (starting point)
Documents = COMPLETE SPEC (SSOT)

Your responsibility:
1. Use task as starting point
2. Read ALL documents
3. Extract complete requirements
4. Plan EVERYTHING found in documents

Rule: If document mentions it → MUST include it
```

**작동 방식**:
1. Task description 읽기: "landing page 구현" ← 방향만 파악
2. ui-spec.md 읽기: Hero + Features (3 cards) + Footer 발견
3. ui-assets.md 읽기: 16개 에셋 발견
4. Plan에 모든 것 포함: Hero + 3 cards + Footer + 16 assets

**범용성**: 
- ✅ 프로젝트 중립적 (ant-ogf 특화 예시 없음)
- ✅ 원칙 기반 (구체적 숫자/이름 하드코딩 없음)

---

### 3️⃣ Execute (구현)

**역할**: Plan 충실히 따름

**입력**:
- Plan (완전한 구현 계획)
- Design documents (참고용)
- Existing codebase

**출력**:
- 실제 구현 코드
- 에셋 복사 (Plan의 Asset Inventory 기준)

**핵심 원칙**:
```markdown
### 🚨 FOLLOW THE PLAN

Your plan contains Asset Inventory and Layout/Component Specs.

Implementation rules:
1. Copy EVERY asset listed in plan
2. Implement layout EXACTLY as specified
3. Apply component specs from plan

CRITICAL:
- If plan lists N assets → MUST copy and reference all N
- Plan is your source of truth
```

**작동 방식**:
1. Plan의 Asset Inventory 읽기: 16 assets 나열
2. 16개 모두 복사: `cp inputs/assets/* codebase/public/assets/`
3. Plan의 Layout Specs 읽기: Hero + 3 cards + Footer
4. 모든 컴포넌트 구현
5. Plan의 16개 에셋 모두 참조

**범용성**:
- ✅ Plan에만 의존 (프로젝트 무관)
- ✅ 간결함 (핵심 원칙만)

---

## 🔄 전체 흐름 예시

### Scenario: Landing Page 구현

#### 1. Decompose
```json
{
  "id": "landing-page",
  "description": "<ui> Implement landing page based on design specifications"
}
```
- ✅ 방향만: "landing page 구현"
- ✅ 세부사항 없음

#### 2. Plan
```markdown
Task: "Implement landing page based on design specifications"
↓
Read ui-spec.md:
  - Hero section: full-width, background image
  - Features section: 3 cards in grid
  - Footer section: 4-column links, 5 social icons
↓
Read ui-assets.md:
  - bg-hero.png (Hero 배경)
  - icon-feature-1.svg, icon-feature-2.svg, icon-feature-3.svg (Features 카드)
  - logo-twitter.svg, logo-facebook.svg, ... (Footer 소셜 아이콘 5개)
  - Total: 9 assets
↓
Plan output:
  1. ASSET INVENTORY: 9 assets with cp commands
  2. LAYOUT & SPECS: Hero + Features (3 cards) + Footer (5 icons)
  3. IMPLEMENTATION PLAN: step-by-step
```

#### 3. Execute
```markdown
Read Plan:
  - Asset Inventory: 9 assets
  - Layout Specs: Hero + 3 cards + Footer + 5 icons
↓
Implementation:
  1. cp 9 assets
  2. Create Hero.tsx (with bg-hero.png)
  3. Create Features.tsx (3 cards with icons)
  4. Create Footer.tsx (5 social icons)
  5. Reference all 9 assets in code
```

---

## ✅ 역할 분리의 장점

### 1. Decompose가 세부사항 없어도 OK
- Task description: "landing page 구현"
- Plan이 알아서 문서 조회 → 모든 세부사항 추출

### 2. Plan이 완전한 계획 수립
- 문서의 모든 내용 포함 (에셋, 레이아웃, 컴포넌트)
- Task에 없어도 문서에 있으면 포함

### 3. Execute가 Plan만 따르면 됨
- Plan이 완전하면 Execute도 완전
- Plan과 Execute 간 불일치 없음

---

## 🚨 안티패턴 (과거 문제)

### ❌ Decompose가 너무 구체적
```json
{
  "description": "Create landing page with hero section, 3 feature cards, and footer"
}
```
**문제**: Plan이 이걸 보고 문서 조회 안 하고 3 cards만 구현

### ❌ Plan이 Task description만 따름
```markdown
Task: "3 feature cards"
Plan: 3 cards만 계획
문서: 실제로는 5 cards 명시

→ 2 cards 누락!
```

### ❌ Execute가 Plan 무시
```markdown
Plan: 9 assets 나열
Execute: 일부만 복사 (TODO 주석 남김)

→ 에셋 누락!
```

---

## ✅ 현재 해결책

### 1. Decompose: 방향만
```json
"<ui> Implement landing page based on design specifications"
```

### 2. Plan: 문서 기반 완전 계획
```markdown
🚨 Task is INCOMPLETE by Design
→ Read ALL documents
→ Extract complete requirements
→ Plan EVERYTHING
```

### 3. Execute: Plan 충실히 따름
```markdown
🚨 FOLLOW THE PLAN
→ Plan lists N assets → Copy all N
→ Plan is your SSOT
```

---

## 📊 검증 체크리스트

### Decompose 출력 확인
- [ ] Task description이 방향만 제시 ("Implement X based on design specs")
- [ ] 구체적 컴포넌트/에셋 개수 없음
- [ ] `<ui>` prefix 사용 (UI 태스크)

### Plan 출력 확인
- [ ] ASSET INVENTORY 섹션 존재
- [ ] ui-assets.md의 모든 에셋 나열
- [ ] LAYOUT & COMPONENT SPECS 섹션 존재
- [ ] ui-spec.md의 모든 컴포넌트 명시
- [ ] IMPLEMENTATION PLAN 섹션 존재

### Execute 결과 확인
- [ ] Plan의 모든 에셋 복사됨 (`codebase/public/assets/` 확인)
- [ ] 코드에서 Plan의 모든 에셋 참조
- [ ] Plan의 모든 컴포넌트 구현
- [ ] TODO 주석 없음

---

## 🎯 핵심 원칙 요약

| 단계 | 역할 | 입력 | 출력 | 핵심 원칙 |
|------|------|------|------|-----------|
| **Decompose** | 방향 제시 | Spec, Directive | Task list (방향만) | 세부사항 명시 금지 |
| **Plan** | 완전 계획 | Task, Docs | 3-section plan (완전) | 문서 = SSOT |
| **Execute** | Plan 따름 | Plan, Docs | 구현 코드 | Plan = SSOT |

---

## 📚 관련 문서

- `code/phases/decompose/rules.md` - Decompose 가이드라인
- `code/phases/plan/base.md` - Plan 원칙 및 구조
- `code/phases/execute/base.md` - Execute 원칙
- `common/injections/ui-doc.md` - UI 문서 injection (Execute용)

---

**최종 업데이트**: 2026-01-10
**변경 이력**:
- 2026-01-10: Decompose UI task description 가이드라인 추가
- 2026-01-10: Plan "Task is INCOMPLETE by Design" 원칙 강화
- 2026-01-10: Execute "FOLLOW THE PLAN" 원칙 명확화
