# XML 파일 처리 방식 - 완전 가이드

Design Job의 실시간 Markdown 렌더링을 위한 XML 태그 처리 시스템

---

## 📋 **지원하는 XML 태그**

### 1. `<file>` - 파일 생성/덮어쓰기

```xml
<file path="DESIGN.md">
# System Design

## Architecture Overview
This system uses a microservices architecture...
</file>
```

**처리 흐름:**
1. **XMLStreamParser**: `file_start` → `file_content` (실시간, 증분) → `file_end`
2. **CommonRenderStrategy**: 
   - `streamFileContent()` 호출 (UI 실시간 업데이트)
   - `StreamBufferManager`에 버퍼링
3. **Tool 노드**: 
   - `write_file(path="DESIGN.md", content="")` 호출
   - 버퍼에서 읽어서 디스크 저장

**특징:**
- ✅ 실시간 렌더링 (character-by-character)
- ✅ 중단 시 복구 가능 (버퍼 보존)
- ✅ Markdown 파일에 최적화

---

### 2. `<append>` - 파일 끝에 추가

```xml
<append path="DESIGN.md">

## New Chapter

This is additional content...
</append>
```

**처리 흐름:**
- `<file>`과 동일하지만 `actionType='append'`
- 기존 파일 내용 뒤에 추가됨

**사용 사례:**
- Design job의 continuation task (Chapter 2, 3...)
- 기존 문서에 새 섹션 추가

---

### 3. `<edit>` - Search & Replace 수정

```xml
<edit path="src/App.tsx">
<search>
const [count, setCount] = useState(0);
</search>
<replace>
const [count, setCount] = useState(10);
</replace>
</edit>
```

**처리 흐름:**
1. **XMLStreamParser**: 
   - `file_start(actionType='edit')`
   - `file_content(metadata.section='search')`
   - `file_content(metadata.section='replace')`
   - `file_end`
2. **CommonRenderStrategy**: 
   - `editOperations` Map에 저장
   - UI에 실시간 스트리밍 **안함** (search/replace는 한 번에 표시)
3. **ChatService**: 
   - `startFileEdit()` → `completeFileEdit()` (before/after diff)

**특징:**
- ❌ 실시간 스트리밍 없음 (search/replace는 원자적 작업)
- ✅ Diff 표시 (before/after)
- ⚠️ **현재는 사용 안함** (Tool calling의 `write_file`로 대체)

---

### 4. `<delete>` - 파일 삭제

```xml
<delete path="old-file.txt" />
```

**처리 흐름:**
- Self-closing 태그
- 즉시 UI 업데이트 + 파일 삭제

**특징:**
- ✅ 즉시 실행 (버퍼링 없음)

---

## 🔄 **완전한 처리 파이프라인**

### **예시: Markdown 파일 생성**

```
LLM 출력:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
<file path="DESIGN.md">
# System Design
...
</file>

{
  "tool": "write_file",
  "arguments": {
    "path": "DESIGN.md",
    "content": ""
  }
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

처리 흐름:
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 📡 LLM Stream Event (type='text')
   ↓
2. 🔍 XMLStreamParser.parse()
   → <file path="DESIGN.md"> 감지
   → ParsedAction: { type: 'file_start', data: { filePath: 'DESIGN.md', actionType: 'create' } }
   ↓
3. 🎨 CommonRenderStrategy.render()
   → streamBufferManager.startFile('DESIGN.md', 'create')
   → chatAPI.streamFileContent('DESIGN.md', '')
   ↓
4. 💬 ChatService.addFileOperation()
   → MessageContent: { type: 'file_creating', metadata: { filePath: 'DESIGN.md' } }
   → UI: 파일 카드 생성 ✅
   ↓
5. 📡 LLM Stream Event (type='text', text='# System Design\n')
   ↓
6. 🔍 XMLStreamParser.parse()
   → ParsedAction: { type: 'file_content', data: { filePath: 'DESIGN.md', content: '# System Design\n' } }
   ↓
7. 🎨 CommonRenderStrategy.render()
   → streamBufferManager.appendContent('DESIGN.md', '# System Design\n')
   → chatAPI.streamFileContent('DESIGN.md', '# System Design\n')
   ↓
8. 💬 ChatService.addFileOperation()
   → MessageContent 업데이트 (content 누적)
   → UI: 실시간 렌더링 ✅
   ↓
... (위 5~8 반복 - 각 text chunk마다)
   ↓
9. 📡 LLM Stream Event (type='text', text='</file>\n')
   ↓
10. 🔍 XMLStreamParser.parse()
    → </file> 감지
    → ParsedAction: { type: 'file_end', data: { filePath: 'DESIGN.md' } }
    ↓
11. 🎨 CommonRenderStrategy.render()
    → streamBufferManager.completeFile('DESIGN.md', cleanup=false)
    → chatAPI.completeFileCreation('DESIGN.md', bufferedContent)
    ↓
12. 💬 ChatService.addFileOperation()
    → MessageContent: { type: 'file_create' } (완료 상태)
    → UI: 파일 카드 완료 표시 ✅
    ↓
13. 📡 LLM Stream Event (type='tool_use')
    → tool: 'write_file', arguments: { path: 'DESIGN.md', content: '' }
    ↓
14. 🔧 Tool 노드 실행
    → handleWriteFile(path='DESIGN.md', content='')
    → content가 빈 문자열 → streamBufferManager.getContent('DESIGN.md')
    → gitPort.writeFile('DESIGN.md', bufferedContent)
    ↓
15. 💾 디스크 저장 완료 ✅
    → state.files 업데이트
    → streamBufferManager.completeFile('DESIGN.md', cleanup=true)
```

---

## 🎯 **핵심 개념**

### **1. StreamBufferManager (버퍼 시스템)**

**역할:**
- 실시간 스트리밍 컨텐츠를 메모리 + 디스크 버퍼에 저장
- 중단 시 복구 가능 (`.buffers/design/` 디렉토리)

**API:**
```typescript
// 파일 스트리밍 시작
startFile(filePath: string, actionType: 'create' | 'append' | 'edit')

// 실시간 컨텐츠 추가
appendContent(filePath: string, content: string)

// 버퍼 내용 읽기
getContent(filePath: string): string | undefined

// 완료 (cleanup=true면 버퍼 삭제)
completeFile(filePath: string, cleanup: boolean)
```

---

### **2. FileRegistry (중복 방지)**

**역할:**
- 이미 스트리밍된 파일 추적
- 멀티턴 대화에서 동일 파일 재스트리밍 감지

**케이스:**
```typescript
// Turn 1: <file path="App.tsx">...</file>
// Turn 2: <file path="App.tsx">...</file>  ← 덮어쓰기!
//   → FileRegistry.resetFile() 호출
//   → StreamBufferManager.resetFile() 호출
//   → 버퍼 초기화 후 새로 시작

// Turn 1: <file path="App.tsx">...</file>
// Turn 2: <edit path="App.tsx">...</edit>  ← 수정!
//   → 버퍼 초기화 **안함** (기존 내용 위에 edit 적용)
```

---

### **3. CommonRenderStrategy (렌더링 전략)**

**역할:**
- XML 파서의 `ParsedAction`을 UI 업데이트로 변환
- 실시간 스트리밍 vs. 배치 처리 결정

**실시간 스트리밍 조건:**
```typescript
if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
  // ✅ 실시간 스트리밍 (라인 버퍼링)
  await chatAPI.streamFileContent(filePath, newContent);
}

if (fileInfo.actionType === 'edit' && metadata?.section) {
  // ❌ 실시간 스트리밍 없음 (search/replace 저장만)
  editOperations.set(filePath, { searchContent, replaceContent });
}
```

---

## 📊 **성능 최적화**

### **라인 기반 버퍼링**

```typescript
// CommonRenderStrategy.ts
private lineBuffers: Map<string, string> = new Map();

async renderFileContent(action: ParsedAction) {
  const lineBuffer = this.lineBuffers.get(filePath) || '';
  const updatedBuffer = lineBuffer + content;
  
  const lines = updatedBuffer.split('\n');
  const incompleteLastLine = lines.pop() || '';  // 마지막 불완전 라인 보존
  
  this.lineBuffers.set(filePath, incompleteLastLine);
  
  if (lines.length > 0) {
    const newContent = lines.join('\n') + '\n';
    await this.chatAPI.streamFileContent(filePath, newContent);  // 완전한 라인만 전송
  }
}
```

**이유:**
- 네트워크 효율성 (완전한 라인만 전송)
- 태그 감지 안정성 (`</file>` 분리 방지)

---

## 🚨 **Design Job vs Code Job 차이**

| **항목** | **Design Job** | **Code Job** |
|---------|----------------|--------------|
| **파일 응답** | `<file>` + Tool calling | Tool calling만 |
| **실시간 렌더링** | ✅ Yes (Markdown) | ❌ No |
| **버퍼 사용** | ✅ Yes | ❌ No |
| **XML 파서** | ✅ Yes | ❌ No |
| **이유** | UX (문서 작성 과정 표시) | 효율성 (즉시 저장) |

---

## 🔧 **트러블슈팅**

### **문제: 파일 내용이 중복됨**

**원인:**
- 멀티턴 대화에서 동일 파일을 여러 번 스트리밍
- `FileRegistry.resetFile()` 호출 안됨

**해결:**
```typescript
// CommonRenderStrategy.ts - renderFileStart()
if (registry.hasStreamed(filePath)) {
  const isFullReplacement = ...;
  
  if (isFullReplacement) {
    registry.resetFile(filePath);
    bufferManager.resetFile(filePath, actionType);  // ✅ 버퍼 초기화
  }
}
```

---

### **문제: `</file>` 태그가 조기 감지됨**

**원인:**
- 파일 내용에 `</file>` 문자열이 포함됨 (예: HTML 주석)

**해결:**
- 라인 버퍼링 사용 (완전한 라인만 전송)
- Lookahead 버퍼 (`</file>` 길이만큼 보류)

```typescript
// XMLStreamParser.ts
if (this.context.insideFile && this.buffer.length > 0) {
  const lookahead = '</file>';
  if (this.buffer.length > lookahead.length) {
    const safeContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
    // ... (safeContent만 전송)
  }
}
```

---

## 📝 **요약**

1. **`<file>`, `<append>`**: 실시간 렌더링 + 버퍼 + Tool calling 저장
2. **`<edit>`**: 배치 처리 (UI에 diff 표시) *(현재 미사용)*
3. **`<delete>`**: 즉시 실행
4. **버퍼 시스템**: 중단 시 복구 + 멀티턴 지원
5. **라인 버퍼링**: 네트워크 효율성 + 태그 안정성

**핵심 원칙:** Markdown 파일 = 실시간 UX, Code 파일 = 효율성

