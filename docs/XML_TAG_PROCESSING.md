# XML 태그 파싱 및 렌더링 가이드

## 📊 태그별 처리 특징 요약

| 태그 | XMLStreamParser 파싱 | SpecialTagTransformer | `consumed` | Chat UI 출력 | Backend 사용 |
|------|---------------------|----------------------|-----------|--------------|-------------|
| **`<thinking>`** | ✅ 파싱 (`insideThinking`) | ❌ 없음 | - | ✅ 사고 과정 표시 | ❌ |
| **`<file path="...">`** | ✅ 파싱 (`insideFile`) | ❌ 없음 | - | ✅ 파일 생성 카드 | ✅ 디스크 작성 |
| **`<append path="...">`** | ✅ 파싱 (`insideAppend`) | ❌ 없음 | - | ✅ 파일 추가 카드 | ✅ 디스크 추가 |
| **`<edit path="...">`** | ✅ 파싱 (`insideEdit`) | ❌ 없음 | - | ✅ 파일 수정 카드 | ✅ 검색/교체 |
| **`<delete path="..."/>`** | ✅ 파싱 (self-closing) | ❌ 없음 | - | ✅ 파일 삭제 표시 | ✅ 디스크 삭제 |
| **`<tasks>`** | ✅ 파싱 (`insideTasks`) | ✅ 변환 | ✅ `true` | ❌ **숨김** | ✅ Kanban 보드 |
| **`<learn_command>`** | ✅ 파싱 (`insideLearnCommand`) | ✅ 변환 | ✅ `true` | ✅ **포맷팅된 메시지** | ✅ 학습 실행 |
| **`<references>`** | ❌ 파싱 안 함 | ✅ 변환 | ✅ `true` | ✅ **포맷팅된 메시지** | ✅ Tool 호출 |
| **`<detect>`** | ❌ 파싱 안 함 | ✅ 변환 | ✅ `true` | ✅ **포맷팅된 메시지** | ✅ State 저장 |
| **`<done>true`** | ❌ 파싱 안 함 | ✅ 변환 | ✅ `true` | ✅ **완료 메시지** | ❌ |
| **`<done>false`** | ❌ 파싱 안 함 | ✅ 변환 | ✅ `true` | ❌ **아무것도 안 함** | ❌ |

---

## 📖 `consumed` 속성 설명

### `consumed: true` (원본 숨김)
```typescript
return { text: "포맷팅된 메시지", consumed: true };
```

**의미**: "내가 이 태그를 완전히 처리했으니, **원본은 버리고** 내가 만든 텍스트만 출력해"

**결과**: 원본 태그는 숨겨지고 변환된 텍스트만 Chat UI에 표시

### `consumed: false` (원본도 출력)
```typescript
return { text: "추가 메시지", consumed: false };
```

**의미**: "내가 처리는 했지만, **원본도 같이 출력**해"

**결과**: 변환된 텍스트 + 원본 태그 둘 다 출력 (거의 사용 안 함)

---

## 🔍 처리 방식별 분류

### 1️⃣ XMLStreamParser 파싱 그룹

#### **A. 파일 작업 태그** (복잡한 구조)
- `<file>`, `<append>`, `<edit>`, `<delete>`
- 실시간 스트리밍 필요
- 속성(path) 및 내용 버퍼링
- 파일 시스템 작업 수행

#### **B. 특수 블록 태그**
- `<thinking>`: 사고 과정 표시 (UI 전용, 대화 히스토리 제외)
- `<tasks>`: 내용 축적 후 SpecialTagTransformer로 전달
- `<learn_command>`: 내용 축적 후 SpecialTagTransformer로 전달

### 2️⃣ SpecialTagTransformer 전용 그룹

- `<detect>`, `<references>`, `<done>`
- 단순한 구조로 정규식 매칭으로 충분
- XMLStreamParser를 그냥 통과
- 완전한 태그를 받은 후 한 번에 변환

---

## 🎯 처리 흐름

### **파싱 태그** (`<file>`, `<thinking>` 등)
```
LLM Stream → XMLStreamParser (파싱)
          → ParsedAction (구조화)
          → CommonRenderStrategy
          → Chat UI (파일 카드, 사고 과정 등)
```

### **SpecialTag 태그** (`<detect>`, `<references>` 등)
```
LLM Stream → XMLStreamParser (통과, 파싱 안 함)
          → response로 출력
          → CommonRenderStrategy.renderResponse()
          → SpecialTagTransformer.transform()
          → consumed: true → 포맷팅된 텍스트만 출력
          → Chat UI
```

---

## 💡 출력 예시

### `<detect>` 태그 변환

**입력 (LLM 응답)**:
```xml
<detect>
{
  "mode": "generate",
  "modeReasoning": "The directive uses '시작해라' indicating initialization...",
  "environment": "frontend",
  "environmentReasoning": "The directive explicitly mentions '프론트엔드'"
}
</detect>
```

**출력 (Chat UI)**:
```
🔍 환경 분석 완료

✨ 모드: generate
   └ The directive uses '시작해라' indicating initialization...

🎨 환경: frontend
   └ The directive explicitly mentions '프론트엔드'
```

### `<tasks>` 태그 처리

**입력**:
```xml
<tasks>
[
  { "id": "task-1", "name": "Setup project", ... },
  { "id": "task-2", "name": "Implement auth", ... }
]
</tasks>
```

**출력**: Chat UI에는 아무것도 표시 안 됨 (Kanban 보드에만 표시)

### `<learn_command>` 태그 변환

**입력**:
```xml
<learn_command>
{
  "action": "index_branch",
  "branch": "main",
  "mode": "smart"
}
</learn_command>
```

**출력 (Chat UI)**:
```
📚 학습 명령 분석 완료

• 작업: 브랜치 인덱싱
• 브랜치: `main`
• 모드: 스마트
```

---

## ⚙️ 구현 위치

### XMLStreamParser
- **파일**: `packages/ant-cli/src/core/streaming/parsers/XMLStreamParser.ts`
- **역할**: 복잡한 태그의 구조화된 파싱

### SpecialTagTransformer
- **파일**: `packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts`
- **역할**: 단순 태그의 정규식 매칭 및 포맷팅

### CommonRenderStrategy
- **파일**: `packages/ant-cli/src/core/streaming/strategies/CommonRenderStrategy.ts`
- **역할**: 파싱/변환된 결과를 Chat UI로 전송

---

## 🚨 주의사항

### 1. 새 태그 추가 시

**XMLStreamParser 파싱이 필요한 경우**:
- 실시간 스트리밍이 필요
- 복잡한 구조 (속성, 중첩 태그)
- 예: `<newfile path="..." type="...">`

**SpecialTagTransformer로 충분한 경우**:
- 단순한 JSON 내용
- 완전한 태그만 있으면 됨
- 예: `<status>{ "progress": 50 }</status>`

### 2. `consumed` 설정

- **대부분의 경우**: `consumed: true` 사용
- **원본도 보여야 하는 경우**: `consumed: false` (매우 드묾)
- **아무것도 출력 안 할 경우**: `consumed: true`, `text: undefined`

### 3. XMLStreamParser의 태그 감지 정규식

```typescript
// line 579-580
const beforeTagMatch = this.buffer.match(/^(.+?)(?=<(?:thinking|tasks|file|edit|delete|append|learn_command|done)[\s>])/s);
```

**주의**: 
- ✅ 파싱할 태그만 여기에 추가
- ❌ SpecialTag 전용 태그는 추가하지 말 것 (`detect`, `references`)
- 잘못 추가하면 태그가 파싱되지 않고 원문으로 출력됨

---

## 📅 마지막 업데이트

**날짜**: 2024-12-02
**버전**: v1.0.0

