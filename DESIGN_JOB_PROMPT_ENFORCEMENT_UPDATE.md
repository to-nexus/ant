# Design Job 프롬프트 강제력 강화 완료

**날짜**: 2026-01-10  
**파일**: `packages/ant-cli/src/core/prompt/templates/design/phases/execute/injections/ui-spec-guide.md`  
**변경**: 237줄 → 356줄 (+119줄, +50%)

---

## 🎯 문제점

### Before (237줄 프롬프트)

**구조**:
```
✅ 원칙 명시 ("Specification, Not Implementation")
✅ 금지 리스트 (Framework, Testing 등)
❌ 강제 메커니즘 없음
```

**LLM 행동**:
```
"레이아웃, 컴포넌트 작성 ✅
 Framework 쓰지 말라고 했네 (인지)
 근데 개발자에게 Implementation Notes 주면 유용하겠다 (helpful 편향)
 QA에게 Testing Checklist도 추가하자"

결과: Implementation (100줄) + Testing (43줄) 추가
```

**결과물 (ant-ogf/uidoc-test)**:
```
ui-spec.md: 1057줄
- Line 958-1057: Implementation Notes (Next.js, Tailwind 코드)
- Line 1061-1103: Testing Checklist (QA 내용)
- Framework 언급: 19회
```

---

## ✅ 해결 방안

### 추가된 3가지 강제 메커니즘

#### 1. MANDATORY OUTPUT STRUCTURE (Line 8-52, ~44줄)

**내용**:
```markdown
## 🚨 MANDATORY OUTPUT STRUCTURE

**CRITICAL**: Your ui-spec.md MUST contain ONLY these sections:

1. Overview
2. Layout Structure
3. Component Specifications
4. Responsive Behavior
5. Accessibility Requirements

**ANY OTHER SECTION IS FORBIDDEN AND WILL CAUSE THE TASK TO FAIL.**

### Specifically PROHIBITED Sections
- ❌ "Implementation Notes"
- ❌ "Testing Checklist"
- ❌ "Browser Support"
- ❌ "Tech Stack"
- ❌ "State Management"
...
```

**효과**:
- ✅ 5개 섹션만 허용 명시
- ✅ "MUST contain ONLY" 강제 언어
- ✅ "TASK FAILURE" 경고
- ✅ 금지 섹션 구체적 나열

---

#### 2. CRITICAL MANDATE 강화 (Line 79-118, ~39줄)

**내용**:
```markdown
### 2. Specification, Not Implementation

⚠️ **CRITICAL MANDATE**

ui-spec.md MUST contain ONLY visual and behavioral specifications.

**You are ABSOLUTELY FORBIDDEN from including**:
- ❌ Implementation guidance → **TASK FAILURE**
- ❌ Testing checklists → **TASK FAILURE**
- ❌ Code examples → **TASK FAILURE**
- ❌ Framework names → **TASK FAILURE**
...

**ANY violation of these rules will result in TASK FAILURE.**
```

**변경점**:
- Before: "ui-spec.md is ONLY for..." (설명형)
- After: "MUST contain ONLY" + "ABSOLUTELY FORBIDDEN" + "TASK FAILURE" (명령형)

**효과**:
- ✅ 명령형 언어 ("MUST", "FORBIDDEN")
- ✅ 실패 결과 명시 ("TASK FAILURE")
- ✅ 금지 항목별 실패 경고 추가

---

#### 3. PRE-SUBMISSION MANDATORY CHECK (Line 257-313, ~56줄)

**내용**:
```markdown
## 🔍 PRE-SUBMISSION MANDATORY CHECK

**CRITICAL**: You MUST run this self-check BEFORE submitting.

### Step 1: Section Count Verification
□ Exactly 5 sections? → Continue
□ MORE than 5? → DELETE extra sections

### Step 2: Forbidden Content Scan
□ Search "Next.js", "React", "Tailwind"
  → FOUND: DELETE ALL sections containing these

□ Search "## Implementation", "## Testing"
  → FOUND: DELETE these entire sections

### Step 3: Token Reference Verification
□ All values use token(...)? → Continue
□ Found raw values? → Replace

### Step 4: Platform-Agnostic Check
...

### Step 5: Final Verification
□ iOS, Android, React, Vue developers could ALL implement?
  → YES: Submit
  → NO: Remove tech-specific content

⚠️ ONLY AFTER ALL CHECKS PASS → Submit
```

**효과**:
- ✅ 5단계 자체 검증 프로세스
- ✅ 체크리스트 형식 (□)
- ✅ 조건부 제출 강제
- ✅ Framework 직접 검색 지시

---

## 📊 변경 요약

### 파일 변경

| 항목 | Before | After | 변경 |
|------|--------|-------|------|
| **총 줄 수** | 237줄 | 356줄 | +119줄 (+50%) |
| **MANDATORY 섹션** | 0줄 | ~44줄 | +44줄 |
| **CRITICAL MANDATE** | ~25줄 | ~39줄 | +14줄 |
| **PRE-SUBMISSION** | 0줄 | ~56줄 | +56줄 |
| **기존 내용** | 212줄 | 217줄 | +5줄 (미세 조정) |

### 강제력 비교

| 메커니즘 | Before | After |
|----------|--------|-------|
| **허용 섹션 명시** | ❌ 없음 | ✅ 5개만 명시 |
| **금지 섹션 리스트** | ✅ 있음 | ✅ 강화 (8개 구체화) |
| **명령형 언어** | ⚠️ 약함 ("is ONLY") | ✅ 강함 ("MUST", "FORBIDDEN") |
| **실패 경고** | ❌ 없음 | ✅ "TASK FAILURE" 반복 |
| **자체 검증** | ❌ 없음 | ✅ 5단계 체크리스트 |
| **조건부 제출** | ❌ 없음 | ✅ "ONLY AFTER checks pass" |

---

## 🎯 기대 효과

### 프롬프트 동작 방식 변경

**Before**:
```
LLM: "레이아웃 작성 ✅"
LLM: "금지 리스트 확인 (참고)"
LLM: "추가로 도움될 내용... Implementation Notes 추가"
LLM: "제출"
```

**After**:
```
LLM: "MANDATORY: 5개 섹션만 허용"
LLM: "Overview, Layout, Components, Responsive, Accessibility 작성 ✅"
LLM: "추가 섹션? → TASK FAILURE 경고 → 추가 안 함"
LLM: "PRE-SUBMISSION CHECK 실행"
     → Step 1: 섹션 5개? ✅
     → Step 2: "Next.js" 검색? → 없음 ✅
     → Step 3: "## Testing" 검색? → 없음 ✅
     → Step 4: Token 참조? ✅
     → Step 5: Platform-agnostic? ✅
LLM: "모든 체크 통과 → 제출"
```

### 기대 산출물 품질

**Before (ant-ogf/uidoc-test)**:
```bash
wc -l ui-spec.md                         → 1057줄
grep -c "Next\.js\|Tailwind" ui-spec.md  → 19회
grep "## Testing" ui-spec.md             → Found
grep "## Implementation" ui-spec.md      → Found
```

**After (기대)**:
```bash
wc -l ui-spec.md                         → ~914줄 (143줄 감소)
grep -c "Next\.js\|Tailwind" ui-spec.md  → 0회
grep "## Testing" ui-spec.md             → No matches
grep "## Implementation" ui-spec.md      → No matches
```

**품질 개선**:
- ✅ Framework 언급 제거 (19 → 0)
- ✅ Implementation 섹션 제거 (100줄 삭제)
- ✅ Testing 섹션 제거 (43줄 삭제)
- ✅ Platform-agnostic 명세서
- ✅ 깔끔한 5-section 구조

---

## 🔍 검증 방법

### 1. Design Job 재실행

```bash
cd /Users/probe/dev/ant-workspaces/to.nexus/probe/ant-ogf/features/uidoc-test
ant design
```

### 2. 결과 검증

```bash
# 1. 섹션 수 확인 (5개 기대)
grep "^## " outputs/design/ui-spec.md | wc -l

# 2. Framework 언급 확인 (0 기대)
grep -i "next\.js\|react\|tailwind\|vue\|angular" outputs/design/ui-spec.md

# 3. 금지 섹션 확인 (No matches 기대)
grep "## Testing\|## Implementation\|## Technical\|## Browser Support" outputs/design/ui-spec.md

# 4. 코드 블록 확인 (No matches 기대)
grep "\.tsx\|\.jsx\|className=\|module\.exports" outputs/design/ui-spec.md

# 5. 줄 수 확인 (~914줄 기대)
wc -l outputs/design/ui-spec.md
```

---

## 📝 주요 변경 지점

### Line 8-52: MANDATORY OUTPUT STRUCTURE
- 5개 섹션만 허용 명시
- 금지 섹션 8개 구체적 나열
- "TASK FAILURE" 경고

### Line 79-118: CRITICAL MANDATE
- "MUST", "ABSOLUTELY FORBIDDEN" 명령형 언어
- 각 금지 항목에 "TASK FAILURE" 명시
- 확장된 금지 리스트 (CSS 클래스 등 추가)

### Line 257-313: PRE-SUBMISSION MANDATORY CHECK
- 5단계 자체 검증 프로세스
- Framework 직접 검색 지시
- 조건부 제출 강제

---

## 🎓 학습 포인트

### LLM 프롬프팅의 핵심

**1. 금지만으로는 부족**:
```
❌ "Framework 쓰지 마라" (금지만)
✅ "5개 섹션만 허용" (허용 명시) + "다른 건 금지" (금지)
```

**2. 설명형보다 명령형**:
```
❌ "ui-spec.md is for specifications" (설명)
✅ "You MUST include ONLY specifications" (명령)
```

**3. 자체 검증 강제**:
```
❌ LLM이 알아서 판단
✅ "PRE-SUBMISSION CHECK 실행 → ONLY AFTER pass → Submit"
```

**4. 구체적 경고**:
```
❌ "이건 안 좋아"
✅ "이걸 하면 TASK FAILURE"
```

---

## 🚀 다음 단계

1. ✅ 프롬프트 수정 완료 (356줄)
2. ⏳ Design Job 재실행 대기
3. ⏳ 결과 검증 대기
4. ⏳ 효과 측정 및 추가 조정

**준비 완료!** Design Job을 재실행하시면 됩니다.
