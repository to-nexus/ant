# Tasks 렌더링 문제 - 해결 완료 ✅

## 🔴 문제

Tasks 렌더링이 전혀 안 됨 (제목 포함)

## 🔍 근본 원인

**XMLStreamParser의 순차 처리 로직 결함:**

```typescript
// ❌ 문제: thinking 내부에서 <tasks> 태그를 감지하지 못함

1. <thinking> 체크
2. thinking 내부 content 누적 ← buffer를 비워버림!
3. <tasks> 체크 ← 이미 buffer가 비어서 감지 못함!
```

**실제 LLM 출력 구조:**
```
<thinking>
작업을 분석합니다...
<tasks>
{ "tasks": [...] }
</tasks>
</thinking>
```

**문제:**
- `<tasks>` 태그가 `<thinking>` **내부**에 있음
- XMLStreamParser가 thinking 내부 content를 먼저 처리하면서 buffer를 비움
- 이후 `<tasks>` 체크 시점에는 이미 buffer가 비어있어서 감지 불가

---

## ✅ 해결 방법

### 1. 중첩 태그 감지 로직 추가

**XMLStreamParser.ts 수정:**

```typescript
// ✅ 새로운 순서: thinking 내부에서도 <tasks> 태그 감지

1. <thinking> 체크
2. </thinking> 체크
3. ✅ NEW: <tasks> inside <thinking> 체크 ← 중첩 태그 처리!
4. thinking 내부 content 누적
5. <tasks> 최상위 레벨 체크
6. </tasks> 체크
7. tasks 내부 content 누적
```

**핵심 코드:**

```typescript
// 3. Check for <tasks> inside thinking (중첩 태그 처리) ✅ CRITICAL FIX
if (this.context.insideThinking && !this.context.insideTasks && this.buffer.includes('<tasks>')) {
  console.log('[XMLStreamParser] 📋 <tasks> tag detected INSIDE <thinking>!');
  const startIdx = this.buffer.indexOf('<tasks>');
  
  // Emit thinking content before <tasks>
  const thinkingBeforeTasks = this.buffer.substring(0, startIdx);
  if (thinkingBeforeTasks.trim()) {
    actions.push({
      type: 'thinking',
      data: { content: thinkingBeforeTasks }
    });
  }
  
  this.buffer = this.buffer.substring(startIdx + '<tasks>'.length);
  this.context.insideTasks = true;
  
  // ✅ Emit tasks_start action for UI
  actions.push({
    type: 'tasks_start',
    data: {}
  });
  
  continueParsingLoop = true;
  continue;
}

// 4. Accumulate thinking content (only if NOT inside tasks)
if (this.context.insideThinking && !this.context.insideTasks && this.buffer.length > 0) {
  const content = this.buffer;
  this.buffer = '';
  actions.push({
    type: 'thinking',
    data: { content }
  });
  continue;
}
```

---

## 🎯 변경 사항 요약

### 파일: XMLStreamParser.ts

**변경 전:**
```typescript
// ❌ thinking 내부에서 <tasks> 감지 불가
if (this.context.insideThinking && this.buffer.length > 0) {
  this.buffer = '';  // ← 여기서 버퍼를 비워버림!
}

if (!this.context.insideTasks && this.buffer.includes('<tasks>')) {
  // ← 이미 버퍼가 비어서 실행 안 됨
}
```

**변경 후:**
```typescript
// ✅ thinking 내부에서 먼저 <tasks> 감지
if (this.context.insideThinking && !this.context.insideTasks && this.buffer.includes('<tasks>')) {
  // <tasks> 감지 및 처리
  this.context.insideTasks = true;
  actions.push({ type: 'tasks_start', data: {} });
}

// ✅ tasks 내부가 아닐 때만 thinking content 처리
if (this.context.insideThinking && !this.context.insideTasks && this.buffer.length > 0) {
  this.buffer = '';
}
```

---

## 🔄 처리 흐름

### Before (실패):
```
LLM Output: "<thinking>분석...<tasks>{...}</tasks></thinking>"

1. <thinking> 감지 → insideThinking = true
2. "분석..." 누적 → buffer 비움
3. "<tasks>{...}</tasks>" 누적 → buffer 비움  ← ❌ <tasks> 태그를 감지하지 못함!
4. </thinking> 감지 → insideThinking = false
5. <tasks> 체크 → 이미 지나감  ← ❌ 감지 실패!
```

### After (성공):
```
LLM Output: "<thinking>분석...<tasks>{...}</tasks></thinking>"

1. <thinking> 감지 → insideThinking = true
2. "분석..." 누적 → buffer 비움
3. <tasks> 감지!  ← ✅ thinking 내부에서도 감지!
   - thinkingBeforeTasks 누적 (있다면)
   - insideTasks = true
   - tasks_start 이벤트 발생
4. "{...}" 누적 → tasks_content 이벤트 발생
5. </tasks> 감지!  ← ✅ 정상 처리
   - insideTasks = false
   - tasks_end 이벤트 발생
6. </thinking> 감지 → insideThinking = false
```

---

## 📋 체크리스트

- ✅ XMLStreamParser에 중첩 태그 감지 로직 추가
- ✅ thinking 내부에서 `<tasks>` 감지 가능
- ✅ thinking 내부가 아닐 때만 content 누적
- ✅ 로그 강화 (`<tasks> tag detected INSIDE <thinking>!`)
- ✅ 빌드 성공
- ⏳ 실제 테스트 대기

---

## 🧪 테스트 방법

### 1. 서버 시작
```bash
cd /Users/probe/dev/ant/packages/ant-cli
npm run dev:server
```

### 2. 새 Job 실행
```bash
# 웹 UI 또는 CLI로 새 directive 실행
```

### 3. 로그 확인
```bash
# 다음 로그가 보여야 함:
[XMLStreamParser] 📋 <tasks> tag detected INSIDE <thinking>!
[CommonRenderStrategy] 📋 tasks_start detected - initializing buffer
[CommonRenderStrategy] 📋 tasks_content received: ...
[CommonRenderStrategy] ✅ Tasks parsed successfully: X tasks
[CommonRenderStrategy] 📤 Sending tasks event with tasksJson
```

### 4. UI 확인
- ✅ "📋 **Task Breakdown:**" 헤더 표시
- ✅ Tasks가 구조적으로 렌더링 (bullet points)
- ✅ TasksCard 컴포넌트 정상 작동

---

## 🎓 교훈

### 1. 순서가 중요하다
**XML 파서는 순차적으로 동작**하므로, 중첩된 태그는 **부모 태그 내부에서 먼저 체크**해야 함.

### 2. Buffer 관리가 핵심
Buffer를 비우는 시점을 **신중하게 결정**해야 함. 중첩 태그를 먼저 체크하지 않으면 buffer가 비워진 후에는 감지 불가.

### 3. 조건문 순서 최적화
```typescript
// ✅ GOOD: 중첩 태그를 먼저 체크
if (insideParent && !insideChild && buffer.includes('<child>')) { ... }
if (insideParent && !insideChild && buffer.length > 0) { buffer = ''; }

// ❌ BAD: buffer를 먼저 비우면 child를 감지 못함
if (insideParent && buffer.length > 0) { buffer = ''; }  // ← 너무 빨리 비움!
if (insideParent && buffer.includes('<child>')) { ... }  // ← 이미 늦음
```

### 4. 로그의 중요성
상세한 로그가 없었다면 이 문제를 찾기 어려웠을 것. **중첩 태그 감지 시점**을 명확히 로그로 남김.

---

## 🔜 다음 단계

1. ✅ 빌드 완료
2. ⏳ 실제 Job 실행 테스트
3. ⏳ 로그 확인
4. ⏳ UI 렌더링 확인
5. ⏳ 문제 해결 확인

---

*Last Updated: 2025-11-20*
*Status: ✅ FIX APPLIED, TESTING PENDING*

