# Code Job Architecture (Tool Calling 기반)

> **Last Updated**: 2025-01-19  
> **Version**: 2.0 (Tool Calling Refactoring)

## 📋 Overview

Code Job은 LangGraph 기반의 코드 생성 워크플로우로, **Tool Calling** 패턴을 사용하여 LLM이 필요한 파일만 읽고, 생성된 파일은 즉시 디스크에 저장하는 **점진적 저장(Incremental Saving)** 전략을 채택합니다.

### 핵심 설계 원칙

1. **Single Responsibility Principle (SRP)**: 각 노드는 단일 책임만 가짐
2. **State Machine Philosophy**: LangGraph의 순수한 상태 전이 패턴 준수
3. **Immediate Persistence**: 파일 생성 즉시 디스크 저장 (버퍼링 없음)
4. **Tool Calling First**: LLM이 필요한 정보만 요청하여 토큰 효율성 극대화

---

## 🏗️ Graph Structure

```
__start__
   ↓
resolve (Context 설정)
   ↓
decompose (Task 분해)
   ↓
plan (Task 계획)
   ↓
┌──────────────────────────────────────┐
│  Core Loop: CodeGen ↔ Tool          │
│                                      │
│  codeGen (LLM Reasoning)             │
│    ├─ Tool Call 있음? → tool        │
│    ├─ Done? → validate              │
│    └─ 재추론? → codeGen (self-loop) │
│                                      │
│  tool (Tool Execution)               │
│    ├─ write_file → 즉시 디스크 저장  │
│    ├─ read_file → 파일 읽기         │
│    └─ search_code → 검색            │
│    ↓                                 │
│  codeGen (다시 추론)                 │
└──────────────────────────────────────┘
   ↓
validate (정적 검증: ellipsis, 과도한 삭제)
   ↓
installDeps (npm install)
   ↓
runtimeValidate (빌드/테스트 실행)
   ↓
checkTaskStatus
   ├─ 성공? → learn
   └─ 실패? → enforce → plan (재시도)
   ↓
learn (Incremental Learning)
   ├─ 다음 Task 있음? → plan
   └─ 모두 완료? → __end__
```

---

## 📦 Core Nodes

### 1. `codeGen` (LLM Reasoning Node)

**책임**: 순수 LLM 추론만 담당 (파일 쓰기, Tool 실행 하지 않음!)

**입력**:
- `state.conversationHistory`: 이전 대화 히스토리 (멀티턴)
- `state.currentTask`: 현재 작업
- `state.files`: 파일 트리 (Tool Calling 모드에서는 전체 내용 아님!)

**출력**:
- `state.llmResponse`:
  ```typescript
  {
    thinking: string;
    textResponse: string;
    toolCalls: Array<{ id, name, args }>;
    done: boolean;
  }
  ```

**특징**:
- Tool Calling 활성화: `state.codeMode !== undefined`일 때만
- Design Job에서는 비활성화 (XML 스트리밍 사용)
- 실시간 스트리밍: `thinking`, `text`, `tool_use` 이벤트

**Tool Calling 흐름**:
```typescript
for await (const event of llmClient.stream(messages, { tools })) {
  if (event.type === 'thinking') { ... }
  if (event.type === 'text') { ... }
  if (event.type === 'tool_use') {
    toolCalls.push(event.toolUse); // 실행은 하지 않음!
  }
}
```

### 2. `tool` (Tool Execution Node)

**책임**: 단일 Tool Call 실행 (한 번에 하나씩!)

**지원 Tool**:
1. **`write_file(path, content)`**:
   - ✅ **즉시 디스크 저장** (Cursor/Copilot 스타일)
   - `state.files` 업데이트 (validate 노드용)
   - `state.fileBuffers` 업데이트 (롤백용)
   - UI: `chatAPI.completeFileCreation()` 또는 `completeFileEdit()`
   
2. **`read_file(path)`**:
   - 파일 내용 읽기
   - Tool result로 LLM에게 반환
   - UI 업데이트 없음 (내부 작업)
   
3. **`list_files(directory?, pattern?)`**:
   - 디렉토리 파일 목록
   - Tool result로 LLM에게 반환
   
4. **`search_code(pattern, file_pattern?)`**:
   - 코드베이스 검색
   - Tool result로 LLM에게 반환

**출력**:
- `state.toolResults`: 실행 결과
- `state.conversationHistory`: Tool 호출 + 결과 추가
- `state.files`: `write_file` 실행 시 업데이트

**흐름**:
```typescript
const toolCall = state.llmResponse.toolCalls[0];
switch (toolCall.name) {
  case 'write_file':
    await gitPort.writeFile(path, content);  // ✅ 즉시 저장!
    state.files.push({ path, content });     // ✅ State 업데이트
    await chatAPI.completeFileCreation(path, content);
    break;
  case 'read_file':
    const content = await gitPort.readFile(path);
    return { result: content };
  // ...
}
```

### 3. `routeAfterCodeGen` (Router)

**책임**: CodeGen 응답 분석하여 다음 노드 결정

**라우팅 로직**:
```typescript
if (llmResponse.toolCalls.length > 0) {
  return 'tool';        // Tool 실행 필요
}
if (llmResponse.done) {
  return 'validate';    // 작업 완료 → 검증
}
return 'codeGen';       // 재추론 (드물음)
```

### 4. `validate` → `installDeps` → `runtimeValidate`

기존과 동일 (검증 노드 체인)

### 5. `learn` (Incremental Learning)

**책임**:
- 현재 Task의 learnings 추출
- Vector DB 저장 (비동기, 큐 제한 2개)
- Session 저장
- Report 파일 생성

---

## 🔄 State Management

### Core State Fields

```typescript
interface ArchitectGraphState {
  // ✅ NEW: LLM Response (Tool Calling)
  llmResponse?: {
    thinking: string;
    textResponse: string;
    toolCalls: Array<{ id, name, args }>;
    done: boolean;
  };
  
  // ✅ NEW: Tool Results
  toolResults?: Array<{
    toolCallId: string;
    result: any;
    error?: string;
  }>;
  
  // ✅ NEW: File Buffers (State-level, 노드 로컬 아님!)
  fileBuffers?: Map<string, {
    path: string;
    content: string;
    actionType: 'create' | 'edit' | 'append' | 'delete';
    committed: boolean;  // 디스크 저장 완료 여부
    tempPath?: string;
  }>;
  
  // ✅ NEW: Conversation History (멀티턴)
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string | any[];  // Anthropic 형식 지원
  }>;
  
  // ... 기존 필드들 (taskQueue, currentTask, files, etc.)
}
```

### Conversation History 구조

**멀티턴 대화 예시**:
```typescript
[
  { role: 'user', content: 'Create a React component...' },
  { role: 'assistant', content: 'I will create...' },  // Thinking
  { role: 'assistant', content: [
    { type: 'tool_use', id: 'call_1', name: 'write_file', input: {...} }
  ]},
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_1', content: 'File created' }
  ]},
  { role: 'assistant', content: [
    { type: 'tool_use', id: 'call_2', name: 'write_file', input: {...} }
  ]},
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_2', content: 'File created' }
  ]},
  // ... 계속
]
```

---

## 🎯 Tool Calling vs XML Streaming

| 측면 | Tool Calling (Code Job) | XML Streaming (Design Job) |
|------|-------------------------|----------------------------|
| **파일 생성** | `write_file` tool call | `<file>` 태그 |
| **파일 읽기** | ✅ `read_file` tool | ❌ 불가능 |
| **코드 검색** | ✅ `search_code` tool | ❌ 불가능 |
| **토큰 효율성** | ✅ 높음 (파일 트리만 전송) | ❌ 낮음 (전체 파일 필요) |
| **실시간 렌더링** | ❌ Tool call 완료 후 표시 | ✅ 파일 내용 실시간 스트리밍 |
| **에러 처리** | ✅ 타입 안전 | ⚠️ XML 파싱 실패 가능 |
| **UI 복잡도** | 낮음 (구조화된 이벤트) | 높음 (XML 파싱, 실시간 렌더링) |

**선택 기준**:
- **Code Job**: 대규모 코드베이스, 파일 읽기/검색 필요 → Tool Calling
- **Design Job**: 문서 생성, 실시간 피드백 중요 → XML Streaming

---

## 💾 Immediate Persistence (점진적 저장)

### Cursor/Copilot 스타일 파일 저장

```typescript
// ✅ Tool 노드에서 즉시 디스크 저장
async function handleWriteFile(path: string, content: string) {
  // 1. 즉시 프로젝트 디스크에 저장
  await gitPort.writeFile(path, content);
  console.log(`✅ Saved to disk IMMEDIATELY`);
  
  // 2. State 업데이트 (validate 노드용)
  state.files.push({ path, content });
  
  // 3. 버퍼 업데이트 (롤백용)
  state.fileBuffers.set(path, {
    path, content, actionType: 'create', committed: true
  });
  
  // 4. UI 알림
  await chatAPI.completeFileCreation(path, content);
}
```

### 장점
- ✅ 작업 중단 시에도 파일 보존
- ✅ 실시간 피드백 (디스크에 바로 반영)
- ✅ 메모리 효율적 (버퍼링 최소화)
- ✅ Validate 노드가 실제 파일 사용 가능

### 단점
- ⚠️ 롤백 복잡도 증가 (필요시 `fileBuffers` 사용)
- ⚠️ 파일 내용 실시간 스트리밍 불가능

---

## 🚀 Token Optimization

### 1. Retry 시 컨텍스트 최소화

```typescript
const isRetry = Boolean(state.enforcementReason);

const artifacts = {
  directive: state.directive,
  designDoc: isRetry ? undefined : state.design,      // ❌ Retry시 제외
  prdSpec: isRetry ? undefined : state.prd,           // ❌ Retry시 제외
  currentCode: isRetry 
    ? extractErrorFiles(state)  // ✅ 에러 파일만
    : generateFileTree(state),  // ✅ 파일 트리만
  originalFiles: isRetry ? undefined : state.codeHead, // ❌ Retry시 제외
};
```

### 2. File Tree 전송 (Full Content 대신)

```typescript
function generateFileTree(state: ArchitectGraphState): string {
  return `
=== CODEBASE FILE TREE ===
Total files: ${files.length}

**Available Tools:**
- read_file(path): Read any file
- search_code(pattern): Search codebase

**File Structure:**
src/
  components/
    Button.tsx
    Card.tsx
  utils/
    api.ts
    
💡 Tip: Use read_file() to see contents before modifying.
  `;
}
```

**토큰 절감**:
- Before: 50 files × 200 lines × 50 chars = ~500K tokens
- After: File tree ~2K tokens
- **절감율: 99.6%** 🎉

---

## 📊 UI Event Flow

### LLM Event → UI

```
LLM Stream (Anthropic)
  ↓
AnthropicLLMClient.stream()
  ├─ thinking_delta → LLMStreamEvent{type:'thinking'}
  ├─ text_delta → LLMStreamEvent{type:'text'}
  └─ tool_use → LLMStreamEvent{type:'tool_use', toolUse:{...}}
  ↓
codeGen Node
  ↓
chatAPI.sendLLMEvent(event)
  ↓
ChatService.handleLLMStreamEvent()
  ├─ 'thinking' → addContentToCurrentMessage({type:'thinking'})
  ├─ 'text' → addContentToCurrentMessage({type:'text'})
  └─ 'tool_use' → addContentToCurrentMessage({
       type:'text', 
       content:'🔧 Tool Call: read_file\n```json\n{...}\n```'
     })
  ↓
SSE Broadcast → Frontend
```

### Tool Result → UI

```
tool Node
  ↓
handleWriteFile(path, content)
  ├─ gitPort.writeFile() → 디스크 저장
  ├─ state.files.push() → State 업데이트
  └─ chatAPI.completeFileCreation() → UI 알림
  ↓
ChatService.addFileOperation(phase='complete')
  ↓
SSE Broadcast → Frontend (File Card 표시)
```

---

## 🔧 Tool Registry

```typescript
// Available Tools for Code Job
const tools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read file contents',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: 'Search codebase',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        file_pattern: { type: 'string', description: 'File filter (optional)' },
      },
      required: ['pattern'],
    },
  },
];
```

---

## 📝 Session Management

### Checkpoint Structure

```json
{
  "state": {
    "taskQueue": [...],
    "completedTasks": ["task-1", "task-2"],
    "currentTask": null,
    "files": [...],
    "conversationHistory": [...],
    "llmResponse": {...},
    "toolResults": [...]
  }
}
```

### Resume Logic

1. `decompose` 노드에서 checkpoint 로드
2. `conversationHistory` 복원 → LLM이 이전 대화 이어감
3. `taskQueue` 복원 → 다음 Task부터 진행
4. `files` 복원 → 이미 생성된 파일 확인

---

## 🎓 Best Practices

### 1. Tool Call은 한 번에 하나씩
```typescript
// ✅ Good
const toolCall = state.llmResponse.toolCalls[0];  // 첫 번째만 처리
await executeTool(toolCall);

// ❌ Bad
for (const toolCall of state.llmResponse.toolCalls) {
  await executeTool(toolCall);  // Loop 하지 마세요!
}
```

### 2. State는 Immutable Update
```typescript
// ✅ Good
const files = [...state.files, newFile];
return { files };

// ❌ Bad
state.files.push(newFile);
return {};
```

### 3. 노드는 Pure Function
```typescript
// ✅ Good: 노드는 state만 업데이트
export async function codeGen(state) {
  const llmResponse = await llm.stream(...);
  return { llmResponse };  // State 업데이트만
}

// ❌ Bad: 노드가 직접 파일 저장
export async function codeGen(state) {
  const code = await llm.stream(...);
  await fs.writeFile(path, code);  // ❌ Side effect!
  return {};
}
```

### 4. Conversation History는 Anthropic 형식
```typescript
// ✅ Good
conversationHistory.push({
  role: 'assistant',
  content: [
    { type: 'tool_use', id: 'call_1', name: 'read_file', input: {...} }
  ]
});
conversationHistory.push({
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: 'call_1', content: '...' }
  ]
});

// ❌ Bad
conversationHistory.push({
  role: 'assistant',
  content: 'I will use read_file tool'  // ❌ Tool 호출을 텍스트로!
});
```

---

## 🔮 Future Improvements

1. **Rollback Mechanism**: `fileBuffers`를 활용한 작업 취소
2. **Parallel Tool Calls**: 독립적인 tool 병렬 실행
3. **Streaming Tool Results**: 대용량 파일 읽기 시 스트리밍
4. **Caching**: 반복 읽는 파일 캐싱

---

## 📚 Related Docs

- [Design Job Architecture](./ARCHITECTURE_DESIGN_JOB.md)
- [Chat UI Components](./CHAT_UI_COMPONENTS.md)
- [LangGraph State Machine](https://langchain-ai.github.io/langgraph/)

