# Code Job Violation Enforcement 분석 및 리팩토링

> **Date**: 2024-12-18  
> **Purpose**: Violations enforcement 메커니즘 분석 및 개선 방안

---

## 📐 현재 구조

### **Violations 처리 흐름:**

```
Final Task 완료
  ↓
runtimeValidate (violations 발생)
  ↓
checkTaskStatus (violations 존재 확인)
  ↓
enforce node (violations 포맷팅 + prioritization)
  ↓
plan node (수정 계획 수립) ← plan/base.md 사용
  ↓
codeGen node (코드 수정 실행) ← promptBuilder.ts가 violations 주입
  ↓
실제 수정
  ↓
checkTaskStatus (여전히 violations 있으면 반복)
```

### **관련 파일:**

| 파일 | 역할 | Violations 관련 내용 |
|-----|------|---------------------|
| **promptBuilder.ts** | Prompt 조합 | ❌ 500+ tokens enforcement header 주입 (Line 95-115) |
| **plan/base.md** | 수정 계획 | ✅ 분석 중심 (Line 96-115) |
| **execute/base.md** | 코드 실행 | ℹ️ Violations 프로세스 설명만 (Line 220-224) |

---

## ❌ 현재 문제점

### **1. promptBuilder.ts의 과도한 Enforcement (500+ tokens)**

**Line 95-115:**
```typescript
const enforcementHeader = `
════════════════════════════════════════════════════════════════════════════════
🚨 CRITICAL: PREVIOUS ATTEMPT FAILED - VIOLATIONS BELOW ARE MANDATORY TO FIX!
════════════════════════════════════════════════════════════════════════════════

**VIOLATIONS ARE NOT SUGGESTIONS - THEY ARE ABSOLUTE REQUIREMENTS:**

${violationsText}

🚨 YOU MUST:
1. READ EACH VIOLATION ABOVE CAREFULLY
2. UNDERSTAND THE ROOT CAUSE
3. FOLLOW THE EXACT FIX INSTRUCTIONS IN EACH VIOLATION MESSAGE
4. DO NOT PROCEED WITH YOUR ORIGINAL PLAN UNTIL ALL VIOLATIONS ARE FIXED

⚠️  Ignoring violations = Task fails permanently!

════════════════════════════════════════════════════════════════════════════════
🔴 MANDATORY RESPONSE FORMAT:
════════════════════════════════════════════════════════════════════════════════

YOU MUST START YOUR RESPONSE WITH THE FOLLOWING:

"⚠️ VIOLATION ACKNOWLEDGED: I have read the ${state.violations.length} violation(s) above.
I will now fix: [briefly describe what you will fix]
Fix approach: [briefly describe your approach]"

If you do NOT start your response with "⚠️ VIOLATION ACKNOWLEDGED", 
it means you did not see the violations and your response will be rejected!
════════════════════════════════════════════════════════════════════════════════
`;
```

**문제:**
- ❌ **500+ tokens 낭비** (format enforcement에만 사용)
- ❌ **LLM이 format에 집중**, 실제 해결은 소홀
- ❌ **Prompt overload** (violations 내용이 묻힘)
- ❌ **"VIOLATION ACKNOWLEDGED" 강제 → Cargo cult programming**
- ❌ **과도한 강압 → LLM 사고 능력 저하**

**증거:**
- 사용자 케이스: "⚠️ VIOLATION ACKNOWLEDGED..." 계속 반복
- LLM은 format은 지키지만 문제는 못 고침
- Violations가 완전히 해결되지 않아 무한 반복처럼 느껴짐

---

### **2. Multiple Violations 동시 처리**

**현재:**
```
violations: [A, B, C, D, E] (5개 동시)
→ LLM: A, B 고침, C, D, E 놓침
→ Retry
→ LLM: C 고침, D, E 놓침
→ Retry
→ ...
```

**문제:**
- Task scope가 너무 큼
- LLM이 일부만 고치고 나머지 놓침
- "VIOLATION ACKNOWLEDGED" 반복 → 사용자 혼란

---

### **3. Plan vs Execute의 역할 혼란**

**plan/base.md (Line 106-112):**
```markdown
**Your plan MUST address these failures:**
- ✅ Analyze root cause of each violation
- ✅ Understand WHY the previous approach failed
- ✅ Propose fundamentally different approach
- ❌ DO NOT blindly retry the exact same operations
```

**promptBuilder.ts (Line 100-104):**
```markdown
🚨 YOU MUST:
1. READ EACH VIOLATION ABOVE CAREFULLY
2. UNDERSTAND THE ROOT CAUSE
3. FOLLOW THE EXACT FIX INSTRUCTIONS
4. DO NOT PROCEED WITH YOUR ORIGINAL PLAN
```

**문제:**
- Plan에서 이미 분석했는데, Execute에서 또 분석 요구
- 중복된 지시
- 역할 경계 불분명

---

## ✅ 개선 방향

### **원칙:**

1. **✅ Violations = 진단 (Diagnosis)**
   - 시스템이 제공: 무엇이 잘못되었는가
   - LLM이 찾기: 어떻게 고칠 것인가

2. **✅ LLM을 믿기**
   - 과도한 강압 불필요
   - Format enforcement 불필요
   - 명확한 정보만 제공하면 LLM이 해결

3. **✅ Separation of Concerns**
   - Plan: 근본 원인 분석 + 해결 전략
   - Execute: 실제 수정 실행
   - 역할 명확히

---

## 🎯 리팩토링 계획

### **Phase 1: promptBuilder.ts 단순화**

**Before (500+ tokens):**
```typescript
const enforcementHeader = `
════════════════════════════════════════════════════════════════════════════════
🚨 CRITICAL: PREVIOUS ATTEMPT FAILED ...
... (20+ lines of enforcement)
════════════════════════════════════════════════════════════════════════════════
`;
```

**After (50 tokens):**
```typescript
const enforcementHeader = `
Previous attempt failed. Fix these violations before proceeding:

${violationsText}

Focus on root cause, not workarounds.
`;
```

**개선:**
- ✅ 500 tokens → 50 tokens (90% 절감)
- ✅ Format enforcement 제거
- ✅ 명확하고 간결
- ✅ LLM의 자율성 존중

---

### **Phase 2: Top Priority Violations만 처리**

**현재:**
```typescript
// All violations 동시 전달
const violationsText = formatViolations(state.violations);
```

**개선:**
```typescript
// Top 1-2 violations만 전달
const topViolations = prioritizeViolations(state.violations).slice(0, 2);
const violationsText = formatViolations(topViolations);
```

**이유:**
- Focus → LLM이 제대로 고침
- 순차 해결 → 일부 문제는 자동 해결 (cascading)
- 명확한 progress → 사용자 혼란 감소

---

### **Phase 3: Plan과 Execute 역할 명확화**

**plan/base.md (유지):**
```markdown
**Your plan MUST address these failures:**
- Analyze root cause
- Propose solution strategy
```

**promptBuilder.ts (단순화):**
```markdown
Previous attempt failed. Fix these violations:
[violations]
```

**역할:**
- Plan: 분석 + 전략
- Execute: 실행 (분석은 Plan이 이미 함)

---

## 📊 예상 효과

### **Before:**

```
Retry 1: 5 violations
→ "🚨 CRITICAL! MANDATORY! YOU MUST START WITH 'VIOLATION ACKNOWLEDGED'..."
→ LLM: "⚠️ VIOLATION ACKNOWLEDGED: I have read..."
→ 3개 고침, 2개 남음

Retry 2: 2 violations
→ "🚨 CRITICAL! MANDATORY! YOU MUST START WITH 'VIOLATION ACKNOWLEDGED'..."
→ LLM: "⚠️ VIOLATION ACKNOWLEDGED: I have read..."
→ 1개 고침, 1개 남음

Retry 3: 1 violation
→ "🚨 CRITICAL! MANDATORY! YOU MUST START WITH 'VIOLATION ACKNOWLEDGED'..."
→ 사용자: "왜 계속 VIOLATION ACKNOWLEDGED 반복하냐?"
```

**문제:**
- Format에 집중, 해결 못함
- 일부만 고치고 놓침
- 사용자 혼란

---

### **After:**

```
Retry 1: Top 2 violations (A, B)
→ "Previous attempt failed. Fix: [A, B]"
→ LLM: [분석] → [해결]
→ A, B 완전히 고침 (Focus!)

Retry 2: Top 2 violations (C, D)
→ "Previous attempt failed. Fix: [C, D]"
→ LLM: [분석] → [해결]
→ C, D 완전히 고침

Retry 3: Top 1 violation (E)
→ "Previous attempt failed. Fix: [E]"
→ LLM: [분석] → [해결]
→ E 완전히 고침

Done! ✅
```

**개선:**
- 명확한 focus → 제대로 고침
- 순차 해결 → progress 가시적
- 사용자 이해도 향상

---

## ⚠️ 리팩토링 시 주의사항

### **DO NOT:**

1. ❌ Violations를 "더 구체적으로" (exact content 제공)
   - 이유: LLM의 역할 침해
   - 대신: 명확한 진단만 제공

2. ❌ Auto-fix 남용
   - 이유: LLM 학습 기회 박탈
   - 대신: 간단한 것만 auto-fix (missing directory 등)

3. ❌ Format enforcement 추가
   - 이유: Cargo cult, 실효성 없음
   - 대신: 명확한 정보 제공

### **DO:**

1. ✅ 단순화 (less is more)
   - 500 tokens → 50 tokens
   - 명확하고 간결하게

2. ✅ Priority 기반 처리
   - Top 1-2 violations만
   - 순차 해결

3. ✅ LLM 신뢰
   - 과도한 강압 제거
   - 자율성 존중

---

## 🔬 검증 계획

### **리팩토링 후 측정:**

1. **Token 사용량**
   - Before: ~500 tokens (enforcement)
   - After: ~50 tokens (expected)
   - 절감: 90%

2. **Retry 횟수**
   - Before: 평균 3-4 retries
   - After: 평균 2-3 retries (expected)
   - 개선: 25-33%

3. **Success Rate**
   - Before: violations 일부만 해결
   - After: Top violations 완전 해결 (expected)
   - 개선: Focus → Quality up

4. **사용자 경험**
   - Before: "왜 계속 VIOLATION ACKNOWLEDGED?"
   - After: 명확한 progress
   - 개선: 이해도 향상

---

## 📝 Implementation Checklist

### **Phase 1: promptBuilder.ts 리팩토링**
- [ ] Line 95-115 enforcement header 단순화
- [ ] "VIOLATION ACKNOWLEDGED" 강제 제거
- [ ] 50 tokens 이하로 축소
- [ ] 테스트: 기존 violations 처리 동작 확인

### **Phase 2: Priority-based Processing**
- [ ] enforce.ts에 prioritization 로직 추가
- [ ] Top 1-2 violations만 focus
- [ ] 나머지는 다음 retry에서 처리
- [ ] 테스트: Cascading fix 효과 확인

### **Phase 3: Documentation**
- [ ] docs/code-job-prompt-architecture.md 업데이트
- [ ] Changelog 작성
- [ ] Examples 추가

---

## 🎬 결론

### **핵심 문제:**
- **과도한 enforcement (500+ tokens) → LLM이 format에만 집중**
- **Multiple violations 동시 처리 → 일부만 해결**
- **"VIOLATION ACKNOWLEDGED" 반복 → 사용자 혼란**

### **해결책:**
- **단순화 (50 tokens) → LLM이 본질에 집중**
- **Priority-based (Top 1-2) → 완전한 해결**
- **Format enforcement 제거 → 자율성 존중**

### **기대 효과:**
- **Token 90% 절감**
- **Retry 25-33% 감소**
- **Success rate 향상**
- **사용자 경험 개선**

**"Less is more. Trust the LLM."** 🎯

---

**END OF DOCUMENT**
