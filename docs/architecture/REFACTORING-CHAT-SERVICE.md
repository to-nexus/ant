# Chat Service 아키텍처

> **최종 업데이트: 2026-02-08** (ChoiceCard continue 흐름 추가)

## 1. 아키텍처 개요

### 1.1 구 아키텍처 (리팩토링 전)

```
LLM API
    │ 스트리밍 청크
    ▼
ant-job (Job Worker)
    │ HTTP POST (매 청크마다!)
    ▼
ant-api (Round-robin → 아무 Pod)
    │ Redis GET (세션 로드)
    │ ContentMerger 로직 실행
    │ Redis SET (세션 저장)
    │ Redis PUBLISH (글로벌 채널)
    ▼
ant-realtime → SSE → ant-ui
```

**문제점:**
1. 매 LLM 청크마다 HTTP 요청 발생 (수천 번)
2. Round-robin으로 매번 다른 Pod로 갈 수 있음
3. Cross-pod recovery 위해 매번 Redis GET/SET 필요
4. 글로벌 Pub/Sub 채널로 모든 사용자에게 이벤트 전파

### 1.2 신 아키텍처 (현재)

```
LLM API
    │ 스트리밍 청크
    ▼
ant-job (Job Worker → child process)
    │ LLMResponseService (직접 처리)
    │ ContentMerger 로직 실행
    │ Redis SET + PUBLISH (user-scoped)
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

## 2. 서비스 분리

| 서비스 | 위치 | 역할 |
|--------|------|------|
| **LLMResponseService** | core/llm-response | LLM 스트리밍 처리, 파일 작업, 명령 실행 |
| **ChatService** | periphery/services/ChatService | 메시지 CRUD, triage, 유저 메시지 |
| **MessageBroadcaster** | core/chat | user-scoped Redis Pub/Sub 래퍼 |
| **KanbanBroadcaster** | core/realtime | 칸반 보드 실시간 업데이트 |
| **WorkflowBroadcaster** | core/realtime | 워크플로우 UI 실시간 업데이트 |
| **FileTreeBroadcaster** | core/realtime | 파일트리 실시간 업데이트 |

### 2.1 데이터 흐름

```
[Job Worker → child process (job-runner)]
    └── ChatAPIClient (wrapper)
        └── LLMResponseService
            ├── SessionStore → Redis SET (세션 저장)
            ├── ContentMerger → 콘텐츠 병합
            └── MessageBroadcaster → Redis PUBLISH
    └── KanbanBroadcaster → Redis PUBLISH      ─┐
    └── WorkflowBroadcaster → Redis PUBLISH     │
    └── FileTreeBroadcaster → Redis PUBLISH     │
                                                │
                    realtime:broadcast:{orgId}:{userId}
                    realtime:workflow:{orgId}:{userId}
                                                │
                                     [ant-realtime]
                                         │ SSE
                                      [ant-ui]

[API Server]
    └── ChatService
        ├── GET  /chat/messages        (메시지 조회)
        ├── DELETE /chat/messages       (메시지 삭제)
        ├── POST /chat/user-message    (유저 메시지 추가)
        ├── POST /chat/job-error       (Job 에러 메시지)
        ├── POST /chat/triage-choice   (사용자 선택 처리)
        ├── GET  /chat/pending-choice  (펜딩 선택 확인)
        └── POST /chat/cancelled-choice (취소 선택 처리)
```

---

## 3. Redis 채널 구조

> **중앙 정의**: `src/infrastructure/state/redisConstants.ts`

### 3.1 Pub/Sub 채널 (사용자 스코프)

| 채널 | 생성 함수 | Publisher | Subscriber | 용도 |
|------|-----------|-----------|------------|------|
| `realtime:broadcast:{orgId}:{userId}` | `getRealtimeBroadcastChannel()` | Job Worker (child) | Realtime Server | Chat, Kanban, FileTree |
| `realtime:workflow:{orgId}:{userId}` | `getRealtimeWorkflowChannel()` | Job Worker (child) | Realtime Server | Workflow UI |
| `job:stop` | `REDIS_CHANNELS.JOB_WORKER.STOP` | API Server | Job Worker | 작업 중지 신호 |
| `job:status:updates` | `REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES` | Job Worker | API Server | 작업 완료/실패 알림 |

### 3.2 Multi-Tenant 격리

모든 실시간 채널은 `{orgId}:{userId}` 스코프:
- 사용자 A의 이벤트는 사용자 B에게 누출되지 않음
- Realtime Server는 SSE 연결 시 `userContext`에서 채널명 결정
- `parseChannelUserContext(channel)` 함수로 채널에서 사용자 정보 추출

---

## 4. 환경변수

### 4.1 인프라 환경변수 (DevOps 관리, .env)

| 변수 | 서비스 | 설명 |
|------|--------|------|
| `ANT_REDIS_URL` | 전체 | Redis 연결 URL |
| `ANT_API_URL` | Job Worker | API Server 내부 URL |
| `ANT_SERVER_MODE` | API Server | `local` or `cloud` |
| `ANT_WORKSPACE_BASE_PATH` | 전체 | 워크스페이스 기본 경로 |

### 4.2 런타임 환경변수 (부모 프로세스가 주입)

> **중앙 정의**: `src/core/types/processEnv.ts` (CHILD_PROCESS_ENV)

| 변수 | 필수 | 설명 |
|------|------|------|
| `ANT_USER_ID` | ✅ | 인증된 사용자 ID |
| `ANT_ORG_ID` | ✅ | 인증된 조직 ID |
| `ANT_JOB_ID` | ✅ | Job 고유 식별자 |
| `ANT_PROJECT_ID` | ✅ | 프로젝트 ID |
| `ANT_FEATURE` | ✅ | Feature 이름 |
| `ANT_REDIS_URL` | ✅ | Redis URL (부모에서 전달) |

> **주의**: `ANT_USER_ID`와 `ANT_ORG_ID`는 `.env`에 설정하지 않습니다.
> 인증 세션에서 동적으로 결정되며, 자식 프로세스에 환경변수로 전달됩니다.

**주입 경로:**
```
사용자 로그인 → API 요청 (userContext 포함)
    → JobWorker.ts (cloud) / JobExecutionManager.ts (local)
        → child process env: { ANT_USER_ID, ANT_ORG_ID, ... }
            → job-runner.ts (reads env vars)
                → ChatAPIClient, Broadcasters (use env vars for channels)
```

---

## 5. 파일 구조

```
packages/ant-cli/src/
├── core/
│   ├── chat/
│   │   ├── index.ts              # 배럴 파일
│   │   ├── types.ts              # 타입 정의
│   │   ├── ContentMerger.ts      # 콘텐츠 병합 로직
│   │   ├── MessageBroadcaster.ts # Redis Pub/Sub 래퍼 (user-scoped)
│   │   └── schema.ts             # 세션 키 생성, 변환 함수
│   │
│   ├── llm-response/
│   │   ├── index.ts              # 팩토리 함수
│   │   ├── types.ts              # 전용 타입
│   │   ├── LLMResponseService.ts # 메인 서비스 (facade)
│   │   ├── SessionStore.ts       # Redis 세션 관리
│   │   ├── LLMEventHandler.ts    # LLM 스트림 이벤트 처리
│   │   ├── FileOperationHandler.ts
│   │   ├── CommandExecutionHandler.ts
│   │   └── ChatStatusHandler.ts
│   │
│   ├── realtime/                 # Broadcaster (직접 Redis Pub/Sub)
│   │   ├── KanbanBroadcaster.ts
│   │   ├── WorkflowBroadcaster.ts
│   │   └── FileTreeBroadcaster.ts
│   │
│   └── types/
│       └── processEnv.ts         # 런타임 환경변수 중앙 정의
│
├── infrastructure/
│   └── state/
│       ├── redisConstants.ts     # Redis 키/TTL/채널 중앙 정의
│       ├── redisKeyUtils.ts      # IDE/Preview 키 생성/파싱
│       ├── RedisStateStore.ts    # Redis 구현체
│       └── index.ts              # 배럴 파일
│
└── composition/
    └── job-runner.ts             # 자식 프로세스 진입점
```

---

## 6. ChoiceCard와 작업 중단/재개 흐름

### 6.1 ChoiceCard 개요

작업이 중단되면 Chat UI에 `ChoiceCard` (variant: `cancelled`)가 렌더링된다.
사용자는 세 가지 방법으로 중단 상태를 해소할 수 있다:

| 방법 | UI 요소 | API 호출 | ChoiceCard 결과 |
|------|---------|----------|-----------------|
| **Resume 버튼** | ChoiceCard 내 Resume 버튼 | `POST /chat/cancelled-choice` → `POST /jobs/:id/resume` | `Resumed` 뱃지 |
| **Dismiss 버튼** | ChoiceCard 내 Dismiss 버튼 | `POST /chat/cancelled-choice` | `Dismissed` 뱃지 |
| **Chat 입력 (directive)** | ChatInput 텍스트 입력 | `POST /chat/cancelled-choice` → `POST /jobs/:id/continue` | `Continued` 뱃지 |

### 6.2 데이터 흐름

```
[작업 중단]
    │
    ├── JobCleanupManager.cleanupJobState()
    │   └── session.state.interruption 저장
    │
    ├── KanbanBroadcaster → SSE (kanbanData.interruption)
    │   └── ant-ui: KanbanPausedPrompt 표시
    │
    └── MessageManager → SSE (cancelled_message)
        └── ant-ui: ChoiceCard 렌더링

[작업 재개: Resume 버튼]
    │
    ├── ChoiceCard.handleResume()
    │   ├── submitCancelledChoice(jobId, 'resume')
    │   │   └── chat.routes: metadata { choiceSelected: 'resume', resolvedLabel: 'Resumed' }
    │   ├── persistChoice() → 로컬 store 즉시 업데이트
    │   └── runJob() → 새 job 실행 (resume route)
    │
    └── ChoiceCard: ResolvedBadge('Resumed', icon: Play)

[작업 재개: Chat 입력 (directive)]
    │
    ├── ChatInput → hasInterruption 감지
    │   ├── submitCancelledChoice(jobId, 'continue')
    │   │   └── chat.routes: metadata { choiceSelected: 'continue', resolvedLabel: 'Continued' }
    │   ├── setDismissedInterruptTimestamp() → Kanban prompt 숨김
    │   └── continueJob() → 기존 job 재실행 (continue route → revise)
    │
    └── ChoiceCard: ResolvedBadge('Continued', icon: MessageSquare)
```

### 6.3 ChoiceCard 상태 결정

```typescript
// 버튼 표시 조건
canResume = !isRunning && jobId && selectedProject && selectedFeature && !!reason

// 해결 상태 표시 조건
isSelected = !!content.metadata?.choiceSelected
resolvedLabel = content.metadata?.resolvedLabel  // 'Resumed' | 'Dismissed' | 'Continued'
```

### 6.4 Kanban Interruption vs ChoiceCard

| 구분 | KanbanPausedPrompt | ChoiceCard (cancelled) |
|------|-------------------|----------------------|
| **데이터 소스** | `kanbanData.interruption` (SSE) | 채팅 메시지 metadata |
| **숨김 조건** | `dismissedInterruptTimestamp` 일치 | `choiceSelected` 존재 |
| **위치** | 칸반 보드 상단 | 채팅 메시지 리스트 내 |
| **영속성** | 세션 중 휘발 (store) | chat.json에 저장 |

---

## 7. 제거된 레거시

| 항목 | 파일 | 설명 |
|------|------|------|
| `REDIS_KEY_PREFIX` | core/chat/schema.ts | 중복 상수 (`REDIS_DOMAINS.CHAT` 사용) |
| `CHAT_BROADCAST_CHANNEL` | core/chat/MessageBroadcaster.ts | 글로벌 채널 → user-scoped 채널로 교체 |
| `buildJobKey` / `buildSessionKey` | redisConstants.ts | 미사용 헬퍼 |
| `getJobStopChannel` / `parseJobStopChannel` | redisConstants.ts | 미사용 함수 |
| backward compat aliases | redisKeyUtils.ts | `createIDEInstanceKey` 등 6개 |
| 로컬 `KEYS` 상수 | KubernetesIDEOrchestrator.ts | 중앙 상수로 통합 |
| HTTP 스트리밍 엔드포인트 | chat.routes.ts | `/chat/start-message`, `/chat/llm-event` 등 8개 |
