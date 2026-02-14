# Chat Activity Indicator (CAI)

> 사용자에게 "시스템이 작업 중"임을 알려주는 시각적 피드백 시스템.
> Job 실행부터 LLM 응답 완료까지 빈 화면 없이 연속적인 활동 표시를 보장한다.

---

## 1. 개요

### 1.1 용어 정의

| 용어 | 계층 | 설명 |
|------|------|------|
| **CAI (Chat Activity Indicator)** | 전체 | 시스템 총칭. 백엔드 placeholder 수명주기 관리 + 프론트엔드 시각 연출 |
| **Placeholder** | Backend | `MessageContentType = 'placeholder'`. 활동 중임을 나타내는 콘텐츠 블록 |
| **TypingIndicator** | Frontend | 점 3개가 깜빡이는 애니메이션 컴포넌트 (`TypingIndicator.tsx`) |
| **Universal Placeholder System** | Backend | ContentMerger 기반의 placeholder 자동 관리 메커니즘 |

### 1.2 설계 원칙

1. **Zero-Gap Feedback**: Job 시작 → 첫 LLM 토큰 → 콘텐츠 전환 사이에 빈 화면이 없어야 한다
2. **Auto-Inject / Auto-Remove**: placeholder는 수동 관리 없이 자동 삽입·자동 제거된다
3. **Single Source of Truth**: placeholder 수명주기는 `ContentMerger`가 단독 관리한다

---

## 2. 아키텍처

```
Job 시작
    │
    ▼
LLMResponseService.startMessage()
    │ ① assistant 메시지 생성 (message_start 브로드캐스트)
    │ ② ChatStatusHandler.showChatStatus('placeholder')
    │    └── ContentMerger.addContent(placeholder)
    │         └── MessageBroadcaster → SSE → ant-ui
    ▼
┌─────────────────────────────────────────────────┐
│  ant-ui                                          │
│                                                  │
│  ChatHistory (Footer)                            │
│  └── isRunning && !hasActiveStreamingAssistant   │
│       → TypingIndicator (메시지 도착 전)           │
│                                                  │
│  MessageItem                                     │
│  ├── isStreaming && contents.length === 0         │
│  │    → TypingIndicator (콘텐츠 없는 스트리밍)     │
│  └── content.type === 'placeholder'              │
│       → ShimmerCard(placeholder) → TypingIndicator│
└─────────────────────────────────────────────────┘
    │
    ▼  LLM 토큰 도착
    │
ContentMerger.addContent(thinking | text | ...)
    │ placeholder를 자동 교체 (mergeWithPlaceholder)
    ▼
TypingIndicator 사라짐 → 실제 콘텐츠 표시
```

---

## 3. Backend: Universal Placeholder System

### 3.1 핵심 파일

| 파일 | 역할 |
|------|------|
| `core/chat/types.ts` | `placeholder` 타입 정의, `INFORMATIONAL_TYPES` |
| `core/chat/ContentMerger.ts` | placeholder 삽입·교체·병합 로직 |
| `core/llm-response/LLMResponseService.ts` | `startMessage()` — 자동 placeholder 주입 |
| `core/llm-response/ChatStatusHandler.ts` | `showChatStatus('placeholder')` 실행 |
| `core/llm-response/FileOperationHandler.ts` | ContentMerger 경유하여 placeholder 교체 |
| `core/llm-response/CommandExecutionHandler.ts` | ContentMerger 경유하여 placeholder 교체 |
| `core/streaming/strategies/CommonRenderStrategy.ts` | `clarify_start` → placeholder 재주입 |

### 3.2 ContentMerger 전환 규칙

`ContentMerger.addContent()`가 새 콘텐츠를 추가할 때의 placeholder 처리:

| 새 콘텐츠 타입 | 기존 placeholder | 동작 |
|---------------|-----------------|------|
| `placeholder` | 없음 | 새 placeholder 추가 |
| `placeholder` | 있음 | 기존 placeholder를 교체 (in-place) |
| `thinking` | 있음 | placeholder를 thinking으로 교체 |
| `text`, `file`, `command` 등 | 있음 | placeholder를 제거하고 새 콘텐츠 추가 |
| `context_loaded` (INFORMATIONAL) | 있음 | placeholder 유지, 새 콘텐츠도 추가 (공존) |
| 임의 타입 | 없음 | 그냥 추가 |

### 3.3 자동 주입 시점

placeholder가 자동 삽입되는 시점:

| 시점 | 호출 경로 |
|------|----------|
| 새 assistant 메시지 시작 | `LLMResponseService.startMessage()` → `showChatStatus('placeholder')` |
| `<clarify>` 태그 감지 | `XMLStreamParser` → `clarify_start` 액션 → `CommonRenderStrategy` → `showChatStatus('placeholder')` |
| 환경 감지 시작 | `detectEnvironment()` → `showChatStatus('placeholder')` |

### 3.4 INFORMATIONAL_TYPES

`context_loaded` 등 정보성 타입은 placeholder와 **공존**한다.
이 타입들은 "작업 완료"를 의미하지 않으므로 placeholder를 제거하지 않는다.

```typescript
// core/chat/types.ts
export const INFORMATIONAL_TYPES = new Set([
  'context_loaded',
]);
```

---

## 4. Frontend: TypingIndicator 렌더링

### 4.1 핵심 파일

| 파일 | 역할 |
|------|------|
| `chat/TypingIndicator.tsx` | 점 3개 깜빡임 애니메이션 컴포넌트 |
| `chat/ShimmerCard.tsx` | `variant='placeholder'` → TypingIndicator 렌더링 |
| `chat/MessageItem.tsx` | 콘텐츠 타입별 렌더링, placeholder 방어적 필터링 |
| `chat/ChatHistory.tsx` | Footer TypingIndicator 조건 판단 |

### 4.2 TypingIndicator 출현 조건 (3곳)

| 위치 | 조건 | 설명 |
|------|------|------|
| **ChatHistory Footer** | `isRunning && !hasActiveStreamingAssistant` | Job 실행 중이나 아직 assistant 메시지가 스트리밍되지 않을 때 |
| **MessageItem (빈 메시지)** | `isStreaming && contents.length === 0` | 스트리밍 중이지만 아직 콘텐츠가 없을 때 |
| **ShimmerCard (placeholder)** | `content.type === 'placeholder' && isStreaming` | 백엔드가 보낸 placeholder 콘텐츠 블록 렌더링 |

### 4.3 방어적 필터링

`MessageItem`의 `ContentBlock`에서 `isStreaming`이 아닌 메시지의 placeholder는 렌더링하지 않는다:

```typescript
case 'placeholder':
  if (!isStreaming) return null; // 잔여 placeholder 무시
  return <ShimmerCard content={content} variant="placeholder" />;
```

이는 ContentMerger를 우회한 경로에서 placeholder가 잔존하는 경우를 대비한 안전장치다.

---

## 5. 타임라인

Job 실행 시 사용자가 보는 시각적 피드백의 타임라인:

```
시간 ─────────────────────────────────────────────────────────►

[Job 제출]
    │ isRunning = true
    ▼
Footer TypingIndicator (...) ← 메시지 없이 Job 실행 중
    │
    ▼ message_start 수신
    │
MessageItem TypingIndicator (...) ← placeholder 콘텐츠
    │
    ▼ 첫 thinking 토큰
    │
ThinkingVariant (접이식 사고 과정 블록)
    │
    ▼ 첫 response 토큰
    │
텍스트 스트리밍 (실시간 타이핑)
    │
    ├─▶ file_start → 파일 카드 (placeholder 자동 교체)
    ├─▶ command → 명령 카드 (placeholder 자동 교체)
    │
    ▼ <clarify> 태그 감지
    │
TypingIndicator (...) ← clarify_start로 placeholder 재주입
    │
    ▼ clarify 질문지 완성
    │
Clarify 질문지 표시
    │
    ▼ 메시지 완료
    │
isRunning = false, isStreaming = false
```

---

## 6. 주의사항

### 6.1 ContentMerger 우회 금지

파일·명령 카드 등 새 콘텐츠를 추가할 때 반드시 `ContentMerger.addContent()`를 경유해야 한다.
직접 `session.currentMessage.contents.push()`하면 placeholder가 잔존하여 TypingIndicator가 중복 노출된다.

### 6.2 SSE 이벤트의 projectId/featureName

`MessageBroadcaster`를 거치지 않고 직접 Redis publish하는 경우,
`data` 객체 안에 반드시 `projectId`와 `featureName`을 포함해야 한다.
`SSEManager.routeMessage()`가 외부 envelope을 벗기고 `data`만 handler에 전달하기 때문이다.

### 6.3 isRunning과 TypingIndicator

`isRunning = true`인데 `inline_ask_complete` 같은 종료 이벤트가 프론트엔드에 도달하지 못하면
TypingIndicator가 무한히 표시된다. SSE context 필터(`projectId`/`featureName` 일치 확인)를 통과하지 못하는 이벤트가 없는지 항상 확인해야 한다.
