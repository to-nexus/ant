# Design Job 프롬프트 전체 구조 분석

**날짜**: 2026-01-10  
**목적**: ui-spec.md에 Implementation/Testing 내용이 포함된 근본 원인 파악

---

## 🏗️ Design Job 프롬프트 구조

### 프롬프트 조합 로직 (`uiDesignPrompt.ts`)

```typescript
buildUiDesignMessages(state) {
  content: CacheableContent[] = [];
  
  // 1. System Prompt (base-ui-design.md)
  content.push(buildUiDesignSystemPrompt(state));
  
  // 2. Available Resources Summary (동적 생성)
  content.push(buildResourcesSummary(state));
  
  // 3. PRD Context
  if (state.prd) content.push(state.prd);
  
  // 4. Previous UI Docs (의존성 체인)
  content.push(loadPreviousUiDocs(state, taskId));
  
  return [{ role: 'user', content }];
}
```

---

## 📄 프롬프트 파일 계층

### 1. `base-ui-design.md` (메인 구조)

```handlebars
{{> design/phases/execute/rules-ui-design}}  ← 주입 1

Your Role: UI documentation specialist...

## Analysis Guidelines
...

## Task-Specific Instructions
{{#eq taskId "ui-spec"}}
  {{> design/phases/execute/injections/ui-spec-guide}}  ← 주입 2
{{/eq}}

## Critical Rules
1. Token-First
2. Specification Only  ← 여기서 명시!
3. Complete Coverage
```

**구조**:
- Line 3: `rules-ui-design.md` partial 주입
- Line 92-94: taskId에 따라 `ui-spec-guide.md` 조건부 주입
- Line 104: "Specification Only" 규칙 명시

---

### 2. `rules-ui-design.md` (규칙)

**내용**:
```markdown
## ONE TOOL CALL PER TURN
## TOOL USAGE
## OUTPUT FORMAT (XML tags)
## DOCUMENT DEPENDENCY CHAIN
## Document Quality Guidelines

### ui-spec.md
**CRITICAL: Specification, Not Implementation**
| ✅ INCLUDE | ❌ EXCLUDE |
| Layout | Framework code |
| States  | CSS syntax |
| Token refs | Raw values |
```

**Line 175-191**: `ui-spec.md` 품질 가이드 명시
- ✅/❌ 표로 명확히 구분
- "Specification, Not Implementation" 강조

---

### 3. `ui-spec-guide.md` (작업별 가이드)

**내용** (237줄, 제가 수정한 버전):
```markdown
## Core Principles
1. Describe What You SEE
2. Specification, Not Implementation
   - Forbidden: Framework names, File paths, Code syntax
3. Specification vs Verification
   - Forbidden: Testing, QA, Performance benchmarks
4. Token-First
5. Platform-Agnostic

## 🚫 STRICTLY FORBIDDEN
| Category | Examples | Why |
| Frameworks | Next.js, Tailwind | Tech-specific |
| Testing/QA | Testing Checklist | Verification ≠ Specification |
```

**강점**: 명시적 금지 리스트, 원칙 강조  
**약점**: 강제력 없음 (후술)

---

### 4. `base/system.md` (공통 아키텍트 규칙)

**내용**:
```markdown
🚫 ABSOLUTELY FORBIDDEN
- Deployment / CI/CD
- Infrastructure / Kubernetes
- Test plans / QA schedules
...

## SYSTEM DESIGN = ARCHITECTURE + COMPONENT INTERACTION
- WHAT vs HOW 구분
- Implementation details 제외
```

**특징**: System Design 용이지만, UI Design에도 영향 가능?  
→ **검증 필요**: `base/system.md`가 UI Design에 주입되는가?

---

## 🔍 프롬프트 주입 순서 (ui-spec 생성 시)

```
1. base/system.md (?)  ← 확인 필요!
2. base-ui-design.md
   ├─ rules-ui-design.md (partial)
   │   └─ ui-spec 품질 가이드 (Line 175-191)
   └─ ui-spec-guide.md (conditional, taskId="ui-spec")
       └─ 237줄 원칙 + 금지 리스트
3. Available Resources Summary (동적)
4. PRD
5. ui-tokens.md (REFERENCE)
6. ui-assets.md (REFERENCE)
```

**총 프롬프트 길이 추정**:
- base-ui-design.md: ~108줄
- rules-ui-design.md: ~204줄
- ui-spec-guide.md: ~237줄
- PRD: ~수백 줄
- ui-tokens.md: ~213줄
- ui-assets.md: ~수백 줄
- **총 1500~2000줄 추정**

---

## ❓ 근본 질문: 왜 프롬프트가 막지 못했는가?

### 가설 1: `base/system.md`가 UI Design에도 주입되는가?

**확인**:
```typescript
// uiDesignPrompt.ts의 buildUiDesignSystemPrompt()
const template = await promptPort.render('design/phases/execute/base-ui-design', {
  taskId: state.currentTask?.id
});
```

**결론**: `base-ui-design.md`만 로드!  
→ `base/system.md`는 **System Design 전용**

---

### 가설 2: 프롬프트 간 모순이 있는가?

**검증**:

**`rules-ui-design.md` (Line 175-191)**:
```markdown
ui-spec.md
| ✅ INCLUDE | ❌ EXCLUDE |
| Layout structure | Framework-specific code |
| Component states | CSS/styling syntax |
| Interaction behaviors | Implementation details |
| Responsive rules | Raw values |
| Token references | Programming language syntax |
```

**`ui-spec-guide.md` (내가 수정한 버전)**:
```markdown
🚫 STRICTLY FORBIDDEN
| Frameworks | Next.js, Tailwind | Tech-specific |
| File Structure | app/layout.tsx | Implementation |
| Code | className= | Implementation |
| Testing/QA | Testing Checklist | Verification ≠ Specification |
```

**분석**: 모순 없음. 두 파일 모두 동일한 내용 금지.

---

### 가설 3: LLM이 규칙을 "권장"으로 해석

**증거**:

**프롬프트 표현 분석**:
```markdown
rules-ui-design.md:
- "ui-spec.md documents WHAT to build, not HOW" (설명)
- "| ❌ EXCLUDE |" (표)

ui-spec-guide.md (현재):
- "Specification, Not Implementation" (원칙)
- "🚫 STRICTLY FORBIDDEN" (금지 리스트)
- "If you write ## Implementation → You FAILED" (경고)
```

**문제**: 명령형 표현이 **약함**!

**비교**: Code Job의 강제 표현
```markdown
Code Job (plan/base.md):
"Your plan MUST include these sections:"
"CRITICAL: Check projectCodeContext..."
"DO NOT create duplicate..."
```

→ **"MUST", "DO NOT", "CRITICAL"** 명령형 언어

**Design Job (현재)**:
```markdown
"ui-spec.md is ONLY for..."
"Forbidden:"
"NO OTHER SECTIONS ALLOWED."
```

→ **설명형 + 금지 리스트**, 하지만 **"MUST" 부족**

---

## 🎯 핵심 발견

### 문제: 프롬프트가 "무엇을 포함해야 하는가"를 명시하지 않음

**현재 프롬프트 구조**:
```
✅ "이것은 하지 마라" (❌ Forbidden list)
❌ "이것만 해라" (✅ MANDATORY structure)
```

**LLM 사고 과정 추정**:
```
1. ui-spec.md를 작성해야 함
2. Layout, Components, Responsive 작성 (✅)
3. 프롬프트: "Framework 금지, Testing 금지"
4. LLM: "알겠어. 그럼 추가로 도움될 내용은?"
5. LLM: "개발자에게 Implementation Notes가 유용하겠지"
6. LLM: "QA에게 Testing Checklist가 유용하겠지"
7. 결과: Implementation + Testing 추가 (금지 규칙 무시)
```

**왜?**
→ LLM은 "helpful"하려고 함 (Constitutional AI 특성)  
→ 금지 리스트는 "권장사항"으로 해석  
→ **"반드시 이것만"이라는 강제 구조 없음**

---

## 💡 해결 방안

### Option A: MANDATORY OUTPUT STRUCTURE 추가 (가장 강력)

**위치**: `ui-spec-guide.md` 상단

```markdown
## 🚨 MANDATORY OUTPUT STRUCTURE

Your ui-spec.md MUST contain ONLY these sections (in this exact order):

```
# ui-spec.md

> Complete UI specification for [Project Name]

## Overview
[Document purpose, key principles, scope]

## Layout Structure
[Page hierarchy, sections, spacing system, breakpoints]

## Component Specifications
[For each component: Structure, Specifications (visual properties, states), Interactions]

## Responsive Behavior
[Breakpoint transformations, mobile-first vs desktop-first]

## Accessibility Requirements
[Semantic structure, ARIA, keyboard navigation, focus management]

---
END OF DOCUMENT
```

**ANY OTHER SECTION IS FORBIDDEN AND WILL CAUSE THE TASK TO FAIL.**

Specifically, these sections are PROHIBITED:
- ❌ "Implementation Notes" / "Technical Implementation"
- ❌ "Testing Checklist" / "QA Guidelines"
- ❌ "Browser Support" (unless accessibility-related)
- ❌ "Performance Optimization" (specification ≠ optimization)
- ❌ Any section containing framework names, code blocks, or file paths

**If you find yourself about to write "## Implementation" or "## Testing" → STOP. Delete it. You are violating the specification.**
```

**효과**:
- ✅ 명확한 구조 강제 ("MUST contain ONLY")
- ✅ 허용 섹션 명시 (5개)
- ✅ 금지 섹션 명시 (5개)
- ✅ 실패 경고 ("FAIL")

---

### Option B: Pre-Submission Self-Check 추가

**위치**: `ui-spec-guide.md` 하단

```markdown
## 🔍 BEFORE YOU SUBMIT

Run this mandatory self-check on your generated ui-spec.md:

**Step 1: Section Count Check**
□ Does your document have MORE than 5 main sections (##)?
  → YES: Review and remove extra sections
  → NO: Continue

**Step 2: Forbidden Content Scan**
□ Search your document for: "Next.js", "React", "Tailwind", "Vue", "Angular"
  → FOUND: DELETE all sections containing these words
  → NOT FOUND: Continue

□ Search for section headers: "## Testing", "## Implementation", "## Technical"
  → FOUND: DELETE these entire sections
  → NOT FOUND: Continue

□ Search for code blocks with: `.tsx`, `.jsx`, `className=`, `module.exports`
  → FOUND: DELETE these code blocks
  → NOT FOUND: Continue

**Step 3: Token Reference Check**
□ Does every color/spacing/font value use `token(...)`?
  → NO: Replace raw values with token references
  → YES: Continue

**Step 4: Final Verification**
□ Read your "## Overview" section: Does it mention any framework or implementation?
  → YES: Rewrite in platform-agnostic terms
  → NO: You are ready to submit

**ONLY AFTER** all checks pass → Submit your ui-spec.md using `<file>` tag.
```

**효과**:
- ✅ LLM에게 자체 검증 강제
- ✅ 단계별 체크리스트
- ✅ "ONLY AFTER" 조건부 제출

---

### Option C: 명령형 언어 강화

**현재 (약함)**:
```markdown
ui-spec.md is ONLY for visual and behavioral specifications.
```

**수정 (강함)**:
```markdown
⚠️ CRITICAL MANDATE

ui-spec.md MUST be ONLY visual and behavioral specifications.

You are FORBIDDEN from including:
- Implementation guidance (FAIL)
- Testing checklists (FAIL)
- Code examples (FAIL)
- Framework names (FAIL)

ANY violation will result in TASK FAILURE.
```

**효과**:
- ✅ "MUST", "FORBIDDEN", "FAIL" 명령형
- ✅ 실패 결과 명시

---

## 📊 제안: 3가지 개선 통합

### 추가할 내용

**1. MANDATORY OUTPUT STRUCTURE** (~30줄)
- 5개 섹션만 허용
- "ONLY these sections" 강제

**2. Pre-Submission Self-Check** (~25줄)
- 4단계 검증 프로세스
- "ONLY AFTER" 조건부 제출

**3. 명령형 언어 강화** (~10줄)
- "MUST", "FORBIDDEN", "FAIL"
- 경고 강화

**총 증가**: 237줄 → ~300줄 (+63줄, +27%)

---

## 🎯 기대 효과

### Before (현재 237줄 프롬프트)

```
LLM 해석:
"레이아웃, 컴포넌트 작성해야지 (✅)
프롬프트에 Framework 쓰지 말라고 했네
근데 개발자에게 도움될 Implementation Notes 추가하면 좋겠다
QA에게도 Testing Checklist 주면 유용하겠지"

결과: Implementation (100줄) + Testing (43줄) 추가
```

### After (300줄 강제 프롬프트)

```
LLM 해석:
"MANDATORY: 5개 섹션만 허용
Overview, Layout, Components, Responsive, Accessibility
다른 섹션 추가하면 FAIL
Self-check: ## Implementation 있나? → YES → DELETE
Self-check: Framework 이름 있나? → YES → DELETE
최종 검증 통과 → 제출"

결과: 5개 섹션만 포함, 깔끔한 명세서
```

---

## ❓ 다음 단계

**제안**:
1. **즉시**: `ui-spec-guide.md`에 3가지 강제 메커니즘 추가
2. **검증**: ant-ogf/uidoc-test Design Job 재실행
3. **측정**: 
   ```bash
   grep -c "Next\.js\|Tailwind\|React" ui-spec.md  # 0 기대
   grep "## Testing\|## Implementation" ui-spec.md  # No matches 기대
   wc -l ui-spec.md  # ~914줄 기대 (현재 1057줄)
   ```

**진행할까요?**
