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

## 통합 메시지 콘텐츠 타입

`MessageContent.type`은 단일 유니온 타입으로 모든 채팅 콘텐츠를 표현한다.

| 카테고리 | 타입 |
|----------|------|
| Chat Status (진행 표시) | `placeholder`, `thinking`, `exploring`/`explored`, `retrieving`/`retrieved`, `grepping`/`grepped`, `reading`/`read`, `reading_source`/`read_source`, `indexing`/`indexed`, `analyzing`/`analyzed`, `loading`/`loaded`, `storing`/`stored`, `learning`/`learned`, `processing`/`processed`, `downloading`/`downloaded`, `figma_calling`/`figma_called` |
| 일반 콘텐츠 | `text`, `cancelled`, `triage_choice`, `choice_card`, `context_loaded`, `task_response` |
| 파일 연산 (실시간) | `file_creating`/`file_writing`/`file_create`/`file_create_failed`, `file_editing`/`file_updating`/`file_edit`/`file_edit_failed`, `file_deleting`/`file_delete`/`file_delete_failed`, `file_conflict`/`file_conflict_retry` |
| 도구 연산 | `tool_action`, `listing_files`/`listed_files`, `searching_code`/`searched_code`, `searching_reference`/`searched_reference` |
| 명령 실행 | `command_running`/`command_streaming`/`command` |
| Plan 스트리밍 | `plan_generating`/`plan` |

진행 중/완료 쌍(예: `exploring`→`explored`)은 ContentMerger의 fallback merge로 자동 매칭된다. `INFORMATIONAL_TYPES`(`context_loaded`)는 placeholder와 공존할 수 있다.

## ContentMerger

새 콘텐츠 추가 시 Universal Placeholder System에 따른 8단계 처리 파이프라인:

| 우선순위 | 케이스 | 동작 |
|----------|--------|------|
| 1 | 새 placeholder + 기존 placeholder 존재 | 기존 위치에서 in-place 교체 |
| 2 | 비-informational 콘텐츠 + placeholder 존재 | placeholder와 병합 (placeholder 소멸) |
| 3 | `_mergeIndex` 메타데이터 | 명시적 인덱스에 직접 병합 |
| 4 | 완료 상태 (`explored`, `read` 등) | 역방향 검색으로 대응하는 진행 중 상태와 병합 |
| 5 | 완료 타입 중복 | 무시 (dedup) |
| 6 | thinking 블록 전환 | duration 계산, collapse 브로드캐스트 |
| 7 | 같은 타입 스트리밍 | 내용 append (`text`, `thinking`, `plan_generating`, `task_response`, 동일 파일) |
| 8 | 파일 연산 완료 | `activeFileOperations` 또는 타입 기반 검색으로 진행 중 카드 업데이트 |

Placeholder는 contents[] 배열의 **어느 위치에나** 존재할 수 있다 (informational 타입이 뒤에 추가될 수 있기 때문). 모든 콘텐츠 추가는 반드시 `ContentMerger.addContent()`를 경유해야 한다.

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

## SSE 재연결 시 메시지 유실 방지

SSE 연결이 끊겼다 복구되면, 스트리밍 중이던 assistant 메시지의 중간 콘텐츠가 유실될 수 있다. 이를 방지하기 위해 재연결 시 Redis에 저장된 현재 세션 스냅샷과 프론트엔드 상태를 동기화한다.

## Choice Card

### Variant

| Variant | 용도 |
|---------|------|
| `triage_choice` | 작업 라우팅 선택 |
| `cancelled` | 작업 취소 후 재개/무시 |
| `eval_save` | 평가 리포트 저장 |
| `spec_complete` | 스펙 완료 확인 |
| `clarifying` | PRD 생성 시 다수 질문 (Compound Card) |

### Compound Clarifying Card

N개 질문을 하나의 카드에 묶어 표시한다. 질문별 옵션 버튼과 인라인 직접입력을 지원한다. 1개 이상 응답 시 제출 가능(partial 허용). 모든 선택은 Zustand `pendingClarifyAnswers`에 저장되며 ChatInput과 공유된다.

## 경계

- Redis Pub/Sub 채널: [02-infrastructure.md](02-infrastructure.md)
- SSE 연결과 브로드캐스팅: [21-realtime-system.md](21-realtime-system.md)
- Triage Choice: [12-triage-routing.md](12-triage-routing.md)
- Planner Clarify: [16-planner-job.md](16-planner-job.md)
