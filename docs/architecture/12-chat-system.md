# Chat System

## 개요

Chat 시스템은 사용자와 AI 에이전트 간의 대화를 관리한다. LLM 스트리밍 응답 처리, 콘텐츠 병합, Choice Card, Activity Indicator로 구성된다. Job Worker가 직접 Redis에 접근하여 채팅 상태를 관리한다.

## 서비스 분리

| 서비스 | 위치 | 역할 |
|--------|------|------|
| LLMResponseService | Job Worker (자식 프로세스) | LLM 스트리밍 처리, 콘텐츠 병합, Redis 저장/publish |
| ChatService | API Server | 메시지 CRUD, triage 처리, 유저 메시지 추가 |
| MessageBroadcaster | Job Worker | user-scoped Redis Pub/Sub 래퍼 |

### 데이터 흐름

```
LLM API -> LLM 스트리밍 청크
    -> LLMResponseService (자식 프로세스 내 직접 처리)
        -> ContentMerger (콘텐츠 병합)
        -> SessionStore -> Redis SET (세션 저장)
        -> MessageBroadcaster -> Redis PUBLISH (user-scoped 채널)
    -> Realtime Server (subscribe) -> SSE -> ant-ui

API Server (ChatService):
    GET  /chat/messages        (메시지 조회)
    DELETE /chat/messages      (메시지 삭제)
    POST /chat/user-message    (유저 메시지 추가)
    POST /chat/triage-choice   (사용자 선택 처리)
    GET  /chat/pending-choice  (펜딩 선택 확인)
```

Job Worker는 API Server를 거치지 않고 직접 Redis에 접근한다.

## ContentMerger

새 콘텐츠 추가 시 placeholder 처리 규칙:

| 새 콘텐츠 타입 | 기존 placeholder | 동작 |
|---------------|-----------------|------|
| `placeholder` | 없음 | 추가 |
| `placeholder` | 있음 | 교체 (in-place) |
| `thinking` | 있음 | placeholder를 thinking으로 교체 |
| `text`, `file`, `command` 등 | 있음 | placeholder 제거 + 새 콘텐츠 추가 |
| INFORMATIONAL (`context_loaded`) | 있음 | placeholder 유지, 새 콘텐츠도 추가 (공존) |

모든 콘텐츠 추가는 반드시 `ContentMerger.addContent()`를 경유해야 한다. 직접 push하면 placeholder가 잔존한다.

## Chat Activity Indicator (CAI)

사용자에게 "시스템이 작업 중"임을 알려주는 시각적 피드백 시스템.

### 설계 원칙

- Zero-Gap Feedback: Job 시작부터 첫 LLM 토큰까지 빈 화면 없음
- Auto-Inject / Auto-Remove: placeholder 자동 삽입/제거
- Single Source of Truth: ContentMerger가 placeholder 수명주기 단독 관리

### Placeholder 자동 주입 시점

| 시점 | 호출 경로 |
|------|----------|
| 새 assistant 메시지 시작 | `LLMResponseService.startMessage()` -> `showChatStatus('placeholder')` |
| `<clarify>` 태그 감지 | `XMLStreamParser` -> `clarify_start` -> `showChatStatus('placeholder')` |
| 환경 감지 시작 | `detectEnvironment()` -> `showChatStatus('placeholder')` |

### 프론트엔드 TypingIndicator 출현 조건

| 위치 | 조건 |
|------|------|
| ChatHistory Footer | isRunning && !hasActiveStreamingAssistant |
| MessageItem (빈 메시지) | isStreaming && contents.length === 0 |
| ShimmerCard (placeholder) | content.type === 'placeholder' && isStreaming |

isStreaming이 아닌 메시지의 잔여 placeholder는 렌더링하지 않는다 (방어적 필터링).

## Choice Card

### Variant

| Variant | 용도 |
|---------|------|
| `triage_choice` | 작업 라우팅 선택 |
| `cancelled` | 작업 취소 후 재개/무시 |
| `eval_save` | 평가 리포트 저장 |
| `prd_apply` | PRD 적용 |
| `clarifying` | PRD 생성 시 다수 질문 (Compound Card) |

### Compound Clarifying Card

N개 질문을 하나의 카드에 묶어 표시한다. 질문별 옵션 버튼과 인라인 직접입력을 지원한다. 1개 이상 응답 시 제출 가능(partial 허용). 모든 선택은 Zustand `pendingClarifyAnswers`에 저장되며 ChatInput과 공유된다.

## 경계

- Redis Pub/Sub 채널: [01-infrastructure.md](01-infrastructure.md)
- SSE 연결과 브로드캐스팅: [09-realtime-system.md](09-realtime-system.md)
- Triage Choice: [04-triage-routing.md](04-triage-routing.md)
- Planner Clarify: [07-planner-job.md](07-planner-job.md)
