# Chat Service 리팩토링 계획서

> **상태: ✅ 완료** (2026-02-05)

## 1. 현황 분석

### 1.1 현재 아키텍처 문제점

```
현재 흐름 (비효율적):
LLM API
    │ 스트리밍 청크
    ▼
ant-job (Job Worker)
    │ HTTP POST (매 청크마다!)
    ▼
ant-api (Round-robin → 아무 Pod)
    │ Redis GET (세션 로드 - cross-pod 대응)
    │ ContentMerger 로직 실행
    │ Redis SET (세션 저장)
    │ Redis PUBLISH
    ▼
ant-realtime → SSE → ant-ui
```

**문제점:**
1. 매 LLM 청크마다 HTTP 요청 발생 (수천 번)
2. Round-robin으로 매번 다른 Pod로 갈 수 있음
3. Cross-pod recovery 위해 매번 Redis GET/SET 필요
4. 불필요한 네트워크 hop (job → api → redis)

### 1.2 리팩토링 후 아키텍처

```
개선된 흐름:
LLM API
    │ 스트리밍 청크
    ▼
ant-job (Job Worker)
    │ LLMResponseService (직접 처리)
    │ ContentMerger 로직 실행
    │ Redis SET + PUBLISH (배칭 가능)
    ▼
ant-realtime → SSE → ant-ui

API Server (ant-api):
    │ ChatService (경량화)
    │ - 메시지 조회/삭제
    │ - triage 처리
    │ - 유저 메시지 추가
    ▼
Redis (읽기 위주)
```

---

## 2. 완료된 작업

### ✅ Phase 1: 공통 모듈 추출

**생성된 파일:**
```
packages/ant-cli/src/core/chat/
├── index.ts              # 배럴 파일
├── types.ts              # 타입 정의 (MessageContent, ChatMessage, ChatSession 등)
├── ContentMerger.ts      # 콘텐츠 병합 로직
├── MessageBroadcaster.ts # Redis Pub/Sub 래퍼
└── schema.ts             # Redis 키 패턴, 세션 변환 함수
```

### ✅ Phase 2: LLMResponseService 생성 (디렉토리 구조)

**생성된 파일:**
```
packages/ant-cli/src/core/llm-response/
├── index.ts                    # 배럴 파일 + 팩토리 함수
├── types.ts                    # LLMResponseService 전용 타입
├── LLMResponseService.ts       # 메인 서비스 (facade)
├── SessionStore.ts             # Redis 세션 관리
├── LLMEventHandler.ts          # LLM 스트림 이벤트 처리
├── FileOperationHandler.ts     # 파일 작업 처리
├── CommandExecutionHandler.ts  # 명령 실행 처리
└── ChatStatusHandler.ts        # 채팅 상태 메시지 처리
```

### ✅ Phase 3: ChatAPIClient 교체

**변경 파일:**
- `src/core/adapters/ChatAPIClient.ts`

**변경 내용:**
- HTTP 호출 제거
- LLMResponseService를 내부적으로 사용하도록 변경
- ANT_REDIS_URL 환경변수로 Redis 직접 접근
- 기존 public API는 100% 호환 유지

```typescript
// 사용법 변경 없음 (기존 코드 그대로 동작)
const client = getChatAPIClient();
await client.startMessage();
await client.sendLLMEvent(event);
await client.finalizeMessage();
```

### ✅ Phase 4: ChatService 스트리밍 엔드포인트 제거

**변경 파일:**
- `src/periphery/adapters/http/routes/chat.routes.ts`

**제거된 엔드포인트:**
- `POST /chat/start-message`
- `POST /chat/llm-event`
- `POST /chat/finalize-message`
- `POST /chat/add-content`
- `POST /chat/file-operation`
- `POST /chat/command-execution`
- `GET /chat/has-active-message`
- `POST /chat/triage-choice-message`

**유지된 엔드포인트:**
- `GET /chat/messages` - 메시지 조회
- `DELETE /chat/messages` - 메시지 삭제
- `POST /chat/user-message` - 유저 메시지 추가
- `POST /chat/job-error` - Job 에러 메시지
- `POST /chat/triage-choice` - 사용자 선택 처리
- `GET /chat/pending-choice` - 펜딩 선택 확인
- `POST /chat/cancelled-choice` - 취소 선택 처리

### ✅ Phase 5: 특수 케이스 처리

**GitService/indexing:**
- ChatService를 계속 사용 (API 서버에서 실행)
- 변경 없음

**JobCleanupManager:**
- ChatService 사용 확인되지 않음
- 필요시 추후 처리

### ✅ Phase 6: 테스트 및 검증

- TypeScript 타입 체크: ✅ 통과
- ESLint: ✅ 에러 없음

---

## 3. 새로운 아키텍처 요약

### 3.1 서비스 분리

| 서비스 | 위치 | 역할 |
|--------|------|------|
| **LLMResponseService** | ant-job (core/llm-response) | LLM 스트리밍 처리, 파일 작업, 명령 실행 |
| **ChatService** | ant-api (periphery/services) | 메시지 CRUD, triage, 유저 메시지 |
| **공통 모듈** | core/chat | 타입, ContentMerger, MessageBroadcaster, Redis 스키마 |

### 3.2 데이터 흐름

```
[Job Worker]
    └── ChatAPIClient (wrapper)
        └── LLMResponseService
            ├── SessionStore → Redis (세션 저장)
            ├── ContentMerger → 콘텐츠 병합
            └── MessageBroadcaster → Redis Pub/Sub
                                        │
                                        ▼
                                 [ant-realtime]
                                        │
                                        ▼ SSE
                                   [ant-ui]

[API Server]
    └── ChatService
        ├── 메시지 조회/삭제
        ├── 유저 메시지 추가
        └── triage 처리
```

### 3.3 기대 효과

1. **HTTP 오버헤드 제거**: 매 청크마다 HTTP 요청 → 직접 Redis 접근
2. **Cross-Pod 복잡도 제거**: ensureActiveMessageAsync 불필요
3. **레이턴시 감소**: 네트워크 hop 감소 (job → api → redis → job → api → redis)
4. **코드 분리**: 스트리밍 로직과 UI 대응 로직 명확히 분리

---

## 4. 사용 가이드

### 4.1 Job Worker에서 LLM 응답 처리

```typescript
// ChatAPIClient를 그대로 사용 (내부적으로 LLMResponseService 사용)
import { getChatAPIClient } from '../core/adapters/ChatAPIClient';

const client = getChatAPIClient();

// 메시지 시작
await client.startMessage();

// LLM 이벤트 전송
await client.sendLLMEvent({
  type: 'text',
  text: 'Hello, world!'
});

// 상태 표시
await client.showChatStatus('reading', { filePath: '/src/index.ts' });

// 메시지 완료
await client.finalizeMessage();
```

### 4.2 API Server에서 메시지 조회

```typescript
// ChatService 사용 (기존과 동일)
const messages = chatService.getMessages(projectId, featureName, userContext);
```

---

## 5. 참고 사항

### 5.1 환경 변수

LLMResponseService가 작동하려면 다음 환경 변수가 필요:

```bash
ANT_REDIS_URL=redis://localhost:6379
ANT_PROJECT_ID=my-project
ANT_FEATURE_NAME=my-feature
ANT_JOB_ID=job-123
# Optional for cloud mode:
ANT_USER_ID=user-id
ANT_ORGANIZATION_ID=org-id
```

### 5.2 하위 호환성

- `getChatAPIClient()` API는 100% 하위 호환
- 기존 코드 변경 불필요
- HTTP 엔드포인트 제거로 인해 레거시 HTTP 호출 시 404 에러 발생
