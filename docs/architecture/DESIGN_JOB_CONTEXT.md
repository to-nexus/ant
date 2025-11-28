# Design Job - Context Module 적용 완료

## ✅ **적용 완료 사항**

### **Design Job - Plan Node**

**파일**: `packages/ant-cli/src/agents/architect/graph/design/nodes/plan.ts`

```typescript
// ✅ SMART CONTEXT PRE-LOADING (Code job과 동일!)
import { analyzeContextNeeds } from '../../../context/analyzer';
import { loadContext } from '../../../context/loader';

// Evolution/Refactor 모드에서만 실행
if (hasExistingCode && gitPort && currentTask) {
  const strategy = analyzeContextNeeds(
    currentTask,                 // PRIMARY: Task itself
    undefined,                   // SECONDARY: No enforcement in design
    state.prd,                   // TERTIARY: PRD document
    state.files?.map(f => f.path) // QUATERNARY: Existing files
  );
  
  const context = await loadContext(strategy, gitPort);
  
  // LLM에게 전달
  currentCode = `
=== CODEBASE CONTEXT ===
${context.fileTree}
${context.grepResults}
${context.fileContents}
💡 Available Tools: ...
  `;
}
```

---

## 🎯 **Design vs Code Job 차이점**

| **항목** | **Code Job** | **Design Job** |
|---------|-------------|---------------|
| **Decompose** | ✅ Resume시 codebase 로딩 | ❌ 불필요 (설계 문서만) |
| **Plan** | ✅ 매번 context 로딩 | ✅ Evolution/Refactor만 |
| **조건** | `shouldReload = 항상` | `shouldReload = hasExistingCode` |
| **목적** | 코드 생성 참고 | 기존 코드 분석 (리팩토링) |

---

## 📋 **Design Job의 3가지 모드**

### **1. Greenfield (새 프로젝트)**

```typescript
state.code = '';  // Empty
hasExistingCode = false;
shouldReload = false;  // ❌ Context 로딩 안함

// LLM에게 전달
currentCode = '';  // 빈 문자열
```

**이유**: 새 프로젝트이므로 기존 코드 없음

---

### **2. Evolution (기능 추가)**

```typescript
state.code = '(existing codebase)';
hasExistingCode = true;
shouldReload = true;  // ✅ Context 로딩!

// LLM에게 전달
currentCode = `
=== CODEBASE CONTEXT ===
(file tree + grep + contents)
`;
```

**이유**: 기존 구조 파악 필요

---

### **3. Refactor (구조 변경)**

```typescript
state.code = '(existing codebase)';
hasExistingCode = true;
shouldReload = true;  // ✅ Context 로딩!

// LLM에게 전달
currentCode = `
=== CODEBASE CONTEXT ===
(file tree + grep + contents)
`;
```

**이유**: 기존 코드 상세 분석 필요

---

## 🔄 **Context 로딩 Flow**

### **Code Job (매번 실행)**

```
Plan Node
  ↓
Check: nextTask exists?
  ↓ Yes
Load Context (항상)
  ↓
Explore → Grep → Read
  ↓
LLM에게 전달
```

---

### **Design Job (조건부 실행)**

```
Plan Node
  ↓
Check: hasExistingCode?
  ↓ Yes (Evolution/Refactor)
Load Context
  ↓
Explore → Grep → Read
  ↓
LLM에게 전달

  ↓ No (Greenfield)
Skip Context Loading
  ↓
LLM에게 빈 문자열 전달
```

---

## 💡 **공통 모듈 사용**

### **Import 경로 (동일!)**

```typescript
// Code Job - Plan
import { analyzeContextNeeds } from '../../../../context/analyzer';
import { loadContext } from '../../../../context/loader';

// Design Job - Plan
import { analyzeContextNeeds } from '../../../context/analyzer';
import { loadContext } from '../../../context/loader';
```

**차이점**: 
- Code: `../../../../` (4단계)
- Design: `../../../` (3단계)

**이유**: 디렉토리 깊이 차이
- Code: `graph/code/nodes/plan/`
- Design: `graph/design/nodes/`

---

## 📊 **적용 전 vs 후**

### **Before (레거시)**

```typescript
// Design job - plan.ts
const artifacts = {
  directive: state.directive,
  currentCode: state.code,  // ❌ 전체 codebase (비효율)
  // ...
};
```

**문제**:
- ❌ 전체 codebase 전달 (토큰 낭비)
- ❌ Context 분석 없음
- ❌ Task별 맞춤 없음

---

### **After (리팩토링)**

```typescript
// Design job - plan.ts
let currentCode = state.code;

if (hasExistingCode && gitPort && currentTask) {
  const strategy = analyzeContextNeeds(currentTask, ...);
  const context = await loadContext(strategy, gitPort);
  
  currentCode = `
=== CODEBASE CONTEXT ===
${context.fileTree}        // ~2K tokens
${context.grepResults}     // ~5-10K tokens
${context.fileContents}    // ~30-50K tokens
💡 Available Tools: ...
  `;
}

const artifacts = {
  directive: state.directive,
  currentCode: currentCode,  // ✅ Smart context!
  // ...
};
```

**개선**:
- ✅ Task별 맞춤형 context
- ✅ 토큰 최적화 (~40-65K)
- ✅ UI 피드백 (exploring/grepping/reading)
- ✅ Code job과 동일한 로직

---

## ✅ **결론**

**Design Job에 Context Module 적용 완료!**

1. ✅ **Plan Node**: Smart context pre-loading 추가
2. ✅ **공통 모듈**: `architect/context/` 사용
3. ✅ **조건부 실행**: Evolution/Refactor만
4. ✅ **Code job과 통일**: 동일한 분석 로직

**이제 Code & Design 모두 동일한 Context 로딩 시스템을 사용합니다!** 🚀

