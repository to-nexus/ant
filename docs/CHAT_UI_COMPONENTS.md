# Chat UI Components 체계

> **Last Updated**: 2025-01-19  
> **Version**: 2.0 (Tool Calling 추가)

## 📋 Overview

Ant CLI의 채팅 UI는 23개의 컴포넌트 타입으로 구성되어 있으며, 각 컴포넌트는 실시간 스트리밍 또는 완료 후 표시 방식으로 렌더링됩니다.

---

## 🎯 전체 컴포넌트 목록

| # | Type | 역할 | 파싱/생성 | 렌더링 방식 | 실시간 여부 |
|---|------|------|-----------|------------|------------|
| **1. LLM 추론 컴포넌트** |
| 1 | `placeholder` | 초기 로딩 상태 | `ChatAPIClient.showChatStatus()` | Loading spinner | ❌ 상태만 |
| 2 | `thinking` | LLM 사고 과정 | `LLMStreamEvent{type:'thinking'}` | Thinking block (collapsible) | ✅ 실시간 |
| 3 | `text` | 일반 텍스트 응답 | `LLMStreamEvent{type:'text'}` | Markdown | ✅ 실시간 |
| **2. Tool Calling 컴포넌트** (NEW - v2.0) |
| 4 | `text` (tool call) | Tool 호출 알림 | `LLMStreamEvent{type:'tool_use'}` | Code block with JSON | ❌ 한번에 표시 |
| **3. 코드베이스 탐색 컴포넌트** |
| 5 | `exploring` | 탐색 진행중 | `ChatAPIClient.showExploring()` | Progress indicator | ✅ 진행률 |
| 6 | `explored` | 탐색 완료 | `ChatAPIClient.completeExploring()` | Summary card (파일수, 토큰수) | ❌ 완료시 |
| 7 | `grepping` | 검색 진행중 | `ChatAPIClient.showGrepping()` | Progress indicator | ✅ 진행률 |
| 8 | `grepped` | 검색 완료 | `ChatAPIClient.completeGrepping()` | Summary card (전략, 파일목록) | ❌ 완료시 |
| 9 | `reading` | 파일 읽기 진행중 | `ChatAPIClient.showReading()` | File name badge | ✅ 개별 파일 |
| 10 | `read` | 파일 읽기 완료 | `ChatAPIClient.completeReading()` | File list card | ❌ 완료시 |
| **4. 파일 작업 컴포넌트** |
| 11 | `file_creating` | 파일 생성 시작 | `addFileOperation(phase='creating')` | File card header | ❌ 상태만 |
| 12 | `file_writing` | 파일 쓰기 중 | `addFileOperation(phase='writing')` | File card + content | ✅ 실시간 |
| 13 | `file_create` | 파일 생성 완료 | `addFileOperation(phase='complete')` | Final file card | ❌ 완료시 |
| 14 | `file_editing` | 파일 수정 시작 | `addFileOperation(phase='editing')` | File card header | ❌ 상태만 |
| 15 | `file_updating` | 파일 수정 중 | `addFileOperation(phase='updating')` | Diff view (before/after) | ✅ 실시간 |
| 16 | `file_edit` | 파일 수정 완료 | `addFileOperation(phase='complete')` | Final diff card | ❌ 완료시 |
| 17 | `file_deleting` | 파일 삭제 중 | `addFileOperation(phase='deleting')` | Delete indicator | ❌ 상태만 |
| 18 | `file_delete` | 파일 삭제 완료 | `addFileOperation(phase='complete')` | Delete confirmation | ❌ 완료시 |
| **5. 명령어 실행 컴포넌트** |
| 19 | `command_running` | 명령 실행 시작 | `addCommandExecution(phase='running')` | Command badge | ❌ 상태만 |
| 20 | `command_streaming` | 명령 출력 중 | `addCommandExecution(phase='streaming')` | Terminal output | ✅ 실시간 |
| 21 | `command` | 명령 실행 완료 | `addCommandExecution(phase='complete')` | Final terminal card | ❌ 완료시 |
| **6. 시스템 상태 컴포넌트** |
| 22 | `cancelled` | 작업 취소됨 | `ChatService.addCancelledMessage()` | Resume button card | ❌ 시스템 |
| 23 | `error` | 에러 발생 | `LLMStreamEvent{type:'error'}` 또는 `addJobError()` | Error alert | ❌ 시스템 |

---

## 🏗️ 컴포넌트 분류 체계

```
┌─────────────────────────────────────────────────────────────┐
│                    Chat Message Structure                    │
│  ChatMessage { contents: MessageContent[] }                  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
   ✅ LLM Events                          ✅ Agent Actions
  (실시간 스트리밍)                        (완료 후 표시)
```

---

## 📊 상세 컴포넌트 분석

### 1️⃣ LLM 추론 컴포넌트

#### 1.1. `placeholder`

**역할**: LLM 시작 전 초기 로딩 상태 표시

**파싱/생성**:
```typescript
await chatAPI.showChatStatus('placeholder');
```

**UI 렌더링**:
- Loading spinner
- 텍스트: "AI is thinking..."

**특징**:
- 실시간 스트리밍 아님 (단순 상태 표시)
- `thinking` 또는 `text` 이벤트가 오면 자동으로 대체됨

#### 1.2. `thinking`

**역할**: LLM의 사고 과정 (Reasoning) 표시

**파싱/생성**:
```typescript
// LLM Stream에서 생성
for await (const event of llmClient.stream(messages)) {
  if (event.type === 'thinking') {
    await chatAPI.sendLLMEvent(event);  // → ChatService
  }
}

// ChatService에서 처리
case 'thinking':
  this.addContentToCurrentMessage(projectId, featureName, {
    type: 'thinking',
    content: event.content,
    metadata: {
      blockStart: event.metadata?.blockStart,  // <thinking> 태그 열림
      durationMs: event.metadata?.durationMs   // 사고 시간
    }
  });
```

**UI 렌더링**:
- Collapsible block (접기/펼치기 가능)
- 배경색: 연한 회색 또는 연한 파란색
- 아이콘: 🤔 또는 💭
- 실시간 스트리밍 (character-by-character)

**메타데이터**:
- `blockStart`: `true`면 새로운 thinking 블록 시작 (이전 블록 닫힘)
- `durationMs`: Thinking 블록 완료 시 소요 시간

**예시**:
```
💭 Thinking...
I need to create a React component with TypeScript...
[내용 더보기 ▼]
```

#### 1.3. `text`

**역할**: LLM의 일반 텍스트 응답

**파싱/생성**:
```typescript
// LLM Stream에서 생성
for await (const event of llmClient.stream(messages)) {
  if (event.type === 'text') {
    await chatAPI.sendLLMEvent(event);
  }
}

// ChatService에서 처리
case 'text':
  // ✅ Active file operation이 있으면 파일 카드에 스트리밍
  if (session?.activeFileOperation) {
    const fileContent = session.currentMessage.contents[
      session.activeFileOperation.contentIndex
    ];
    fileContent.content += event.content;  // 실시간 누적
    
    this.broadcast(projectId, featureName, {
      type: 'content_append',
      messageId: session.currentMessage.id,
      contentIndex: session.activeFileOperation.contentIndex,
      delta: event.content  // ✅ 델타만 전송 (네트워크 효율)
    });
  } else {
    // 일반 텍스트로 추가
    this.addContentToCurrentMessage(projectId, featureName, {
      type: 'text',
      content: event.content
    });
  }
```

**UI 렌더링**:
- Markdown 형식 지원 (코드 블록, 링크, 리스트 등)
- 실시간 스트리밍 (character-by-character)
- 텍스트 선택 및 복사 가능

**특수 케이스**:
- **Active File Operation**: 파일 작업 중(`file_writing` 또는 `file_updating`)이면 `text` 이벤트가 파일 카드 내부로 스트리밍됨
- 일반 응답: 파일 작업이 없으면 일반 Markdown 텍스트로 표시

---

### 2️⃣ Tool Calling 컴포넌트 (NEW)

#### 2.1. `text` (tool call)

**역할**: LLM이 Tool 호출을 요청했음을 알림

**파싱/생성**:
```typescript
// LLM Stream에서 tool_use 이벤트 감지
for await (const event of llmClient.stream(messages, { tools })) {
  if (event.type === 'tool_use' && event.toolUse) {
    await chatAPI.sendLLMEvent(event);
  }
}

// ChatService에서 처리
case 'tool_use':
  if (event.toolUse) {
    this.addContentToCurrentMessage(projectId, featureName, {
      type: 'text',  // ✅ 'text' 타입으로 표시 (기존 UI 재사용)
      content: `🔧 **Tool Call**: \`${event.toolUse.name}\`
\`\`\`json
${JSON.stringify(event.toolUse.input, null, 2)}
\`\`\``
    });
  }
  break;
```

**UI 렌더링**:
- 아이콘: 🔧
- Tool 이름: `read_file`, `write_file`, etc.
- 인자: JSON 형태로 코드 블록 내 표시
- **한번에 완전한 형태로 표시** (스트리밍 불가)

**예시**:
```
🔧 Tool Call: read_file
```json
{
  "path": "src/components/Button.tsx"
}
```
```

**특징**:
- Tool 실행 결과는 UI에 표시되지 않음 (LLM에게만 전달)
- `write_file` tool의 결과는 별도 파일 카드로 표시됨

---

### 3️⃣ 코드베이스 탐색 컴포넌트

#### 3.1. `exploring` / `explored`

**역할**: 코드베이스 전체 탐색 (Exploration)

**파싱/생성**:
```typescript
// Exploring (진행중)
await chatAPI.showExploring(totalFiles);

// Explored (완료)
await chatAPI.completeExploring(filesCount, tokensCount, filesList);
```

**UI 렌더링**:
- **Exploring**: Progress bar 또는 spinner
- **Explored**: Summary card
  - "Explored {filesCount} files ({tokensCount} tokens)"
  - 파일 목록 접기/펼치기

#### 3.2. `grepping` / `grepped`

**역할**: 코드베이스 검색 (Grep/Vector Search)

**파싱/생성**:
```typescript
// Grepping (진행중)
await chatAPI.showGrepping(totalFiles);

// Grepped (완료)
await chatAPI.completeGrepping(strategy, filesCount, filesList);
```

**UI 렌더링**:
- **Grepping**: Progress bar
- **Grepped**: Summary card
  - "Found {filesCount} files (using {strategy})"
  - 파일 목록 (클릭 시 파일 열림)

#### 3.3. `reading` / `read`

**역할**: 개별 파일 읽기

**파싱/생성**:
```typescript
// Reading (진행중)
await chatAPI.showReading(filePath);

// Read (완료)
await chatAPI.completeReading(filesList);
```

**UI 렌더링**:
- **Reading**: File name badge (여러 파일 동시 표시 가능)
- **Read**: File list card

---

### 4️⃣ 파일 작업 컴포넌트

#### 4.1. 파일 생성: `file_creating` → `file_writing` → `file_create`

**Phase 1: `file_creating` (시작)**

```typescript
await chatAPI.startFileCreation(filePath);

// → addFileOperation(operation='create', phase='creating')
```

**UI**: File card header 표시
```
📄 Creating: src/components/Button.tsx
```

**Phase 2: `file_writing` (쓰기 중)**

```typescript
// XML Parser에서 실시간 파싱
<file path="src/components/Button.tsx">
import React from 'react';

export const Button = ...
</file>

// → CommonRenderStrategy.renderFileContent()
// → addFileOperation(operation='create', phase='writing', content=...)
```

**UI**: 파일 내용 실시간 스트리밍
```
📄 src/components/Button.tsx
┌─────────────────────────────────┐
│ import React from 'react';      │ ← 실시간 타이핑
│                                 │
│ export const Button = ...       │
└─────────────────────────────────┘
```

**Phase 3: `file_create` (완료)**

```typescript
await chatAPI.completeFileCreation(filePath, content);

// → addFileOperation(operation='create', phase='complete')
```

**UI**: 최종 파일 카드 (확인 체크)
```
✅ Created: src/components/Button.tsx (245 lines)
```

#### 4.2. 파일 수정: `file_editing` → `file_updating` → `file_edit`

**Phase 1: `file_editing` (시작)**

```typescript
await chatAPI.startFileEdit(filePath);
```

**UI**: File card header
```
✏️ Editing: src/components/Button.tsx
```

**Phase 2: `file_updating` (수정 중)**

```typescript
// XML Parser에서 <edit> 파싱
<edit path="src/components/Button.tsx">
<search>export const Button = ...</search>
<replace>export const Button = () => {...}</replace>
</edit>

// → addFileOperation(operation='edit', phase='updating', diffBefore, diffAfter)
```

**UI**: Diff view (before/after)
```
✏️ src/components/Button.tsx
┌─────────────────────────────────┐
│ - export const Button = ...     │ ← 삭제 (빨강)
│ + export const Button = () => { │ ← 추가 (초록)
│ +   return <button>...</button> │
│ + }                             │
└─────────────────────────────────┘
```

**Phase 3: `file_edit` (완료)**

```typescript
await chatAPI.completeFileEdit(filePath, diffBefore, diffAfter);
```

**UI**: 최종 diff card (확인 체크)
```
✅ Edited: src/components/Button.tsx (+15, -3)
```

#### 4.3. 파일 삭제: `file_deleting` → `file_delete`

**Phase 1: `file_deleting` (삭제 중)**

```typescript
// XML Parser에서 <delete> 파싱
<delete path="src/legacy/OldButton.tsx" />
```

**UI**: Delete indicator
```
🗑️ Deleting: src/legacy/OldButton.tsx
```

**Phase 2: `file_delete` (완료)**

```typescript
await chatAPI.completeFileDeletion(filePath);
```

**UI**: Delete confirmation
```
✅ Deleted: src/legacy/OldButton.tsx
```

---

### 5️⃣ 명령어 실행 컴포넌트

#### 5.1. `command_running` → `command_streaming` → `command`

**Phase 1: `command_running` (시작)**

```typescript
await chatAPI.startCommandExecution(command);

// → addCommandExecution(command, phase='running')
```

**UI**: Command badge
```
⚡ Running: npm install
```

**Phase 2: `command_streaming` (출력 중)**

```typescript
// Command Port에서 stdout/stderr 스트리밍
commandPort.execute(command, {
  onStdout: (output) => {
    chatAPI.streamCommandOutput(command, output);
  }
});

// → addCommandExecution(command, output, phase='streaming')
```

**UI**: Terminal output (실시간)
```
⚡ npm install
┌─────────────────────────────────┐
│ added 1234 packages in 5.2s     │ ← 실시간 출력
│ ...                             │
└─────────────────────────────────┘
```

**Phase 3: `command` (완료)**

```typescript
await chatAPI.completeCommandExecution(command, output, exitCode);

// → addCommandExecution(command, output, exitCode, phase='complete')
```

**UI**: Final terminal card (exit code 표시)
```
✅ npm install (exit code: 0)
┌─────────────────────────────────┐
│ added 1234 packages in 5.2s     │
│ ...                             │
└─────────────────────────────────┘
```

---

### 6️⃣ 시스템 상태 컴포넌트

#### 6.1. `cancelled`

**역할**: 작업이 취소되었음을 표시 (Resume 가능)

**파싱/생성**:
```typescript
chatService.addCancelledMessage(
  projectId,
  featureName,
  jobId,
  reason,
  message,
  userContext
);
```

**UI 렌더링**:
```
🛑 Task Cancelled

The job was cancelled (reason: User interruption)

[Resume Task] 버튼
```

**특징**:
- `jobId`를 metadata에 저장하여 Resume 시 사용
- Resume 버튼 클릭 시 동일 `jobId`로 작업 재개

#### 6.2. `error`

**역할**: 에러 발생 표시

**파싱/생성**:
```typescript
// 1. LLM Stream에서 에러
for await (const event of llmClient.stream(messages)) {
  if (event.type === 'error') {
    await chatAPI.sendLLMEvent(event);
  }
}

// 2. Job 실패
chatService.addJobError(
  projectId,
  featureName,
  jobId,
  errorMessage,
  errorDetails
);
```

**UI 렌더링**:
```
❌ Job Failed

Error: Build failed with 3 errors

Details:
{
  "file": "src/App.tsx",
  "error": "Type error: ..."
}
```

**특징**:
- 빨간색 alert 박스
- Error details는 접기/펼치기 가능
- 코드 블록으로 표시

---

## 🔄 파싱/렌더링 흐름

### Design Job (XML 기반)

```
LLM Stream (XML)
  ↓
XMLStreamParser.parse()
  ├─ <thinking> → ParsedAction{type:'thinking'}
  ├─ <file path="...">content</file> → ParsedAction{type:'file_start/content/end'}
  ├─ <edit path="..."><search>...</search><replace>...</replace></edit>
  └─ text → ParsedAction{type:'response'}
  ↓
CommonRenderStrategy.render()
  ├─ thinking → chatAPI.sendLLMEvent({type:'thinking'})
  ├─ file_start → chatAPI.startFileCreation(path)
  ├─ file_content → chatAPI.sendLLMEvent({type:'text'})  // Active file로 스트리밍
  ├─ file_end → chatAPI.completeFileCreation(path, content)
  └─ response → chatAPI.sendLLMEvent({type:'text'})
  ↓
ChatService
  ├─ handleLLMStreamEvent()  // thinking, text 처리
  └─ addFileOperation()      // file_* 처리
  ↓
SSE Broadcast → Frontend
```

### Code Job (Tool Calling 기반)

```
LLM Stream (Tool Calling)
  ↓
AnthropicLLMClient.stream({tools})
  ├─ thinking_delta → LLMStreamEvent{type:'thinking'}
  ├─ text_delta → LLMStreamEvent{type:'text'}
  └─ tool_use → LLMStreamEvent{type:'tool_use', toolUse:{id, name, input}}
  ↓
codeGen Node (LLM 추론만)
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
tool Node (도구 실행)
  ├─ write_file → 
  │    ├─ gitPort.writeFile() (디스크 저장)
  │    └─ chatAPI.completeFileCreation() (UI 알림)
  ├─ read_file → 
  │    └─ gitPort.readFile() (LLM에게만 전달, UI 없음)
  └─ search_code → 
       └─ gitPort.search() (LLM에게만 전달, UI 없음)
  ↓
ChatService.addFileOperation(phase='complete')
  ↓
SSE Broadcast → Frontend
```

---

## ⚖️ Design Job vs Code Job 비교

| 측면 | Design Job (XML) | Code Job (Tool Calling) |
|------|------------------|-------------------------|
| **파일 생성 방식** | `<file>` 태그 스트리밍 | `write_file` tool call |
| **실시간 렌더링** | ✅ 파일 내용 실시간 | ❌ Tool call 완료 후 |
| **파일 읽기** | ❌ 불가능 | ✅ `read_file` tool |
| **코드 검색** | ❌ 불가능 | ✅ `search_code` tool |
| **UI 복잡도** | 높음 (XML 파싱 + 실시간) | 낮음 (구조화된 이벤트) |
| **토큰 효율성** | 낮음 (전체 파일 필요) | ✅ 높음 (파일 트리만) |

---

## 🎨 UI 컴포넌트 역할 구분

### 1. **LLM Event Handler** (`handleLLMStreamEvent`)

**역할**: LLM에서 오는 모든 스트리밍 이벤트 처리

**대상 이벤트**:
- `thinking`: LLM 사고 과정
- `text`: 일반 텍스트 응답
- `tool_use`: Tool 호출 요청 (NEW)
- `error`: 에러 발생
- `done`: 스트림 완료

**특징**:
- 실시간 스트리밍
- Active file operation 감지 (text 이벤트를 파일 카드로 라우팅)

### 2. **File Operation Handler** (`addFileOperation`)

**역할**: 파일 생성/수정/삭제의 전체 라이프사이클 관리

**Phase 흐름**:
```
create: creating → writing → complete
edit:   editing → updating → complete
delete: deleting → complete
```

**특징**:
- Phase별 UI 상태 전환
- 실시간 content 업데이트 (writing/updating)
- Delta 전송으로 네트워크 효율화

### 3. **Command Execution Handler** (`addCommandExecution`)

**역할**: 터미널 명령 실행 및 출력 스트리밍

**Phase 흐름**:
```
running → streaming → complete
```

**특징**:
- 터미널 출력 실시간 표시
- Exit code 표시

### 4. **Tool Call Handler** (NEW)

**역할**: LLM의 tool 호출 요청 표시

**방식**:
- `handleLLMStreamEvent` 내 `tool_use` 케이스
- JSON 형태로 tool 이름과 인자 표시

**특징**:
- 한번에 완전한 형태로 표시 (스트리밍 불가)
- Tool 실행 결과는 별도 UI 컴포넌트 (예: file_create)

---

## 📊 메타데이터 구조

### MessageContent 인터페이스

```typescript
interface MessageContent {
  type: MessageContentType;
  content: string;
  metadata?: {
    // 파일 관련
    filePath?: string;
    diffBefore?: string;
    diffAfter?: string;
    
    // 명령 관련
    command?: string;
    exitCode?: number;
    
    // 탐색 관련
    filesCount?: number;
    totalFiles?: number;
    tokensCount?: number;
    strategy?: string;       // 'git' | 'vector' | 'keyword'
    filesList?: string[];
    
    // LLM 관련
    model?: string;
    provider?: string;
    blockStart?: boolean;    // Thinking 블록 시작
    durationMs?: number;     // Thinking 지속 시간
    
    // 시스템 관련
    jobId?: string;          // Cancelled에서 사용
    reason?: string;         // Cancelled/Error 이유
    timestamp?: string;
  };
}
```

---

## 🚀 최적화 기법

### 1. **Delta 전송** (content_append)

파일 쓰기 중 변경된 부분(delta)만 전송하여 네트워크 효율화:

```typescript
// ✅ Delta only
this.broadcast(projectId, featureName, {
  type: 'content_append',
  messageId: session.currentMessage.id,
  contentIndex: session.activeFileOperation.contentIndex,
  delta: event.content  // 새로 추가된 부분만
});

// ❌ Full content (비효율)
this.broadcast(projectId, featureName, {
  type: 'content_update',
  content: fullContent  // 전체 내용 재전송
});
```

### 2. **Active File Operation Tracking**

현재 쓰기 중인 파일을 추적하여 `text` 이벤트를 올바른 파일 카드로 라우팅:

```typescript
interface ChatSession {
  activeFileOperation?: {
    filePath: string;
    contentIndex: number;  // contents 배열 내 인덱스
  };
}

// text 이벤트 수신 시
if (session.activeFileOperation) {
  // 파일 카드에 스트리밍
  fileContent.content += event.content;
} else {
  // 일반 텍스트로 추가
  addContentToCurrentMessage({type:'text', content:event.content});
}
```

### 3. **Phase별 UI 상태 관리**

파일/명령 작업의 진행 상황을 Phase로 명확히 구분:

```
File Create:  creating → writing → complete
File Edit:    editing → updating → complete
File Delete:  deleting → complete
Command:      running → streaming → complete
```

각 Phase마다 다른 UI 컴포넌트를 렌더링하여 사용자에게 명확한 피드백 제공.

---

## 🔮 Future Enhancements

1. **Tool Result UI**: Tool 실행 결과를 접기/펼치기 가능한 카드로 표시
2. **Diff Highlighting**: Syntax highlighting + line-by-line diff
3. **File Preview**: 파일 카드에 코드 미리보기 (첫 20줄)
4. **Command History**: 실행된 명령 목록 및 재실행 버튼
5. **Thinking Summary**: Thinking 블록을 요약하여 표시

---

## 📚 Related Docs

- [Code Job Architecture](./ARCHITECTURE_CODE_JOB.md)
- [Design Job Architecture](./ARCHITECTURE_DESIGN_JOB.md)
- [ChatService API](./packages/ant-cli/src/periphery/adapters/http/services/ChatService.ts)

