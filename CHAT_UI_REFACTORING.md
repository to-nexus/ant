# Chat UI 리팩토링 및 Merge 로직 수정 작업 요약

## 📋 프로젝트 개요

### 코드베이스 구조
```
ant/
├── packages/
│   ├── ant-cli/          # Backend (Node.js/TypeScript)
│   │   ├── src/
│   │   │   ├── core/
│   │   │   │   ├── adapters/ChatAPIClient.ts
│   │   │   │   └── streaming/
│   │   │   ├── periphery/adapters/http/
│   │   │   │   ├── services/ChatService.ts  # ⭐ 핵심 파일
│   │   │   │   └── routes/chat.routes.ts
│   │   │   └── agents/architect/
│   │   │       ├── tools/file-tools.ts
│   │   │       └── graph/
│   │   │           ├── code/nodes/tool.ts
│   │   │           ├── design/nodes/tool.ts
│   │   │           └── learn/nodes/
│   └── ant-ui/           # Frontend (React/TypeScript/Tailwind)
│       └── src/
│           ├── domain/models/chat.ts
│           └── presentation/components/chat/
│               ├── MessageItem.tsx        # 메인 렌더러
│               ├── ShimmerCard.tsx        # placeholder, thinking, cancelled
│               ├── WorkingCard.tsx        # ~ing 상태
│               ├── ResultCard.tsx         # ~ed 상태
│               ├── TerminalCard.tsx       # command 실행
│               ├── FileCard.tsx           # 파일 작업
│               └── ToolActionCard.tsx     # 기타 툴
```

## 🎯 Chat Status 시스템 아키텍처

### Chat Status Types (Progress Indicators)
```typescript
// 🔄 Progress/Complete 페어
'exploring' | 'explored'      // Git changes (Vector DB에 있지만 로컬 변경된 파일)
'retrieving' | 'retrieved'    // Vector DB search
'grepping' | 'grepped'        // Local file search (Vector DB에 없는 파일)
'reading' | 'read'            // File read
'indexing' | 'indexed'        // Codebase indexing
'analyzing' | 'analyzed'      // File analysis
'storing' | 'stored'          // Lesson storage
'command_running' | 'command' // Command execution

// 🎨 Special States
'placeholder'                 // Node transition
'thinking'                    // LLM reasoning
'cancelled'                   // Task cancelled
'tool_action'                 // Simple tools (mkdir, etc.)
```

### 데이터 흐름

#### 1. **Tool 호출 → Chat Status**
```
LLM Tool Call
    ↓
ChatService (SSE 감지)
    ↓
file-tools.ts / tool.ts (실제 실행)
    ↓
ChatAPIClient.showChatStatus()
    ↓
ChatService.addContent() → Merge 로직
    ↓
SSE Broadcast → Frontend
    ↓
MessageItem.tsx → 적절한 Card 렌더링
```

#### 2. **Merge 우선순위**
```typescript
// ChatService.addContent() 내부 로직 순서:

1. _mergeIndex 우선 체크 (명시적 merge)
   if (content.metadata?._mergeIndex !== undefined) {
     // 직접 해당 인덱스와 merge
   }

2. placeholder merge
   if (lastContent.type === 'placeholder') {
     // placeholder는 모든 것과 merge
   }

3. Progress → Complete 페어 merge
   if (content.type === 'explored') {
     const found = findRecentChatStatus('exploring');
     // reverse search로 최근 exploring 찾아 merge
   }
```

## 🐛 발견하고 해결한 주요 문제들

### 1. ❌ Merge 로직 오류 (가장 중요!)

**문제:**
```typescript
// ❌ 잘못된 코드
if (content.type === 'exploring' || content.type === 'explored') {
  const found = findRecentChatStatus(['exploring', 'explored']);  
  // ⬆️ explored도 검색 범위에 포함!
  if (found && found.content.type === 'exploring') { ... }
  // ⬆️ 이미 explored를 찾아버리면 이 조건 실패!
}
```

**해결:**
```typescript
// ✅ 올바른 코드
if (content.type === 'explored') {  // explored가 올 때만
  const found = findRecentChatStatus('exploring');  // exploring만 검색
  if (found) { ... }
}
```

**적용한 모든 페어:**
- `explored` → `'exploring'` 검색
- `retrieved` → `'retrieving'` 검색
- `grepped` → `'grepping'` 검색
- `read` → `'reading'` 검색 (+ filePath 일치 확인)
- `indexed` → `'indexing'` 검색
- `analyzed` → `'analyzing'` 검색
- `stored` → `'storing'` 검색
- `command` → `['command_running', 'command_streaming']` 검색 (+ command 일치 확인)

### 2. ❌ _mergeIndex 미처리

**문제:** `ChatService.addContent()`가 `metadata._mergeIndex`를 완전히 무시

**해결:**
```typescript
// ChatService.ts - addContent() 시작 부분에 추가
if (content.metadata?._mergeIndex !== undefined) {
  const targetIndex = content.metadata._mergeIndex;
  if (targetIndex >= 0 && targetIndex < existingContents.length) {
    const target = existingContents[targetIndex];
    // 직접 merge
    target.type = content.type;
    target.content = content.content;
    target.metadata = { ...target.metadata, ...content.metadata };
    delete target.metadata._mergeIndex;
    return targetIndex;
  }
}
```

**`_mergeIndex` 사용하는 곳:**
- `reading` → `read` (파일별로 독립적 merge 필요)
- 기타 progress/complete 페어들

### 3. ❌ explored 전에 exploring 없음

**문제:** 여러 파일에서 `explored`만 호출하고 `exploring` 누락

**해결한 파일:**
```typescript
// semanticSearch.ts
await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
await chatAPI.showChatStatus('explored', { ... });

// stackTraceLoader.ts
await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
await chatAPI.showChatStatus('explored', { ... });

// codebaseLoader.ts (2곳)
await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
await chatAPI.showChatStatus('explored', { ... });

// code/nodes/tool.ts (search_reference)
await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
await chatAPI.showChatStatus('explored', { ... });
```

### 4. ❌ list_files가 tool_action으로 표시됨

**문제:** ChatService의 SSE 이벤트 핸들러에 레거시 코드 존재

**원인:**
```typescript
// ChatService.ts - 레거시 코드
else if (name === 'list_files' || name === 'search_code') {
  this.addContentToCurrentMessage(projectId, featureName, {
    type: 'exploring',  // ⬅️ 중복 exploring 추가!
    ...
  });
}
```

**흐름:**
1. LLM이 `list_files` 호출
2. ChatService fallback → `tool_action` 추가 (🔧)
3. file-tools.ts → `grepping` 호출
4. file-tools.ts → `grepped` 추가
5. **결과:** 🔧 + 🔍 둘 다 표시!

**해결:**
```typescript
// list_files, search_code는 명시적으로 SKIP
else if (name === 'list_files' || name === 'search_code') {
  console.log(`⏭️ ${name} (handled by file-tools.ts with WorkingCard/ResultCard)`);
}
// 나머지는 fallback으로 tool_action
else {
  this.addContentToCurrentMessage(..., { type: 'tool_action', actionIcon: '🔧' });
}
```

### 5. ❌ reading → read merge 실패

**문제:** `addReadingFile`, `addReadComplete`가 `_mergeIndex` 미사용

**해결:**
```typescript
// ChatAPIClient.ts
async addReadingFile(filePath: string): Promise<number | undefined> {
  const response = await fetch(...);
  const result = await response.json();
  return result.contentIndex;  // ✅ 인덱스 반환
}

async addReadComplete(filePath: string, readingIndex?: number, error?: string) {
  await this.showChatStatus('read', { 
    filePath, 
    _mergeIndex: readingIndex,  // ✅ 인덱스 전달
    error 
  });
}

// chat.routes.ts
const contentIndex = deps.chatService.addContentToCurrentMessage(...);
res.json({ success: true, contentIndex });  // ✅ 인덱스 반환
```

**수정한 호출 코드:**
- `code/nodes/tool.ts` - readingIndex 사용
- `design/nodes/tool.ts` - 파라미터 순서 수정
- `learn/nodes/resolve.ts` - readingIndex 사용 (3곳)

### 6. ❌ exploring / explored 의미 혼동

**올바른 의미:**
- `retrieving` / `retrieved`: Vector DB 조회
- `exploring` / `explored`: Vector DB에 **존재하지만** 로컬에 변경된 파일
- `grepping` / `grepped`: Vector DB에 **없는** 로컬 파일 검색

**잘못 사용하던 곳:**
- `file-tools.ts` - `list_files`가 `exploring` 사용 → `grepping`으로 수정
- `design/nodes/tool.ts` - `list_files`, `search_code`가 `explored` 사용 → `grepped`로 수정

## 🎨 Frontend 컴포넌트 리팩토링

### 통합 전략

**이전:** 각 상태별로 개별 컴포넌트
```
ThinkingCard, CancelledCard, ExplorationCard, GrepCard, CommandCard 등...
```

**이후:** 6개 컴포넌트로 통합
```typescript
1. ShimmerCard       // placeholder, thinking, cancelled (variant)
2. WorkingCard       // ~ing 상태 (exploring, retrieving, grepping, reading, etc.)
3. ResultCard        // ~ed 상태 (explored, retrieved, grepped, read, etc.)
4. TerminalCard      // command 실행 (command_running, command_streaming, command)
5. FileCard          // 파일 작업 (file_creating, file_editing, file_deleting, etc.)
6. ToolActionCard    // 기타 툴 (mkdir 등)
```

### WorkingCard 색상 체계
```typescript
'exploring'  → blue    (Vector DB + local changes)
'retrieving' → purple  (Vector DB)
'grepping'   → purple  (Local search)
'reading'    → indigo  (File read)
'indexing'   → green   (Indexing)
'analyzing'  → amber   (Analysis)
'storing'    → amber   (Storage)
```

### Tailwind Dynamic Class 문제

**문제:** 동적 클래스명이 빌드 시 포함 안 됨
```typescript
// ❌
const containerClass = `bg-${color}-50 dark:bg-${color}-900/20`;
```

**해결:** 전체 클래스명을 하드코딩
```typescript
// ✅
case 'exploring':
  return {
    containerClass: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800',
    iconColorClass: 'text-blue-600 dark:text-blue-400',
    // ...
  };
```

## 📝 타입 정의

### MessageContent.metadata (중요!)

```typescript
// ChatService.ts와 ant-ui/domain/models/chat.ts 양쪽에 동일하게 정의
metadata?: {
  // File related
  filePath?: string;
  diffBefore?: string;
  diffAfter?: string;
  
  // Command
  command?: string;
  exitCode?: number;
  
  // Search/Analysis
  filesCount?: number;
  totalFiles?: number;
  filesList?: string[];
  query?: string;
  keywords?: string[];
  
  // Tool
  toolName?: string;
  actionIcon?: string;
  
  // Thinking
  blockStart?: boolean;
  blockEnd?: boolean;
  durationMs?: number;
  
  // Indexing
  filesIndexed?: number;
  chunks?: number;
  tokens?: number;
  duration?: number;
  
  // Merge control
  _mergeIndex?: number;   // ⭐ 명시적 merge 타겟 인덱스
  
  // General
  error?: string | boolean;
  timestamp?: string;
};
```

## ✅ 체크리스트 (작업 완료 항목)

### Backend (ant-cli)
- [x] ChatService.ts - `_mergeIndex` 우선 처리 로직 추가
- [x] ChatService.ts - 모든 merge 로직 수정 (explored, retrieved, grepped, read, etc.)
- [x] ChatService.ts - list_files/search_code 레거시 코드 제거 및 SKIP 로직 추가
- [x] ChatService.ts - tool_action fallback 유지 (명시적 처리 외 툴용)
- [x] ChatAPIClient.ts - addReadingFile 인덱스 반환
- [x] ChatAPIClient.ts - addReadComplete _mergeIndex 전달
- [x] ChatAPIClient.ts - Read: 아이콘 제거 (카드에 이미 있음)
- [x] chat.routes.ts - add-content API에서 contentIndex 반환
- [x] file-tools.ts - list_files를 grepping/grepped로 변경
- [x] code/nodes/tool.ts - readingIndex 사용, search_reference에 exploring 추가
- [x] design/nodes/tool.ts - list_files, search_code를 grepping/grepped로 변경
- [x] learn/nodes/resolve.ts - readingIndex 사용 (3곳)
- [x] semanticSearch.ts - explored 전 exploring 추가
- [x] stackTraceLoader.ts - explored 전 exploring 추가
- [x] codebaseLoader.ts - explored/grepped 전 exploring/grepping 추가 (2곳)
- [x] decompose.ts - CommonRenderStrategy 파라미터 순서 수정
- [x] TypeScript 에러 모두 해결

### Frontend (ant-ui)
- [x] ShimmerCard.tsx - placeholder, thinking, cancelled 통합
- [x] WorkingCard.tsx - 모든 ~ing 상태 통합 (variant)
- [x] ResultCard.tsx - 모든 ~ed 상태 통합 (variant)
- [x] TerminalCard.tsx - command 관련 통합
- [x] FileCard.tsx - 파일 작업 통합
- [x] ToolActionCard.tsx - 기타 툴 통합
- [x] MessageItem.tsx - 새 컴포넌트 사용하도록 수정
- [x] Tailwind 동적 클래스 문제 해결 (하드코딩)
- [x] domain/models/chat.ts - `_mergeIndex` 타입 추가
- [x] 레거시 컴포넌트 제거 (ThinkingCard, CancelledCard)
- [x] Chat 관련 TypeScript 에러 모두 해결 (unused 변수 등)

## 🚀 서버 기동

```bash
# Backend
cd /Users/probe/dev/ant/packages/ant-cli
npm run dev:server
# → http://localhost:54112

# Frontend  
cd /Users/probe/dev/ant/packages/ant-ui
npm run dev
# → http://localhost:5173
```

## 🔍 디버깅 팁

### Merge가 작동하지 않을 때

1. **서버 로그 확인:**
   ```bash
   tail -f /tmp/ant-*.log | grep MERGED
   ```
   - `✅ MERGED: exploring → explored` 같은 로그가 있어야 함
   - 없으면 merge 조건 미충족

2. **_mergeIndex 확인:**
   - `metadata._mergeIndex`가 올바르게 전달되는지
   - ChatService가 우선순위로 체크하는지

3. **Progress 상태 확인:**
   - `explored` 전에 `exploring`이 먼저 호출되었는지
   - `findRecentChatStatus`가 올바른 타입만 검색하는지

4. **세션 데이터 확인:**
   ```bash
   cat workspace/{project}/{feature}/sessions/code.json | jq '.turns[-1].messages[-1].contents'
   ```

### UI가 이상하게 표시될 때

1. **Card 컴포넌트 매핑 확인:**
   - `MessageItem.tsx`의 switch 문 확인
   - 해당 타입이 올바른 Card로 매핑되는지

2. **Tailwind 클래스 확인:**
   - 동적 클래스 사용 안 하는지 (`bg-${color}-50` ❌)
   - 전체 클래스명 하드코딩했는지 (`bg-blue-50` ✅)

3. **브라우저 DevTools:**
   - SSE 이벤트 확인 (Network → EventStream)
   - React DevTools로 props 확인

## 📌 중요 주의사항

1. **`_mergeIndex`는 ChatService.addContent() 최우선 체크 항목**
   - 명시적으로 지정된 경우 무조건 해당 인덱스와 merge

2. **Progress → Complete 페어는 Complete만 검색**
   - ❌ `['exploring', 'explored']` 검색
   - ✅ `'exploring'` 검색

3. **list_files, search_code는 grepping/grepped**
   - exploring/explored가 아님!
   - Vector DB에 없는 로컬 파일 검색

4. **tool_action fallback은 유지**
   - 명시적으로 처리하지 않은 툴들을 위해 필요
   - list_files, search_code만 SKIP

5. **Tailwind 동적 클래스 절대 사용 금지**
   - 빌드 시 포함 안 됨
   - 항상 전체 클래스명 하드코딩

## 🔗 관련 파일 맵

### Merge 로직
- `ChatService.ts:459-656` - addContent() merge 로직
- `ChatService.ts:378-390` - findRecentChatStatus()
- `ChatService.ts:1045-1090` - SSE tool_call 핸들러

### Reading 관련
- `ChatAPIClient.ts:658-690` - addReadingFile, addReadComplete
- `chat.routes.ts:122-143` - add-content API
- `code/nodes/tool.ts:302-336` - handleReadFile
- `design/nodes/tool.ts:180-204` - handleReadFile
- `learn/nodes/resolve.ts:248-302` - 파일 읽기 로직

### List/Search 관련
- `file-tools.ts:95-175` - createListFilesTool
- `file-tools.ts:424-520` - createSearchCodeTool
- `design/nodes/tool.ts:209-256` - handleListFiles
- `design/nodes/tool.ts:274-325` - handleSearchCode

### Exploration 관련
- `semanticSearch.ts:206-222` - explored 호출
- `stackTraceLoader.ts:138-151` - explored 호출
- `codebaseLoader.ts:115,191-197` - explored 호출 (2곳)

## 🐛 추가 발견된 문제 (2024-12-10 추가)

### 7. ❌ design/nodes/tool.ts의 reading 누락

**문제:** `handleReadFile`에서 `addReadingFile()`을 호출하지 않음

**해결:**
```typescript
// ✅ Add reading status and get index
const readingIndex = await chatAPI.addReadingFile(filePath);

try {
  const content = await gitPort.readFile(absolutePath);
  await chatAPI.addReadComplete(filePath, readingIndex);
  return content;
} catch (error) {
  await chatAPI.addReadComplete(filePath, readingIndex, (error as Error).message);
  throw error;
}
```

### 8. ❌ resolve.ts의 에러 케이스에서 readingIdx 전달 누락

**문제:** 에러가 발생했을 때 `addReadComplete()`에 `undefined` 전달

**해결:**
```typescript
let readingIdx: number | undefined;
try {
  readingIdx = await chatAPI.addReadingFile(relativePath);
  // ...
} catch (readError) {
  // ✅ Complete the initial reading status first
  if (readingIdx !== undefined) {
    await chatAPI.addReadComplete(relativePath, readingIdx, 'Is a directory');
  }
  
  // 디렉토리 내 파일들도 동일하게 처리
  let fileReadingIdx: number | undefined;
  try {
    fileReadingIdx = await chatAPI.addReadingFile(filePath);
    // ...
  } catch (fileError) {
    if (fileReadingIdx !== undefined) {
      await chatAPI.addReadComplete(filePath, fileReadingIdx, 'Read failed');
    }
  }
}
```

## 🎉 최종 상태

**모든 작업 완료! 다음 항목들이 정상 작동:**
- ✅ reading → read merge (design/nodes/tool.ts 수정 완료)
- ✅ reading → read merge (resolve.ts 에러 케이스 수정 완료)
- ✅ exploring → explored merge
- ✅ retrieving → retrieved merge
- ✅ grepping → grepped merge
- ✅ list_files가 올바른 카드로 표시
- ✅ tool_action fallback 정상 작동
- ✅ 모든 TypeScript 에러 해결
- ✅ UI 컴포넌트 통합 완료
