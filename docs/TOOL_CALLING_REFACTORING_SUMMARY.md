# Tool Calling 리팩토링 요약 - 2025-01-20

## 📋 **작업 개요**

사용자가 보고한 문제: Code Job에서 파일이 여러 개 생성될 때 동시에 여러 로딩 카드가 표시되고, 첫 번째 파일만 완료되고 나머지는 로딩 상태로 남는 문제.

**근본 원인:**
- LLM이 한 번의 응답에서 여러 개의 `tool_use` 이벤트를 생성
- ChatService가 모든 `tool_use`에 대해 로딩 카드 생성
- 하지만 `tool` 노드는 첫 번째 tool call만 실행
- 나머지는 드롭되고 LLM이 다음 턴에 다시 결정

---

## 🎯 **해결 방안: 표준 Tool Calling 패턴 적용**

### **핵심 개념**

Anthropic/OpenAI의 표준 Tool Calling 패턴은 **단일-턴 루프 (Single-Turn Loop)**:

```
User: "Create 3 files"
  ↓
LLM: [tool_use(A), tool_use(B), tool_use(C)]  ← 여러 개 제안 가능
  ↓
System: tool_use(A) 실행 (첫 번째만!)  ← 🎯 표준!
  ↓
System → LLM: [tool_result(A)]
  ↓
LLM: [tool_use(B)]  ← 하나씩 다시 결정
  ↓
System: tool_use(B) 실행
  ↓
Done!
```

**핵심:**
- ✅ LLM은 여러 개 tool call을 제안할 수 있음
- ✅ 하지만 시스템은 **첫 번째만 실행**
- ✅ 나머지는 **드롭** (무시)
- ✅ LLM이 다음 턴에 다시 결정

---

## 🔧 **구현된 변경 사항**

### **1. tool.ts - 첫 번째 tool call만 처리**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/tool.ts
// packages/ant-cli/src/agents/architect/graph/design/nodes/tool.ts

export async function tool(state: ArchitectGraphState) {
  const toolCalls = state.llmResponse?.toolCalls || [];
  
  if (toolCalls.length === 0) {
    return {};
  }
  
  // 🎯 CRITICAL: Only process FIRST tool call (Standard Tool Calling pattern)
  const toolCall = toolCalls[0];
  
  // ✅ Log if multiple tool calls were dropped
  if (toolCalls.length > 1) {
    console.log(`   ⚠️  Multiple tool calls detected (${toolCalls.length}), processing FIRST only`);
    console.log(`   ✅ Processing: ${toolCall.name}`);
    console.log(`   ❌ Dropping: ${toolCalls.slice(1).map(tc => tc.name).join(', ')}`);
    console.log(`   💡 LLM will re-decide remaining actions in next turn\n`);
  }
  
  // ... execute first tool only
  
  // ✅ Drop ALL tool calls (standard pattern: LLM re-decides next action)
  const remainingToolCalls: any[] = [];
  
  return {
    conversationHistory: newHistory,
    llmResponse: {
      ...state.llmResponse!,
      toolCalls: remainingToolCalls,  // ✅ All cleared
    },
    // ...
  };
}
```

### **2. codeGen.ts - 첫 번째 tool_use만 UI 전송**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen.ts

// Tool call (감지만, 실행 안함!)
if (event.type === 'tool_use' && event.toolUse) {
  const { id, name, input } = event.toolUse;
  
  console.log(`🔧 [CodeGen] Tool call detected: ${name}`);
  
  // 🎯 CRITICAL: Only send FIRST tool call to UI
  if (toolCalls.length === 0) {
    await chatAPI.sendLLMEvent(event);
    console.log(`   ✅ Sent to UI (first tool call)`);
  } else {
    console.log(`   ⚠️  Skipped UI display (will be dropped by tool node)`);
  }
  
  toolCalls.push({ id, name, args: input });
}
```

### **3. 프롬프트 개선 - Tool Calling 규칙 추가**

**새 파일:** `packages/ant-cli/src/core/prompt/templates/base/tool-calling-rules.md`

```markdown
================================================================================
TOOL CALLING RULES (CRITICAL!)
================================================================================

🎯 **SINGLE TOOL CALL PER TURN**

When using tools, **always emit at most ONE tool_call per turn**.

**WHY?**
- Better user experience (shows progress step-by-step)
- Easier error handling (isolate failures)
- More reliable execution (system processes one at a time)
- Follows standard Tool Calling pattern (Anthropic/OpenAI)

================================================================================
CORRECT PATTERN ✅
================================================================================

**Turn 1:**
<thinking>I need to create 3 files. Let me start with the most important one.</thinking>

I'll create the main App component first.

[tool_call: write_file("src/App.tsx", "...")]

**Turn 2:** (After receiving tool result)
<thinking>App.tsx is created. Now I'll create the index file.</thinking>

Now creating the entry point.

[tool_call: write_file("src/index.tsx", "...")]

================================================================================
WRONG PATTERN ❌
================================================================================

❌ DON'T: Multiple tool calls in one turn
[tool_call: write_file("src/App.tsx", "...")]
[tool_call: write_file("src/index.tsx", "...")]
[tool_call: write_file("src/types.ts", "...")]

**Why this is wrong:**
- System only processes FIRST tool call
- Remaining tool calls are DROPPED
- Confuses the user (shows multiple loading cards)
```

**통합:**
- `FilePromptAdapter.ts`: Handlebars partial로 등록
- `code/phases/execute/rules.md`: `{{> base/tool-calling-rules}}` 참조
- `design/phases/execute/rules.md`: 동일하게 참조

---

## 📝 **추가 작업: MD 파일 실시간 스트리밍 (Code Job)**

### **문제**

사용자 요구사항: MD 파일은 Code Job에서도 Design Job처럼 실시간 렌더링되어야 함.

현재 Code Job은 Tool Calling만 사용해서 모든 파일이 즉시 완료 카드로 표시되고, 실시간 스트리밍이 안 됨.

### **해결책: XML 파서 추가 (Hybrid 방식)**

```
MD 파일:
  LLM → <file path="README.md">content...</file> 
      → XMLStreamParser 
      → CommonRenderStrategy 
      → 실시간 UI 렌더링
      → BufferManager에 저장
  LLM → tool_use: write_file(path="README.md", content="")
      → tool 노드가 버퍼에서 읽어 디스크 저장

기타 파일 (.ts, .tsx 등):
  LLM → tool_use: write_file(path="App.tsx", content="...")
      → tool 노드가 즉시 디스크 저장
```

### **구현된 변경 사항**

1. **codeGen.ts - XML 파서 추가**
   ```typescript
   import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
   import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
   import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';
   import { StreamBufferManager } from '../../../../../core/streaming/buffer/StreamBufferManager';
   
   // BufferManager 초기화
   if (!state._bufferManager) {
     state._bufferManager = new StreamBufferManager(projectPath, featureName, 'code', jobId);
   }
   
   // XML Parser + Orchestrator 설정
   const parser = new XMLStreamParser();
   const renderStrategy = new CommonRenderStrategy(chatAPI, state._bufferManager);
   const orchestrator = new StreamOrchestrator({ parser, renderStrategy, existingFiles });
   
   // 스트림 처리
   for await (const event of llmClient.stream(messages, { tools, ... })) {
     await orchestrator.processEvent(event);  // ✅ XML 파싱
     // ...
   }
   
   await orchestrator.finalize();
   ```

2. **state.ts - 필요한 필드 추가**
   ```typescript
   export interface ArchitectGraphState extends TaskArtifacts {
     // ...
     featureName?: string;  // ✅ For buffer manager initialization
     _bufferManager?: StreamBufferManager;  // ✅ For MD file streaming
   }
   ```

3. **프롬프트 템플릿 정리**

   **기존 구조:**
   ```
   base/output-format-markdown.md  ← 실제 내용
   code/phases/execute/injections/markdown-output-format.md  ← partial 참조
   design/phases/execute/injections/markdown-output-format.md  ← partial 참조
   ```

   **문제:** `markdown-output-format` injection이 자동으로 포함되지 않음!

   **해결:** `ModeController.ts`에 로직 추가
   ```typescript
   if (phase === 'execute') {
     // ✅ Markdown output format (always include for real-time MD file streaming)
     injections.push(`${phasePrefix}/markdown-output-format`);
     // ...
   }
   ```

4. **ChatService.ts - Map 타입 수정**
   ```typescript
   interface ChatSession {
     // ...
     activeFileOperations?: Map<string, { filePath: string; contentIndex: number }>;
   }
   ```

---

## 🔄 **전체 흐름 (Code Job)**

### **일반 파일 (.ts, .tsx, .json 등)**

```
Turn 1:
  LLM → thinking → tool_use: write_file("App.tsx", "...full content...")
  UI: 로딩 카드 생성 (file_creating)
  tool 노드 → 디스크 저장 → UI 업데이트 (file_create)

Turn 2:
  LLM → thinking → tool_use: write_file("index.tsx", "...full content...")
  UI: 로딩 카드 생성 (file_creating)
  tool 노드 → 디스크 저장 → UI 업데이트 (file_create)
```

### **Markdown 파일 (.md)**

```
Turn 1:
  LLM → thinking → <file path="README.md">
                    # Project Title
                    ## Overview
                    ...
                   </file>
  XMLStreamParser → 실시간 파싱
  CommonRenderStrategy → UI 실시간 렌더링 (character-by-character)
  BufferManager → 버퍼에 저장
  
  LLM → tool_use: write_file("README.md", content="")  ← 빈 문자열!
  UI: 로딩 카드 생성 (file_creating)
  tool 노드 → 버퍼에서 읽기 → 디스크 저장 → UI 업데이트 (file_create)
```

---

## 🐛 **해결된 문제들**

### **1. 동시 로딩 카드 문제**

**문제:**
- LLM이 4개의 tool call 생성
- ChatService가 4개의 로딩 카드 생성
- tool 노드는 1개만 실행
- 나머지 3개는 로딩 상태로 남음

**해결:**
- codeGen이 첫 번째 tool_use만 UI로 전송
- tool 노드가 첫 번째만 실행하고 나머지 드롭
- LLM이 다음 턴에 다시 결정

### **2. ChatService Map 타입 에러**

**문제:**
```typescript
activeFileOperations: Map<string, number>  // ❌ 잘못된 타입
```

**해결:**
```typescript
activeFileOperations: Map<string, { filePath: string; contentIndex: number }>  // ✅

// 사용
const activeOp = session.activeFileOperations?.get(filePath);
const contentIndex = activeOp ? activeOp.contentIndex : -1;
```

### **3. State 타입 누락**

**문제:**
- `_bufferManager` 필드가 ArchitectGraphState에 없음
- `featureName` 필드가 없음

**해결:**
```typescript
export interface ArchitectGraphState {
  // ...
  featureName?: string;
  _bufferManager?: StreamBufferManager;
}
```

---

## 📊 **최종 아키텍처**

### **프롬프트 템플릿 구조**

```
base/
├─ tool-calling-rules.md (✅ NEW: 표준 Tool Calling 가이드)
└─ output-format-markdown.md (✅ MD 실시간 렌더링 가이드)

code/phases/execute/
├─ rules.md ({{> base/tool-calling-rules}} 참조)
└─ injections/
   └─ markdown-output-format.md ({{> base/output-format-markdown}} 참조)

design/phases/execute/
└─ injections/
   └─ markdown-output-format.md ({{> base/output-format-markdown}} 참조)
```

### **Tool Calling 흐름**

```
codeGen (LLM 추론)
   ├─ thinking → UI
   ├─ text → UI (또는 XML 파싱)
   └─ tool_use → toolCalls 배열
        ↓
   Router: toolCalls.length > 0 → tool
        ↓
tool (첫 번째만 실행)
   ├─ toolCalls[0] 실행
   ├─ conversationHistory 업데이트
   └─ remainingToolCalls = [] (모두 드롭!)
        ↓
   Router: toolCalls.length === 0 → codeGen (LLM 재호출)
        ↓
codeGen (LLM이 다음 tool call 결정)
   └─ tool_use → toolCalls[0]
        ↓
   (반복...)
```

---

## ✅ **현재 상태**

- ✅ 빌드 성공
- ✅ Tool Calling 표준 패턴 적용
- ✅ 프롬프트 가이드 추가
- ✅ MD 파일 실시간 스트리밍 지원 (Code Job)
- ✅ Design Job 동작 유지
- ✅ Injection 시스템으로 통합 관리

---

## 🧪 **테스트 필요 항목**

1. **Code Job - 일반 파일 생성**
   - 여러 파일 생성 시 하나씩 순차 처리되는지
   - 로딩 카드가 하나씩 표시되는지
   - 모든 파일이 정상적으로 완료되는지

2. **Code Job - MD 파일 생성**
   - MD 파일이 실시간 렌더링되는지
   - 버퍼에서 읽어서 저장되는지
   - Tool calling과 함께 정상 동작하는지

3. **Design Job - 기존 동작**
   - 기존 XML 파싱이 정상 동작하는지
   - MD 파일 실시간 렌더링이 유지되는지

4. **프롬프트 효과**
   - LLM이 tool call을 하나씩 생성하는지
   - 여러 개 생성해도 시스템이 정상 처리하는지

---

## 📚 **참고 문서**

- `packages/ant-cli/XML_FILE_PROCESSING.md` - XML 파일 처리 완전 가이드
- `packages/ant-cli/ARCHITECTURE_CODE_JOB.md` - Code Job 아키텍처
- `packages/ant-cli/CHAT_UI_COMPONENTS.md` - 채팅 UI 컴포넌트
- `packages/ant-cli/CONTEXT_PRELOADING.md` - 컨텍스트 프리로딩

---

## 🔜 **다음 작업**

1. 실제 테스트 수행
2. 에러 발생 시 디버깅
3. LLM이 여전히 여러 tool call을 생성하면 프롬프트 추가 개선
4. 성능 모니터링 (여러 턴 호출로 인한 토큰 사용량 증가 확인)

