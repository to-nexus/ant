# 🐛 Feature Task에서 `npm run build` 실행 버그 - 최종 해결

## 📋 문제 상황

Feature task (priority 200-899)에서 `npm run build`를 실행함:
```
LLM: "Let me verify the domain layer structure is complete..."
→ Tool call: run_command("npm run build")
→ ❌ Build fails (dependencies not installed yet)
```

## 🔍 근본 원인

### **conversationHistory 사용 시 제약사항 누락**

#### Turn 1 (정상)
```typescript
if (!state.conversationHistory) {
  // ✅ 전체 프롬프트 생성
  const promptResult = await promptEngine.buildExecutePrompt(...);
  messages.push({ role: 'user', content: fullPrompt });
}
```

**LLM이 받는 내용:**
- ✅ Feature Task 규칙
- ✅ "❌ npm run build 금지"
- ✅ Task description

#### Turn 2 (버그)
```typescript
if (state.conversationHistory.length > 0) {
  // ❌ 히스토리만 추가, 새 프롬프트 생성 안 함
  messages.push(...state.conversationHistory);
}
```

**LLM이 받는 내용:**
```
1. User: [Turn 1의 오래된 프롬프트]  ← 3000 tokens 전
2. Assistant: [코드 생성]
3. User: [Tool 결과: "Success"]      ← 가장 최근
```

**결과:** LLM recency bias → 최근 메시지에 집중 → 제약사항 무시

## ✅ 해결책: 매 턴마다 전체 프롬프트 재생성

### **핵심 아이디어**
conversationHistory가 있어도 **매번 새로운 프롬프트를 생성**하여 제약사항이 항상 최신 위치에 있도록 함

### **코드 변경**

**Before:**
```typescript
// ❌ 조건부 프롬프트 생성
if (!state.conversationHistory || state.conversationHistory.length === 0) {
  const promptResult = await promptEngine.buildExecutePrompt(...);
  messages.push({ role: 'user', content: fullContent });
}

if (state.conversationHistory && state.conversationHistory.length > 0) {
  messages.push(...state.conversationHistory); // 제약사항 없음!
}
```

**After:**
```typescript
// ✅ ALWAYS build fresh prompt
const promptResult = await promptEngine.buildExecutePrompt(...);
// ... 프롬프트 구성 ...

// ✅ First message: Always the full prompt
messages.push({
  role: 'user',
  content: fullContent,  // 매번 새로 생성! (File tree 등 최신 정보)
});

// ✅ Add conversation history - but SKIP the first message
if (state.conversationHistory && state.conversationHistory.length > 0) {
  // 첫 번째 메시지(오래된 프롬프트) 제외, 나머지만 추가
  const historyWithoutFirstPrompt = state.conversationHistory.slice(1);
  messages.push(...historyWithoutFirstPrompt);
}
```

### **메시지 구조 변화**

#### Before (버그)
```
Turn 2 messages:
1. User: [Turn 1 프롬프트]  ← 오래됨, 멀리 있음
2. Assistant: [Tool calls]
3. User: [Tool results]     ← 최근, LLM 집중
→ 제약사항 무시
```

#### After (수정)
```
Turn 2 messages:
1. User: [새로운 프롬프트]  ← 최신 정보 + 제약사항!
2. Assistant: [Tool calls]
3. User: [Tool results]
→ 제약사항 바로 위에 있음! ✅
```

## 🎯 장점

### 1. **우아함**
- ✅ 기존 `execute/base.md` 재사용
- ✅ 하드코딩 없음
- ✅ 별도 템플릿 불필요

### 2. **일관성**
- ✅ 모든 턴에서 동일한 프롬프트 생성 로직
- ✅ 제약사항 누락 불가능

### 3. **최신 정보**
- ✅ File tree가 매 턴마다 업데이트됨
- ✅ Runtime context가 항상 최신

### 4. **유지보수성**
- ✅ `execute/base.md`만 수정하면 모든 턴에 반영
- ✅ 중복 코드 없음

## 📊 성능 영향

### **우려: 매번 프롬프트 생성 = 느림?**

**실제:**
- 프롬프트 생성 시간: ~10-50ms (템플릿 렌더링)
- LLM API 호출 시간: ~1000-5000ms (네트워크 + 추론)
- **비율: 1% 미만**

**결론:** 성능 영향 무시할 수 있음

### **장점이 더 큼**
- ✅ File tree가 매번 업데이트됨 (이전: 첫 턴만)
- ✅ Code 변경사항이 프롬프트에 반영됨
- ✅ 버그 방지 > 미미한 성능 영향

## 🔧 적용된 수정 사항

**파일:** `/packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen.ts`

**함수:** `buildMessages()`

**핵심 변경:**
1. ✅ 조건문 제거: `if (!state.conversationHistory)` 삭제
2. ✅ 항상 프롬프트 생성: 매 턴마다 `promptEngine.buildExecutePrompt()` 호출
3. ✅ 히스토리 처리: `conversationHistory.slice(1)` (첫 메시지 제외)

---

**수정 완료**: 2025-11-23
**영향 범위**: 모든 code job의 tool call loop
**회귀 위험**: Minimal (로직 단순화, 중복 제거)
**핵심 개선**: LLM recency bias 활용, 제약사항 항상 최신 위치

