# Explain Mode 전체 흐름 분석

## 🔄 전체 Graph 구조

```
__start__
   ↓
resolve (mode inference)
   ↓
detectEnvironment (environment + RAG decision)
   ↓
decompose (task breakdown)
   ↓
plan (load code context)
   ↓
codeGen (LLM reasoning)
   ↓ [router]
tool / checkTaskStatus / installDeps / __end__
```

---

## 💡 Explain Mode 흐름

### 1️⃣ **Resolve Node** (Mode Inference)

```typescript
// resolve.ts
const modeEngine = new ModeInferenceEngine();
const result = await modeEngine.infer({
  directive: "Explain Button component"
}, llmClient);

// result.mode = 'explain'
state.mode = 'explain';
```

**산출물:**
```typescript
{
  mode: 'explain',
  codeMode: 'explain'
}
```

**Edge:** `resolve → detectEnvironment`

---

### 2️⃣ **DetectEnvironment Node**

```typescript
// detectEnvironment.ts
// LLM 호출로 environment 분석
const response = await llm.invoke(prompt);

// 산출물
{
  detectedEnvironment: 'frontend',
  requireRagForDecompose: true,  // 설명할 코드가 필요하므로 true
  decomposeKeywords: {
    codebase: ['button', 'component', 'react'],
    references: []
  }
}
```

**Edge:** `detectEnvironment → decompose`

---

### 3️⃣ **Decompose Node** ⚡ **조기 리턴!**

```typescript
// decompose/index.ts (line 68)
if (state.mode === 'explain') {
  console.log('💡 [Decompose] Explain mode - creating single explanation task\n');
  
  const explainTask = {
    id: 'explain-1',
    name: 'Explain code',
    type: 'explain',
    priority: 200,
    description: state.directive  // "Explain Button component"
  };
  
  const taskQueue = new TaskQueue();
  taskQueue.push(explainTask);
  
  return {
    ...state,
    taskQueue,               // ✅ 1개 task만!
    totalSubtasks: 1,
    projectCodeContext: undefined,  // ❌ 여기선 로드 안 함
    referenceCodeContexts: []
  };
}
```

**🎯 핵심:**
- ✅ LLM 호출 **안 함** (빠름!)
- ✅ 단일 explain task 자동 생성
- ✅ `projectCodeContext` 여기선 **비움** (plan에서 로드)

**Edge:** `decompose → plan`

---

### 4️⃣ **Plan Node** (Code Loading)

```typescript
// plan/index.ts
const nextTask = state.taskQueue.pop();
// nextTask = { id: 'explain-1', type: 'explain', ... }

// STEP 1: 키워드 생성
const taskKeywords = await generateTaskKeywords(llm, nextTask, state);
// keywords.codebase = ['button component', 'react', 'props']

// STEP 2: RAG 검색 (설명할 코드 로드)
const projectCodeContext = await retriever.retrieve(
  keywords.codebase.join(' '),
  workingDir,
  { maxTokens: 30000, maxFiles: 8 }
);
// projectCodeContext.files = [
//   { path: 'src/components/Button.tsx', content: '...' },
//   { path: 'src/components/Button.test.tsx', content: '...' }
// ]

return {
  currentTask: nextTask,
  projectCodeContext,       // ✅ 설명할 코드 로드됨!
  referenceCodeContexts: []
};
```

**🎯 핵심:**
- ✅ Task-specific keywords 생성
- ✅ **설명할 코드를 RAG로 검색**
- ✅ `projectCodeContext`에 로드

**Edge:** `plan → codeGen`

---

### 5️⃣ **CodeGen Node** (실제 설명 생성)

```typescript
// codeGen.ts

// Tool 비활성화
const isExplainMode = state.codeMode === 'explain';
const enableTools = !isExplainMode;  // false!

// PromptEngine으로 프롬프트 생성
const promptResult = await promptEngine.buildExecutePrompt(
  'code',
  state.context,
  {
    directive: "Explain Button component",
    projectCodeContext: {
      files: [
        { path: 'src/components/Button.tsx', content: '...' }
      ]
    },
    currentTask: { type: 'explain', ... }
  },
  'explain',  // mode
  'explain'   // taskType
);

// 프롬프트 내용:
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ## 💡 EXPLAIN TASK: Code Explanation
//
// **YOU MUST:**
// - ✅ Write a clear Markdown explanation
// - ✅ Output <done>true</done>
//
// **YOU MUST NOT:**
// - ❌ Use <tool_use>
// - ❌ Use <edit>
//
// ## 📦 Retrieved Codebase Context
// File: `src/components/Button.tsx`
// ```
// import React from 'react';
// export function Button({ children, onClick }) { ... }
// ```
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// LLM 호출 (tools 없음!)
const response = await llm.invoke(messages, {
  tools: undefined  // ❌ No tools!
});

// LLM 응답:
textResponse = `
# Button Component 설명

## 개요
Button 컴포넌트는 재사용 가능한 React 버튼입니다...

## Props
- children: ReactNode
- onClick: () => void

## 사용 예시
\`\`\`tsx
<Button onClick={() => alert('clicked')}>
  Click me
</Button>
\`\`\`

<done>true</done>
`;

// Validation
if (isExplainMode && toolCalls.length > 0) {
  throw new Error('Explain mode should not use tools!');
}

return {
  llmResponse: {
    textResponse,  // 설명 텍스트
    toolCalls: [], // ✅ 비어있음
    done: true     // ✅ 완료!
  }
};
```

**Edge:** `codeGen → router → checkTaskStatus`

---

### 6️⃣ **CheckTaskStatus Node** (완료 처리)

```typescript
// checkTaskStatus
if (response.done && !hasViolations) {
  console.log('✅ Task "Explain code" completed!');
  
  completedTasks.push('explain-1');
  state.conversationHistory = [];  // 대화 초기화
  
  // 다음 task 체크
  const nextTask = state.taskQueue.pop();
  
  if (!nextTask) {
    console.log('🎉 All tasks done!');
    return '__end__';  // ✅ 종료!
  }
}
```

**Edge:** `checkTaskStatus → __end__`

---

## 📺 사용자 관점에서 보는 UI 흐름

### 1. **사용자 입력**
```
사용자: "Explain Button component"
```

### 2. **Chat UI에 표시**

```markdown
🤖 Analyzing...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Button Component 설명

## 개요
Button 컴포넌트는 재사용 가능한 React 버튼입니다.
클릭 이벤트를 처리하고 children을 렌더링합니다.

## Props
- **children**: ReactNode - 버튼에 표시할 내용
- **onClick**: () => void - 클릭 시 실행할 함수

## 사용 예시
\`\`\`tsx
<Button onClick={() => alert('clicked')}>
  Click me
</Button>
\`\`\`

## 구현 세부사항
이 컴포넌트는 Tailwind CSS를 사용하여 스타일링됩니다...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 완료!
```

### 3. **파일 시스템 변경**
```
❌ 파일 생성/수정 없음!
✅ 채팅창에만 설명 표시
```

---

## ⚡ Decompose "스킵"의 의미

### ❌ 오해: "Decompose 노드를 건너뜀"
```
resolve → detectEnvironment → [SKIP] → plan
```
**이건 아닙니다!**

### ✅ 실제: "Decompose 노드는 실행되지만 LLM 호출 안 함"
```
resolve → detectEnvironment → decompose (조기 리턴) → plan
```

**Decompose 노드 내부:**
```typescript
if (state.mode === 'explain') {
  // ✅ 노드는 실행됨
  // ✅ 단일 task 자동 생성
  // ❌ LLM 호출 안 함 (시간 절약!)
  return { taskQueue: [explainTask] };
}

// Generate/Refactor는 여기로 옴
const prompt = await buildDecomposePrompt(...);
const tasks = await callLLMForDecompose(llm, prompt);
```

---

## 🎯 정리

### Explain Mode 실행 흐름

| 단계 | 노드 | 동작 | 산출물 |
|------|------|------|--------|
| 1 | `resolve` | Mode inference | `mode = 'explain'` |
| 2 | `detectEnvironment` | LLM 분석 | `requireRagForDecompose = true` |
| 3 | `decompose` | **조기 리턴** (LLM X) | 1개 explain task |
| 4 | `plan` | RAG 검색 | 설명할 코드 로드 |
| 5 | `codeGen` | LLM 설명 생성 (tools OFF) | Markdown 응답 |
| 6 | `checkTaskStatus` | 완료 처리 | `__end__` |

### 사용자 관점

```
입력: "Explain Button component"
   ↓
[백엔드 처리 중...]
   ↓
출력: 채팅창에 Markdown 설명 표시
   ↓
결과: 파일 변경 없음, 설명만 제공
```

**핵심: CodeGen 노드가 채팅창에 설명을 출력합니다!** ✅

