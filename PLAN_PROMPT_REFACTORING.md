# Plan 프롬프트 리팩토링 - UI 태스크 체크리스트 강화

## 📋 변경 요약

### 목표
UI 태스크 Plan 단계에서 **구조화된 체크리스트**를 강제하여, ui-spec.md와 ui-assets.md의 모든 내용이 planText에 반영되도록 보장

### 근본 원인
- **문제**: Plan 단계에서 "Assets needed" 선언이 optional로 작동
- **결과**: Token hero image, Technology 배경 이미지 등이 planText에서 누락
- **영향**: Execute 단계에서 plan에 없는 요소를 구현하지 않음

## 🔧 변경 내용

### 1. Plan 단계 프롬프트 강화 (`code/phases/plan/base.md`)

#### Before (Line 211-238)
```markdown
### 🔍 ASSET DISCOVERY PRINCIPLE

**Before planning UI implementation:**
1. Identify the visual elements
2. Search the asset mapping table
3. If asset exists → Plan to copy

### ⚠️ MANDATORY DECLARATION
Your plan MUST state:
- "Assets needed: [list] → [copy plan]"
- "No assets needed"
```

**문제점**: 
- ✗ "MANDATORY"라고 했지만 구조화 안 됨
- ✗ LLM이 섹션 생략 가능
- ✗ 검증 메커니즘 없음

#### After (새로운 구조)
```markdown
### 📋 UI IMPLEMENTATION CHECKLIST (MANDATORY)

Your plan MUST follow this EXACT structure:

## 1. SECTION IDENTIFICATION
- Section name from ui-spec.md
- UI spec reference (line numbers)

## 2. ASSET INVENTORY (FROM ui-assets.md)
**Asset Checklist:**
```
Section: [Name]
Images/Backgrounds: [ ] asset-id: source → destination
Icons: [ ] asset-id: source → destination
Total: N files
```
**Copy Commands:** (EXACT cp commands)

## 3. LAYOUT & STRUCTURE (FROM ui-spec.md)
- Layout type
- Container specs
- Responsive breakpoints
- Visual hierarchy

## 4. COMPONENT SPECIFICATIONS (FROM ui-spec.md)
For EACH component:
- Visual properties
- Typography
- Spacing
- Interactive states
- Asset references

## 5. DESIGN TOKEN REFERENCES (FROM ui-tokens.md via ui-spec.md)
- Colors: token(...) → actual values
- Typography: token(...) → actual values
- Spacing: token(...) → actual values

## 6. IMPLEMENTATION STEPS
Step-by-step with file list

### 🚨 VALIDATION CHECKLIST
- [ ] All 6 sections completed
- [ ] Asset count verified
```

**개선 사항**:
- ✅ 6개 섹션 구조 강제
- ✅ 각 섹션마다 구체적인 요구사항
- ✅ 체크리스트로 검증 가능
- ✅ Asset 개수 명시 요구

### 2. Execute 단계 UI Doc Injection 강화 (`common/injections/ui-doc.md`)

#### Before
```markdown
### 🔍 ASSET DISCOVERY PRINCIPLE (CRITICAL!)
1. Identify what you're building
2. Search the mapping table
3. If asset exists → USE IT
```

**문제점**:
- ✗ Plan이 불완전해도 Execute가 재탐색해야 함
- ✗ Plan과 Execute 간 불일치 가능

#### After
```markdown
### 🚨 IMPLEMENTATION MANDATE

**You received a structured plan with UI Implementation Checklist.**

Your implementation MUST:
1. ✅ Copy EVERY asset listed in "Asset Inventory"
2. ✅ Implement EXACT layout from "Layout & Structure"
3. ✅ Apply ALL specs from "Component Specifications"
4. ✅ Use EXACT tokens from "Design Token References"

CRITICAL RULES:
- If plan says "copy 8 assets" → You MUST copy all 8
- If plan says "3-column → 5-column" → Implement exactly
- Asset count in plan = Asset count in code
```

**개선 사항**:
- ✅ Plan을 SSOT로 명시
- ✅ Plan의 각 섹션을 Execute가 따라야 함을 명확화
- ✅ 개수 검증 강조

### 3. Output Format 분기 (`code/phases/plan/base.md`)

```markdown
### Output Format:

{{#if hasUiDoc}}
**FOR UI TASKS: Follow the 6-section checklist**
Output MUST include all sections 1-6

{{else}}
**FOR NON-UI TASKS: 5-10 bullet points**
- WHAT, HOW, WHICH specs
{{/if}}
```

**개선 사항**:
- ✅ UI/Non-UI 태스크 출력 형식 명확히 분리
- ✅ UI 태스크는 반드시 6-section 구조

## 📊 체크리스트 작동 원리

### Plan 단계 (LLM에게 요구)
```
Task: "Implement Token Section with Static Cards"

LLM이 생성해야 하는 Plan:
───────────────────────────────────────
## 1. SECTION IDENTIFICATION
Section: Token Section (ui-spec.md §450-605)

## 2. ASSET INVENTORY
From ui-assets.md Asset Dependency Map:
Images:
- [x] bg.token.hero: inputs/assets/bg/token-hero-image.png 
      → codebase/public/assets/images/token-hero-image.png
Icons:
- [x] icon.token.gas: inputs/assets/icons/icon-gas.svg
      → codebase/public/assets/icons/icon-gas.svg
- [x] icon.token.player: ...
[... 7개 아이콘 모두 나열]
Total: 8 assets

Copy Commands:
cp inputs/assets/bg/token-hero-image.png codebase/public/assets/images/
cp inputs/assets/icons/icon-*.svg codebase/public/assets/icons/

## 3. LAYOUT & STRUCTURE
- Section header (title + description)
- Token hero image: 400px max-width, center, 64px margin-bottom
- 7-card grid: 2 cols (mobile) → 3 cols (tablet) → 5 cols (desktop)
- Cards: 1:1 aspect ratio, 24px gap

## 4. COMPONENT SPECIFICATIONS
Component: Token Card
- Visual: Semi-transparent bg, 16px radius, 24px padding, 1:1 aspect
- Typography: 16px base, semibold, primary color
- Assets: Each card uses one icon (48x48px, teal color)
- States: Non-interactive

## 5. DESIGN TOKEN REFERENCES
- Background: token(color.bg.base) → #ffffff
- Card bg: token(color.bg.card.default) → rgba(255,255,255,0.1)
- Icon color: token(color.accent.teal) → #00ffa3

## 6. IMPLEMENTATION STEPS
1. Copy 8 assets (1 hero + 7 icons) using commands above
2. Create Token.tsx component
3. Implement section header (h2 + description)
4. Add token hero image (<Image src="/assets/images/token-hero-image.png" />)
5. Implement 7-card grid with responsive breakpoints
6. Apply design tokens for styling
───────────────────────────────────────
```

### Execute 단계 (LLM이 Plan을 받아서)
```
planText에서:
- Section 2: 8 assets 나열됨 → 8개 모두 복사 & 코드에서 참조
- Section 3: hero image 명시됨 → <Image> 컴포넌트로 렌더링
- Section 3: 2→3→5 columns → grid-cols-2 md:grid-cols-3 lg:grid-cols-5
- Section 4: 카드 specs → 정확히 구현
- Section 5: 토큰 참조 → Tailwind 클래스로 변환
```

## 🎯 기대 효과

### Before (기존)
```
Plan: "Implement Token Section with cards"
→ LLM이 자의적으로 해석
→ hero image 누락, 일부 아이콘만 사용
```

### After (개선)
```
Plan: 
  "Section 2: 8 assets (1 hero + 7 icons) [full list]"
  "Section 3: hero image + card grid layout"
  "Section 4: card specs [detailed]"
→ LLM이 Plan을 따름
→ 모든 요소 구현
```

## 🔍 검증 방법

### 1. Plan 단계 출력 확인
```bash
# Plan 로그에서 확인할 것
✅ "## 1. SECTION IDENTIFICATION" 존재
✅ "## 2. ASSET INVENTORY" 존재
✅ "Total: N assets" 존재
✅ "cp inputs/assets/..." 명령어 존재
✅ "## 3. LAYOUT & STRUCTURE" 존재
✅ "## 4. COMPONENT SPECIFICATIONS" 존재
✅ "## 5. DESIGN TOKEN REFERENCES" 존재
✅ "## 6. IMPLEMENTATION STEPS" 존재
```

### 2. Execute 단계 결과 확인
```bash
# 생성된 코드에서 확인할 것
✅ public/assets/ 하위에 Plan의 모든 asset 존재
✅ 코드에서 Plan의 모든 asset 참조
✅ 레이아웃이 Plan의 "Layout & Structure"와 일치
✅ 컴포넌트가 Plan의 "Component Specifications"와 일치
```

## 📝 테스트 시나리오

### Test Case 1: Token Section (hero image 누락 방지)
```
Task: "Implement Token Section with Static Cards"

Expected Plan Output:
- Section 2: token-hero-image.png 명시
- Section 3: "hero image below description" 명시
- Section 6: "Add hero image" step 명시

Expected Execute Output:
- public/assets/images/token-hero-image.png 파일 존재
- Token.tsx에서 <Image src="/assets/images/token-hero-image.png" /> 존재
```

### Test Case 2: Technology Section (배경 이미지 누락 방지)
```
Task: "Implement Technology Section with External Links"

Expected Plan Output:
- Section 2: bg-technology-1/2/3.png 명시 (3개)
- Section 4: "card background image" 명시
- Section 6: "Copy 3 background images" step 명시

Expected Execute Output:
- public/assets/images/bg-technology-*.png 파일 3개 존재
- Technology.tsx에서 각 카드가 배경 이미지 사용
```

### Test Case 3: Ecosystem Section (정상 케이스)
```
Task: "Implement Ecosystem Section with Interactive Cards"

Expected Plan Output:
- Section 2: 6 assets (3 backgrounds + 3 typo logos) 명시
- Section 3: 3-column grid, hover interaction 명시
- Section 4: hover state specs 명시

Expected Execute Output:
- 6개 asset 모두 복사 & 참조
- 3-column grid 구현
- Hover interaction 구현
```

## 🚨 Breaking Changes

### 없음
- 기존 non-UI 태스크는 영향 없음 (기존 bullet-point 형식 유지)
- UI 태스크만 6-section 구조 요구

### Migration
- 새로운 코드잡부터 자동 적용
- 기존 incomplete plan은 자연스럽게 개선됨 (LLM이 새 프롬프트를 받음)

## 📚 참고 문서

- Plan 프롬프트: `packages/ant-cli/src/core/prompt/templates/code/phases/plan/base.md`
- UI Doc Injection: `packages/ant-cli/src/core/prompt/templates/common/injections/ui-doc.md`
- 관련 이슈: ant-ogf/uidoc-test 코드잡 결과 분석

## ✅ 체크리스트

- [x] Plan 프롬프트에 6-section UI 체크리스트 추가
- [x] Execute UI Doc에 Plan 준수 mandate 추가
- [x] Output Format UI/non-UI 분기 추가
- [x] 문서화 완료
- [ ] 실제 코드잡 테스트 (ant-ogf/uidoc-test 재실행)
- [ ] 결과 검증 및 필요시 추가 튜닝

---

## 원칙 재확인

**Decompose → Plan → Execute 역할**:
- **Decompose**: 챕터 제목만 ("Token Section 구현")
- **Plan**: UI 문서를 제대로 읽고 구체적 계획 수립 (6-section 체크리스트)
- **Execute**: planText를 충실히 따라 구현

**핵심**: Plan이 SSOT가 되어야 하며, Plan이 완전해야 Execute도 완전함
