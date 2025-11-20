# Tasks 렌더링 문제 - 근본 원인 및 설계 결함 분석

## 🔴 문제 현황

**증상:**
- Tasks 렌더링이 전혀 안 됨 (제목 포함)
- `📋 **Task Breakdown:**` 헤더조차 표시되지 않음
- 로그에는 정상 처리되는 것처럼 보임

## 🔍 근본 원인 분석

### 1. 설계 결함: 이중 처리 구조

**문제:**
`decompose` 노드가 **두 가지 방식**으로 tasks를 처리하고 있음:

```typescript
// decompose/index.ts

// 방법 1: StreamOrchestrator를 통한 UI 렌더링
const orchestrator = new StreamOrchestrator({
  parser,
  renderStrategy,
  existingFiles: new Set(),
});

for await (const event of llm.stream([{ role: 'user', content: prompt }])) {
  await orchestrator.processEvent(event);  // ← UI 렌더링
  
  if (event.type === 'text') {
    raw += event.text || '';  // ← 원문 누적
  }
}

// 방법 2: 원문에서 직접 파싱
const tasksMatch = raw.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
const parsed = JSON.parse(jsonText);
tasks = parsed.tasks || [];  // ← Task 배열 추출
```

**결과:**
- `StreamOrchestrator`는 UI 렌더링만 담당 (정상)
- 하지만 실제 **Task 배열 추출은 별도**로 수행
- **두 시스템이 독립적으로 동작** → 한쪽이 실패해도 다른 쪽은 모름

---

### 2. 설계 결함: Extended Thinking 비활성화

**문제:**
`codeGen` 노드에서 tool calling 이후 Extended Thinking을 비활성화:

```typescript
// codeGen.ts
const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;

for await (const event of llmClient.stream(messages, {
  tools,
  maxTokens: 16000,
  enableThinking: !isAfterToolCall,  // ← Tool call 후 비활성화
})) {
```

**하지만:**
- `decompose` 노드는 **항상 Extended Thinking 활성화**
- Anthropic Extended Thinking이 활성화되면 **`<tasks>` 같은 XML 태그가 thinking 내부에 포함될 수 있음**
- XMLStreamParser가 이를 제대로 파싱하지 못할 가능성

---

### 3. 설계 결함: Thinking 블록과 Tasks 블록의 혼재

**Anthropic Extended Thinking 출력 구조:**
```
<thinking>
분석 내용...
</thinking>

<tasks>
{ "tasks": [...] }
</tasks>
```

**문제:**
- XMLStreamParser는 `<thinking>`과 `<tasks>`를 **별도 블록**으로 처리
- 하지만 Anthropic이 **thinking 내부에 tasks를 포함**시킬 수 있음:

```
<thinking>
작업 분석:
<tasks>
{ "tasks": [...] }
</tasks>
</thinking>
```

**결과:**
- `<tasks>` 태그가 `<thinking>` 내부에서 감지되지 않음
- 또는 thinking 블록이 끝나기 전에 tasks가 처리되지 않음

---

### 4. 설계 결함: 프론트엔드 `tasksJson` 체크 위치

**ChatService.ts:**
```typescript
case 'text':
  // ✅ Check if this is a tasks block (has tasksJson metadata)
  if (event.metadata?.tasksJson) {
    this.addContentToCurrentMessage(projectId, featureName, {
      type: 'text',
      content: event.text || '',
      metadata: { tasksJson: event.metadata.tasksJson }
    });
    break;
  }
```

**문제:**
- `tasksJson` 체크가 **맨 위**에 있음 (좋음)
- 하지만 **activeFileOperation 체크보다 뒤**에 있으면 무시될 수 있음
- 현재는 정상이지만, 순서가 중요함

---

## 🎯 해결 방안

### Option A: XMLStreamParser 개선 (권장)

**문제:**
- XMLStreamParser가 중첩된 태그를 제대로 처리하지 못함
- `<thinking>` 내부의 `<tasks>`를 감지하지 못함

**해결:**
```typescript
// XMLStreamParser.ts 개선

// 현재: Flat 구조 가정
if (this.context.insideTasks) {
  // tasks 내부 처리
}

// 개선: 중첩 허용
if (this.context.insideTasks) {
  // thinking 내부여도 tasks 처리 가능
  if (!this.context.insideThinking) {
    // thinking 밖의 tasks
  } else {
    // thinking 안의 tasks (무시 또는 별도 처리)
  }
}
```

---

### Option B: Thinking 비활성화 (간단하지만 기능 손실)

**해결:**
```typescript
// decompose/index.ts
for await (const event of llm.stream([{ role: 'user', content: prompt }], {
  enableThinking: false  // ← Thinking 비활성화
})) {
```

**장점:**
- `<tasks>` 태그가 최상위 레벨에 위치 보장
- XMLStreamParser가 정상 작동

**단점:**
- Thinking UI 손실
- 사용자가 LLM의 분석 과정을 볼 수 없음

---

### Option C: Tasks 처리 방식 단순화 (최적)

**현재 흐름:**
1. LLM 출력 → StreamOrchestrator → XMLStreamParser → CommonRenderStrategy
2. 동시에 raw 텍스트 누적
3. 마지막에 raw에서 JSON 추출

**개선 흐름:**
1. LLM 출력 → StreamOrchestrator → XMLStreamParser → CommonRenderStrategy
2. **CommonRenderStrategy가 직접 Task 배열 추출**
3. State에 저장

**구현:**
```typescript
// CommonRenderStrategy.ts
private async renderTasksEnd(action: ParsedAction): Promise<void> {
  const parsed = JSON.parse(this.tasksBuffer);
  const tasksJson = JSON.stringify(parsed);
  
  // ✅ UI 렌더링
  await this.chatAPI.sendLLMEvent({
    type: 'text',
    text: formattedText,
    metadata: { tasksJson }
  });
  
  // ✅ Task 배열도 함께 전달 (새로운 메커니즘)
  await this.chatAPI.submitTaskList(parsed.tasks);
}
```

---

## 🔧 즉시 적용 가능한 임시 해결책

### 1. 로그 강화 (현재 적용됨)

```typescript
// XMLStreamParser.ts
if (this.buffer.includes('<tasks>')) {
  console.log('[XMLStreamParser] 📋 <tasks> tag detected!');
}

// CommonRenderStrategy.ts
console.log('[CommonRenderStrategy] 📋 tasks_start detected');
console.log('[CommonRenderStrategy] 📋 tasks_content:', content.substring(0, 100));
console.log('[CommonRenderStrategy] 📋 Buffer size:', this.tasksBuffer.length);
```

**목적:**
- 어느 단계에서 실패하는지 정확히 파악
- `<tasks>` 태그가 감지되는지 확인
- Buffer에 내용이 쌓이는지 확인

---

### 2. Prompt 개선

**현재 Prompt (decompose/rules.md):**
```markdown
Then output the task list wrapped in <tasks> tags with valid JSON:

<tasks>
{
  "tasks": [...]
}
</tasks>
```

**개선:**
```markdown
CRITICAL: Output tasks OUTSIDE thinking tags:

First, think through your analysis (optional).

Then, IMMEDIATELY output the task list:

<tasks>
{
  "tasks": [...]
}
</tasks>

DO NOT put <tasks> inside <thinking> tags!
```

---

## 📊 테스트 시나리오

### Test 1: 로그 확인
```bash
npm run dev:server
# 새 job 실행
# 로그 확인:
# - "[XMLStreamParser] 📋 <tasks> tag detected!" 보이는가?
# - "[CommonRenderStrategy] 📋 tasks_content" 보이는가?
# - "[CommonRenderStrategy] 📤 Sending tasks event" 보이는가?
```

### Test 2: LLM 출력 확인
```bash
# decompose 노드 로그에서 raw 확인
cat /path/to/log | grep -A 50 "<tasks>"
# → <thinking> 내부에 있는가? 외부에 있는가?
```

### Test 3: ChatService 로그 확인
```bash
# ChatService에서 tasksJson 수신 확인
cat /path/to/log | grep "tasksJson"
# → "📋 Tasks block detected with tasksJson" 보이는가?
```

---

## ✅ 최종 권장 사항

**단계적 해결:**

1. **즉시 (현재)**: 로그 강화로 실패 지점 파악
2. **단기 (1일)**: Prompt 개선으로 `<tasks>` 위치 보장
3. **중기 (3일)**: XMLStreamParser 개선으로 중첩 태그 지원
4. **장기 (1주)**: Tasks 처리 방식 단순화 (Option C)

**우선순위:**
1. 로그 분석 → 실패 지점 확인
2. Prompt 수정 → `<tasks>` 위치 명시
3. Extended Thinking 비활성화 테스트 → 임시 해결책
4. 근본 설계 개선 → 완전한 해결

---

## 📝 다음 단계

1. ✅ 로그 강화 (완료)
2. ⏳ Job 실행 후 로그 분석
3. ⏳ 실패 지점 확인
4. ⏳ 해결책 적용
5. ⏳ 검증

---

*Last Updated: 2025-11-20*

