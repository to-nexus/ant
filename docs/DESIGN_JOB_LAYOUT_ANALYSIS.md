# Design Job 레이아웃 해석 실패 분석

**프로젝트**: ant-ogf/uidoc-test  
**문제**: Technology 섹션 레이아웃 방향 오해석  
**분석일**: 2026-01-10  

---

## 📊 문제 요약

### 실제 디자인 (Reference 이미지)
- **Technology 카드**: 세로 배열 (1열, 좌/우 번갈아 배치 - zigzag 레이아웃)
- 3장의 카드가 수직으로 쌓여 있음

### Design Job 출력 (ui-spec.md)
```markdown
Line 611: **Section header** + **3-column card grid**

Layout:
│  ┌────────┐  ┌────────┐  ┌────────┐ │
│  │ Card 1 │  │ Card 2 │  │ Card 3 │ │
```
→ **가로 3열 그리드로 명시**

### Code Job 결과
- ui-spec.md를 충실히 따름
- `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` 구현
- **가로 3열 레이아웃** (사용자 기대와 불일치)

---

## 🔍 근본 원인

### Design Job이 Reference 이미지를 잘못 해석

**가설 1: "3개 = 3열" 자동 추론**
```
관찰: Technology 카드 3개
추론 (잘못): 3-column grid
실제: 1-column vertical layout (zigzag)
```

**증거**:
- Ecosystem: 3개 → 3열 그리드 ✅ (정확)
- Token: 7개 → 7장 그리드 ✅ (정확)
- **Technology: 3개 → 3열 그리드 ❌ (오류)**

→ **"n개 = n열" 패턴 매칭 편향**

---

## 📋 Reference 이미지 실제 레이아웃

### Technology 섹션 시각적 구조
```
┌─────────────────────────────────────┐
│   Technology Behind the CROSS       │
│          Platform                   │
│                                     │
│     Section description text        │
│                                     │
│  ┌──────────────────────┐           │  ← Card 1 (좌측 정렬)
│  │   CROSS Mainnet      │           │
│  │   [Description]      │           │
│  │   [Learn more]       │           │
│  └──────────────────────┘           │
│                                     │
│           ┌──────────────────────┐  │  ← Card 2 (우측 정렬)
│           │   CROSS Protocol     │  │
│           │   [Description]      │  │
│           │   [Learn more]       │  │
│           └──────────────────────┘  │
│                                     │
│  ┌──────────────────────┐           │  ← Card 3 (좌측 정렬)
│  │   CROSS Dev Guide    │           │
│  │   [Description]      │           │
│  │   [Learn more]       │           │
│  └──────────────────────┘           │
│                                     │
└─────────────────────────────────────┘
```

**특징**:
- ✅ 세로 배열 (1열)
- ✅ Zigzag 레이아웃 (좌/우 번갈아)
- ✅ 각 카드는 전체 폭의 약 50-60%
- ✅ 수직 간격으로 명확히 분리됨

---

## 🎯 Design Job 프롬프트 분석

### 현재 프롬프트 (`ui-spec-guide.md`)

#### ✅ 존재하는 가이드라인
1. **Grid Layout Documentation** (Line 127-161)
   ```markdown
   Analyze the design intent:
   - Indicators of uniform grids
   - Indicators of non-uniform grids
   - Critical Check for Asymmetry
   ```

2. **Layout Structure Analysis** (Line 32-41)
   ```markdown
   Identify Visual Layers:
   - Are there distinct horizontal bands of content?
   - Does content flow sequentially?
   ```

#### ❌ 누락된 가이드라인
1. **레이아웃 방향 명시적 확인 없음**
   - "horizontal vs vertical" 검증 단계 부재
   - "row vs column" 판단 체크리스트 없음

2. **Card 배치 패턴 분석 없음**
   - Zigzag 레이아웃 인식 불가
   - "alternating alignment" 패턴 문서화 방법 없음

3. **Grid 가정 편향**
   - "n개 → n열 grid" 자동 추론 방지 로직 없음
   - "카드가 몇 개인가?"보다 "어떻게 배치되었는가?" 우선 강조 부족

---

## 🔧 해결 방안

### 1. **Layout Direction 검증 단계 추가**

#### Proposed Addition to `ui-spec-guide.md`:

**After Line 127 (before "##### Grid Layout Documentation")**:

```markdown
##### Layout Direction Analysis (CRITICAL)

**STEP 1: Determine Primary Layout Direction**

Before documenting any multi-item section, ALWAYS answer:

1. **Are items arranged horizontally (side-by-side in rows) or vertically (stacked top-to-bottom)?**
   - Horizontal: Items share the same vertical position, fill width across screen
   - Vertical: Items are stacked, one below another, creating vertical flow

2. **How many columns does each row contain?**
   - Count visible items at the same vertical level
   - Check if this pattern is consistent across all rows

3. **Special Patterns:**
   - **Zigzag/Alternating**: Items are vertically stacked but alternate left/right alignment
   - **Masonry**: Items are vertically stacked with varying heights but consistent columns
   - **Asymmetric**: Different rows have different column counts intentionally

**Visual Inspection Checklist:**

```
□ Measure vertical distance between items vs horizontal distance
  → If vertical >> horizontal: Likely vertical layout
  → If horizontal >> vertical: Likely horizontal layout

□ Check if items share horizontal alignment (same y-position)
  → YES: Horizontal grid (rows)
  → NO: Vertical stack or zigzag

□ Look for alternating alignment in vertical layout
  → Items shift left/right: Zigzag pattern
  → Items centered: Single-column centered stack
```

**⚠️ CRITICAL: Avoid Auto-Inference**

DO NOT assume:
- ❌ "3 items = 3-column grid"
- ❌ "Even number = 2-column grid"
- ❌ "Cards → Must be grid"

INSTEAD:
- ✅ Measure actual positions in reference image
- ✅ Describe what you observe, not what seems logical
- ✅ Verify direction before assuming grid structure

**Documentation Template for Vertical Layouts:**

If analysis shows vertical stacking:

```markdown
### Card Layout

| Property | Value |
|----------|-------|
| Layout direction | Vertical (single column) |
| Card alignment | Alternating (zigzag) / Centered / Left-aligned |
| Card width | [Percentage or constraint] |
| Vertical spacing | [Token reference] |
```

Example:
```markdown
**Layout**: Cards are arranged vertically (stacked top-to-bottom) with alternating alignment:
- Odd cards (1, 3, 5): Left-aligned
- Even cards (2, 4, 6): Right-aligned
- Each card: Maximum width 600px, centered in section
- Vertical spacing between cards: 48px (token(spacing.2xl))
```
```

---

### 2. **Zigzag Pattern Recognition**

Add to **"### What to INCLUDE"** section:

```markdown
### Layout Patterns (Add to Line 174)

| Pattern | Description | How to Document |
|---------|-------------|-----------------|
| Horizontal Grid | Items in rows, multiple columns | "N-column grid (responsive: M columns on tablet...)" |
| Vertical Stack | Items stacked top-to-bottom | "Vertical stack, single column" |
| Zigzag (Alternating) | Vertical stack with left/right alternation | "Vertical layout with alternating alignment (odd: left, even: right)" |
| Masonry | Variable heights, consistent columns | "Masonry grid, N columns" |
```

---

### 3. **Pre-Documentation Checklist**

Add to **"### Workflow"** section (after Phase 3):

```markdown
**Phase 3.5: Layout Verification** (NEW - CRITICAL)

Before writing ui-spec.md, verify for each multi-item section:

```
SECTION: [Section Name]

□ Primary direction: [Horizontal / Vertical / Mixed]
□ If horizontal: How many columns? [1 / 2 / 3 / 4 / 5+]
□ If vertical: Alignment pattern? [Center / Left / Right / Alternating]
□ Responsive behavior: Does direction/column-count change? [Yes / No]
  - Mobile: [Direction + columns]
  - Tablet: [Direction + columns]
  - Desktop: [Direction + columns]

⚠️ If assumption made (not clearly visible): [Document assumption + rationale]
```

**Example:**

```
SECTION: Technology Section

✓ Primary direction: Vertical (cards stacked top-to-bottom)
✓ If horizontal: N/A
✓ If vertical: Alternating (zigzag: left → right → left)
✓ Responsive behavior: Maintains vertical stack on all breakpoints
  - Mobile: Vertical, centered (single column)
  - Tablet: Vertical, alternating (zigzag preserved)
  - Desktop: Vertical, alternating (zigzag preserved)

⚠️ No assumptions made - layout clearly visible in reference image
```
```

---

### 4. **Error Prevention Rules**

Add to **"### Core Principles"** (after Line 13):

```markdown
#### 3. Layout Direction First, Grid Structure Second

**Priority Order for Multi-Item Sections:**

1. **FIRST**: Determine direction (horizontal rows vs vertical stack)
2. **SECOND**: If horizontal → document grid columns
3. **THIRD**: If vertical → document alignment pattern
4. **FOURTH**: Document responsive behavior

**Anti-Pattern:**
```markdown
❌ WRONG (assumption-first):
"3 cards → document as 3-column grid"

✅ CORRECT (observation-first):
1. Observe: Cards are stacked vertically in reference image
2. Measure: Vertical spacing >> horizontal spacing
3. Pattern: Alternating left/right alignment (zigzag)
4. Document: "Vertical layout with alternating alignment"
```

**Verification Question:**
Before finalizing any grid specification, ask:
> "Does the reference image show these items side-by-side (horizontal) or stacked (vertical)?"

If answer is unclear, re-examine image or flag as assumption.
```

---

## 📊 Impact Analysis

### If These Changes Were Applied

#### Before (Current Behavior)
```
1. LLM sees 3 Technology cards
2. Assumes "3 cards = 3-column grid"
3. Documents as horizontal grid
4. Code Job implements horizontal grid
5. User sees wrong layout ❌
```

#### After (With Proposed Changes)
```
1. LLM sees 3 Technology cards
2. **NEW**: Checks "Layout Direction Analysis" guidelines
3. Measures vertical vs horizontal spacing in image
4. Observes: Vertical spacing >> horizontal
5. Observes: Cards alternate left/right alignment
6. Documents as "Vertical layout, zigzag pattern"
7. Code Job implements vertical zigzag
8. User sees correct layout ✅
```

---

## 🎯 Priority & Implementation

### P0 (Critical)
1. **Add "Layout Direction Analysis" section**
   - Location: Before "##### Grid Layout Documentation"
   - Content: Checklist for horizontal vs vertical determination
   - Prevents auto-inference of "n items = n columns"

### P1 (High)
2. **Add "Zigzag Pattern Recognition"**
   - Location: In layout patterns table
   - Enables documentation of alternating alignment

3. **Add "Pre-Documentation Checklist"**
   - Location: In Workflow section (Phase 3.5)
   - Forces explicit verification before writing spec

### P2 (Medium)
4. **Add "Error Prevention Rules"**
   - Location: Core Principles section
   - Reinforces observation-first approach

---

## 🔬 Testing Strategy

### Validation Test Case

**Input**: ant-ogf/uidoc-test reference image  
**Expected Output**: Technology section specification

#### Success Criteria
```markdown
### Technology Section

**Layout**: Vertical stack with alternating alignment (zigzag pattern)
- Card arrangement: Stacked top-to-bottom
- Card 1 (CROSS Mainnet): Left-aligned
- Card 2 (CROSS Protocol): Right-aligned  
- Card 3 (CROSS Dev Guide): Left-aligned
- Card width: Maximum 600px
- Vertical spacing: 64px between cards

**NOT** a horizontal 3-column grid.
```

### Regression Tests

Test on other sections to ensure no negative impact:
- ✅ Ecosystem: Should still be "3-column grid" (horizontal)
- ✅ Token: Should still be "5-column grid" (horizontal)
- ✅ Ecosystem Cards: Should still be "3 columns" (horizontal)

---

## ✅ 결론

### Design Job 실패 원인
1. **"n개 = n열" 자동 추론 편향**
2. **레이아웃 방향 검증 단계 부재**
3. **Zigzag 패턴 인식 불가**

### 해결 방안
1. **명시적 "Layout Direction" 검증 단계 추가**
2. **Observation-first, assumption-last 원칙 강화**
3. **Zigzag 등 특수 패턴 문서화 방법 제공**

### 기대 효과
- ✅ 레이아웃 방향 오해석 방지
- ✅ Reference 이미지와 일치하는 ui-spec 생성
- ✅ Code Job이 올바른 레이아웃 구현

**다음 단계**: ui-spec-guide.md에 제안된 변경사항 적용

---

## 📖 관련 문서

- `/Users/probe/dev/ant/CODE_JOB_ROOT_CAUSE_ANALYSIS.md` - Code Job planText 전파 문제
- `/Users/probe/dev/ant/packages/ant-cli/src/core/prompt/templates/design/phases/execute/injections/ui-spec-guide.md` - Design Job UI Spec 생성 가이드
