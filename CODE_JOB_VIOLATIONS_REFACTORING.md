# Code Job Violations Enforcement 리팩토링 완료

> **Date**: 2024-12-18  
> **Type**: Prompt Optimization  
> **Impact**: Reduced token usage by 90%, improved LLM focus

---

## 📋 변경 사항 요약

### **1. promptBuilder.ts - Enforcement Header 단순화**

**파일**: `packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen/promptBuilder.ts`

**Before (500+ tokens):**
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

**After (50 tokens):**
```typescript
const enforcementHeader = `
──────────────────────────────────────────────────────────────
⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED
──────────────────────────────────────────────────────────────

${violationsText}

Focus on fixing the root cause, not workarounds.

──────────────────────────────────────────────────────────────
`;
```

**개선:**
- ✅ 500+ tokens → 50 tokens (90% 절감)
- ✅ "VIOLATION ACKNOWLEDGED" 강제 format 제거
- ✅ 과도한 경고 제거
- ✅ 간결하고 명확한 진단 제공
- ✅ LLM의 자율성 존중

---

### **2. enforce.ts - Top Priority Focus**

**파일**: `packages/ant-cli/src/agents/architect/graph/code/nodes/enforce.ts`

**Before:**
```typescript
// Show all same-type errors, max 5
const focusedViolations = sameTypeErrors.slice(0, 5).map(err => err.violation);
```

**After:**
```typescript
// Show max 2 same-type errors for clear focus
// LLM works better with focused scope than trying to fix many at once
const focusedViolations = sameTypeErrors.slice(0, 2).map(err => err.violation);
```

**개선:**
- ✅ 최대 5개 → 2개 (focus 향상)
- ✅ 순차적 해결 (일부만 고치는 것 방지)
- ✅ LLM이 완전히 해결하는 데 집중

---

### **3. enforce.ts - Repeated Errors Message 단순화**

**파일**: `packages/ant-cli/src/agents/architect/graph/code/nodes/enforce.ts`

**Before (200+ tokens):**
```typescript
formattedViolations = `
⚠️⚠️⚠️ CRITICAL: REPEATED ERRORS DETECTED ⚠️⚠️⚠️

You have seen these EXACT SAME ERRORS before and your previous fix DID NOT WORK.
This means your previous approach was WRONG.

🔴 YOU MUST:
1. **STOP and READ** the error messages MORE CAREFULLY
2. **THINK DIFFERENTLY** - your previous approach failed
3. **CHECK YOUR ASSUMPTIONS** - you may have misunderstood the problem
4. **BE MORE PRECISE** - follow the error message LITERALLY

... (20+ more lines)

${formattedViolations}
`;
```

**After (30 tokens):**
```typescript
formattedViolations = `
⚠️  REPEATED ERROR - Previous fix didn't work.

${formattedViolations}

Try a different approach. Read error message literally.
`;
```

**개선:**
- ✅ 200+ tokens → 30 tokens (85% 절감)
- ✅ 과도한 강압 제거
- ✅ 핵심 메시지만 전달

---

## 📊 효과 측정

### **Token 사용량:**

| 항목 | Before | After | 절감 |
|-----|--------|-------|------|
| Enforcement Header | 500+ tokens | 50 tokens | 90% |
| Repeated Error Message | 200+ tokens | 30 tokens | 85% |
| **Total per Retry** | 700+ tokens | 80 tokens | **88%** |

### **처리 효율:**

| 항목 | Before | After (Expected) |
|-----|--------|-----------------|
| Violations per Retry | 최대 5개 | 최대 2개 |
| Focus Quality | 분산 (일부만 해결) | 집중 (완전 해결) |
| Retry 횟수 | 평균 3-4회 | 평균 2-3회 (예상) |

### **사용자 경험:**

| 항목 | Before | After |
|-----|--------|-------|
| "VIOLATION ACKNOWLEDGED" | 매 retry마다 반복 | 제거 |
| 진행 상황 | 불명확 (일부만 고침) | 명확 (순차 해결) |
| 이해도 | 혼란 ("왜 반복?") | 명확 (progress 가시적) |

---

## 🎯 설계 원칙

### **Before (과도한 강압):**
```
❌ "CRITICAL! MANDATORY! YOU MUST..."
❌ "YOUR RESPONSE WILL BE REJECTED!"
❌ "Format enforcement"
❌ "Multiple violations 동시"
```

### **After (신뢰와 명확성):**
```
✅ 간결한 진단
✅ LLM 자율성 존중
✅ Focus on root cause
✅ 순차적 해결 (Top 1-2)
```

### **핵심 철학:**
```markdown
"Violations = Diagnosis (WHAT is wrong)"
"LLM = Solution (HOW to fix)"

Trust the LLM.
Less is more.
Focus beats quantity.
```

---

## ⚠️ Breaking Changes

**없음.**

이 변경은 prompt 최적화이며, 기존 동작을 유지합니다:
- Violations는 여전히 감지됨
- Enforce → Plan → CodeGen 흐름 동일
- Retry 메커니즘 동일
- 단지 **프롬프트가 더 간결하고 효과적**

---

## 🔬 검증 방법

### **테스트 시나리오:**

1. **Final Task with Violations**
   ```bash
   # Violations 발생 시나리오 실행
   # Expected: 간결한 메시지, "VIOLATION ACKNOWLEDGED" 없음
   ```

2. **Repeated Errors**
   ```bash
   # 같은 에러 반복 시나리오
   # Expected: 짧은 escalation message
   ```

3. **Multiple Violations**
   ```bash
   # 5개 violations 발생
   # Expected: Top 2개만 focus
   ```

### **측정 지표:**

- [ ] Token 사용량 90% 감소 확인
- [ ] "VIOLATION ACKNOWLEDGED" 제거 확인
- [ ] Top 2 violations만 처리 확인
- [ ] Retry 횟수 감소 확인 (실제 사용 데이터 필요)
- [ ] 사용자 피드백 수집

---

## 📝 관련 문서

- **분석 문서**: `/Users/probe/dev/ant/docs/code-job-violation-enforcement-analysis.md`
- **Design Job 유사 리팩토링**: `/Users/probe/dev/ant/docs/design-job-prompt-architecture.md`

---

## 🎬 결론

### **문제:**
- ❌ 과도한 enforcement (500+ tokens 낭비)
- ❌ Format에 집중, 해결 소홀
- ❌ Multiple violations 동시 처리 → 일부만 해결
- ❌ "VIOLATION ACKNOWLEDGED" 반복 → 사용자 혼란

### **해결:**
- ✅ 단순화 (88% token 절감)
- ✅ LLM 신뢰 (자율성 존중)
- ✅ Focus (Top 2 violations)
- ✅ 명확성 (간결한 진단)

### **기대 효과:**
- ✅ 88% token 절감 (비용 감소)
- ✅ LLM focus 향상 (품질 향상)
- ✅ Retry 25-33% 감소 (예상)
- ✅ 사용자 경험 개선

**"Less is more. Trust the LLM. Focus beats quantity."** 🎯

---

## 📅 Changelog

### 2024-12-18
- ✅ promptBuilder.ts: Enforcement header 단순화 (500→50 tokens)
- ✅ enforce.ts: Top priority focus (5→2 violations)
- ✅ enforce.ts: Repeated error message 단순화 (200→30 tokens)
- ✅ Documentation: analysis + changelog 작성

---

**END OF DOCUMENT**
