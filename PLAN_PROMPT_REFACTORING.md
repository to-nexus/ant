# Plan 프롬프트 리팩토링 - UI 태스크 Asset Inventory 강제

## 📋 변경 요약

### 목표
UI 태스크 Plan 단계에서 **Asset Inventory를 강제**하여, ui-assets.md의 모든 asset이 planText에 반영되도록 보장

### 근본 원인
- **문제**: Plan 단계에서 asset 조회가 optional로 작동
- **결과**: Token hero image, Technology 배경 이미지 등이 planText에서 누락
- **영향**: Execute 단계에서 plan에 없는 요소를 구현하지 않음

## 🔧 변경 내용

### Plan 단계 3-Section 구조 강제 (`code/phases/plan/base.md`)

#### Before
```markdown
### 🔍 ASSET DISCOVERY PRINCIPLE
Before planning: identify elements, search mapping table, plan to copy

### ⚠️ MANDATORY DECLARATION
Your plan MUST state: "Assets needed" or "No assets needed"
```

**문제점**:
- "MANDATORY"지만 구조화 안 됨
- LLM이 섹션 생략 가능
- 검증 불가

#### After
```markdown
🚨 CRITICAL: Complete ALL sections below

### 1. ASSET INVENTORY (MANDATORY)
Search ui-assets.md for this section/component.
List ALL assets:
```
Assets for [section]:
- asset-id: source → destination
Total: N assets
Copy commands: cp source dest
```

### 2. LAYOUT & COMPONENT SPECS (FROM ui-spec.md)
Extract specifications:
- Layout structure (grid/flex, responsive)
- Component properties (visual, typography, states)
- Design token references

### 3. IMPLEMENTATION PLAN
Step-by-step implementation
```

**개선 사항**:
- ✅ 3개 섹션 구조 명시
- ✅ Asset inventory 필수화
- ✅ 범용적 (프로젝트 무관)
- ✅ 간결함 (핵심만)

### Execute 단계 간소화 (`common/injections/ui-doc.md`)

#### Before
```markdown
### 🔍 ASSET DISCOVERY PRINCIPLE
1. Identify what you're building
2. Search mapping table
3. If exists → USE IT
(많은 예시와 설명...)
```

#### After
```markdown
### 🚨 FOLLOW THE PLAN
Your plan contains Asset Inventory and Layout/Component Specs.

Implementation rules:
1. Copy EVERY asset listed in plan
2. Implement layout EXACTLY as specified
3. Apply component specs from plan
4. Use design tokens from plan

CRITICAL: If plan lists N assets → Code must use N assets

The plan is your source of truth. Follow it completely.
```

**개선 사항**:
- ✅ "Plan을 따르라" 원칙만 강조
- ✅ 불필요한 예시 제거
- ✅ 핵심 원칙만 유지

## 📊 작동 원리

### Plan 단계 (LLM 출력 예상)
```
Task: "Implement Token Section"

## 1. ASSET INVENTORY
Assets for Token Section:
- bg.token.hero: inputs/assets/bg/token-hero-image.png → codebase/public/assets/images/token-hero-image.png
- icon.token.gas: inputs/assets/icons/icon-gas.svg → codebase/public/assets/icons/icon-gas.svg
[... 더 많은 아이콘들]
Total: 8 assets

Copy commands:
cp inputs/assets/bg/token-hero-image.png codebase/public/assets/images/
cp inputs/assets/icons/*.svg codebase/public/assets/icons/

## 2. LAYOUT & COMPONENT SPECS
Layout: Section header + hero image (400px, centered) + 7-card grid (2→3→5 cols)
Components: Cards with icons, semi-transparent bg, 16px radius
Tokens: token(color.bg.card.default), token(color.accent.teal)

## 3. IMPLEMENTATION PLAN
1. Copy 8 assets
2. Create Token.tsx
3. Implement header, hero image, card grid
4. Apply responsive breakpoints
```

### Execute 단계
```
planText를 받아서:
- Section 1: 8 assets 명시 → 8개 모두 복사 & 참조
- Section 2: hero image + grid 명시 → 정확히 구현
- Section 2: responsive breakpoints → md:, lg: 적용
```

## 🎯 핵심 원칙

1. **구조만 강제, 내용은 LLM이 채움**
   - ❌ 구체적 예시 하드코딩 (ant-ogf 특화)
   - ✅ 범용적 구조 제시 (모든 프로젝트)

2. **Plan = SSOT**
   - Plan이 완전하면 Execute도 완전
   - Execute는 Plan을 따름

3. **간결성**
   - 불필요한 설명 제거
   - 핵심 원칙만 유지

## 🔍 검증 방법

### Plan 출력 확인
```bash
✅ "## 1. ASSET INVENTORY" 섹션 존재
✅ "Total: N assets" 명시
✅ "cp ..." 명령어 존재
✅ "## 2. LAYOUT & COMPONENT SPECS" 섹션 존재
✅ "## 3. IMPLEMENTATION PLAN" 섹션 존재
```

### Execute 결과 확인
```bash
✅ public/assets/ 하위에 Plan의 모든 asset 존재
✅ 코드에서 Plan의 모든 asset 참조
✅ 레이아웃이 Plan의 specs와 일치
```

## 🚨 Breaking Changes

**없음** - 기존 동작과 호환

## 📚 변경된 파일

- `code/phases/plan/base.md` - 3-section 구조 강제
- `common/injections/ui-doc.md` - "Follow the plan" 원칙

## ✅ 체크리스트

- [x] Plan 프롬프트 간소화 (범용성 확보)
- [x] Execute 프롬프트 간소화 (핵심만)
- [x] 구체적 예시 제거
- [x] 문서화 업데이트
- [ ] 실제 코드잡 테스트 (ant-ogf/uidoc-test)
- [ ] 결과 검증

---

## 설계 철학

**Bad**: 구체적 예시로 가이드 → 다른 프로젝트 적용 불가
**Good**: 구조로 강제 + LLM이 내용 채움 → 범용적

**Before**: "Token Section은 hero image + 7 cards..."
**After**: "Asset Inventory 섹션 필수, ui-assets.md 조회"

