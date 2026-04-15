# Agent Architecture

## 개요

ANT의 에이전트는 LangGraph StateGraph로 구현된다. 각 에이전트는 특화된 역할을 가지며, 공통 인프라(Triage, Broadcaster, Checkpoint)를 공유한다. 병렬 태스크 실행은 TaskOrchestrator/TaskWorker 패턴으로 처리한다.

## 에이전트 목록

| Agent | 역할 | Job 타입 |
|-------|------|----------|
| planner | PRD 작성/수정 | plan |
| architect | 설계, 구현, 학습, 질의응답 | design, code, learn, ask, inline-ask |
| creator | 크리에이티브 에셋 생산 (visual, audible, animation 등) | visual (향후 audible 등 확장) |
| reviewer | 코드 리뷰 (예정) | review |
| doc | 문서 생성 (예정) | doc |

### 에이전트 간 관계

planner의 산출물(`inputs/sources/prd.md`)이 architect의 입력이 된다. creator는 독립적으로 동작하며, PRD나 directive를 참조하여 프로젝트 에셋을 생산한다. 현재 visual job이 구현되어 있으며, audible/animation 등은 향후 추가 예정이다. planner -> architect -> reviewer 순서로 워크플로우가 진행된다.

## 디렉토리 규약

### 배치 원칙

> **2개 이상의 sub-graph에서 사용하면 agent root, 1개 sub-graph에서만 사용하면 해당 graph 내부.**

### 정규 구조

```
agents/<agent>/
  index.ts              # Entry point
  types/                # Agent-level types (2+ sub-graph에서 공유)
    index.ts
    [domain].ts         # 도메인별 타입 (예: task.ts)
  [memory/]             # Vector memory (optional, 2+ sub-graph에서 사용 시)
  graph/
    <jobType>/
      graph.ts          # StateGraph 정의
      runner.ts         # Graph runner
      state.ts          # State + Annotation
      nodes/            # Graph 노드
      [session/]        # Graph-specific (1개 graph 전용)
      [utils/]          # Graph-specific (1개 graph 전용)
      [parallel/]       # 병렬 실행
      [routers/]        # 라우팅 로직
      [config/]         # 설정

agents/common/
  graph/                # 전 에이전트 공유 그래프 노드/헬퍼
  tool/                 # 전 에이전트 공유 툴 시스템
```

`[]`로 표기된 디렉토리는 필요 시에만 생성한다.

### 배치 판정표

| 조건 | 위치 | 예시 |
|------|------|------|
| 2+ sub-graph에서 import | `<agent>/` root | `memory/`, `types/task.ts` |
| 1개 sub-graph에서만 import | `graph/<jobType>/` 내부 | `graph/code/session/`, `graph/code/utils/` |
| 전 에이전트 공유 | `common/` | triage, tool handlers |

### 금지 패턴

- `<agent>/types.ts`(파일)과 `<agent>/types/`(디렉토리) 공존 — `types/index.ts`로 통일
- 1개 graph 전용 코드를 agent root에 배치 (참조 범위 원칙 위반)

## LangGraph 패턴

### StateGraph 구조

모든 에이전트 그래프는 다음 패턴을 따른다:

1. **State 정의**: channels에 모든 상태 필드를 선언
2. **노드 등록**: 각 노드는 state를 받아 부분 state를 반환하는 함수
3. **엣지 정의**: 조건부 라우팅으로 노드 간 전이를 결정
4. **Runner**: 그래프를 컴파일하고 invoke. resume state 복원, recursion limit 설정

### 공통 노드

| 노드 | 위치 | 역할 |
|------|------|------|
| triage | `agents/common/nodes/triage/` | 의도 분류, 라우팅 |
| detect | `agents/common/nodes/detect/` | RAC 생성. explicit/infer 경로 모두 `resolveToRAC()` 단일 퍼널 |
| resolve | 각 에이전트 graph 내 | 초기 상태 로드, resume 판정 |
| learn | 각 에이전트 graph 내 | 세션 저장, 워크플로우 종료 |

### Progressive Basis (detect → decompose)

basis는 detect와 decompose 구간에서 점진적으로 확정된다:

| 단계 | 확정 내용 | 소스 |
|------|-----------|------|
| detect | `RAC.basis.techTier` (preset) | UI BasisSelector → `ActionMetadata.basis` (explicit 경로만) |
| decompose | `RAC.basis.techTier` (final) | `mergeTechTier(preset, inferred)` — preset 필드 우선, 빈 필드는 LLM 추론으로 채움 |
| decompose | `RAC.basis.visualTier` | 향후 확장 예정 (구조만 확보) |

`getTechTier(state)` / `getBasis(state)` 헬퍼로 RAC에서 읽는다.

### Broadcaster

Job 실행 중 상태 변경은 Redis Pub/Sub를 통해 실시간 전파된다.

| Broadcaster | 역할 | 채널 |
|-------------|------|------|
| KanbanBroadcaster | 태스크 큐 상태 | `realtime:broadcast:{orgId}:{userId}` |
| WorkflowBroadcaster | 그래프 노드 상태 | `realtime:workflow:{orgId}:{userId}` |
| MessageBroadcaster | 채팅 메시지 | `realtime:broadcast:{orgId}:{userId}` |
| FileTreeBroadcaster | 파일 변경 | `realtime:broadcast:{orgId}:{userId}` |

## 병렬 태스크 실행

`ANT_TASK_CONCURRENCY > 1`일 때 활성화된다 (기본값: 3).

### 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| TaskOrchestrator | 중앙 조정자. 태스크 할당, 충돌 검사, 체크포인트 |
| TaskWorker | 독립 태스크 실행기. Worker Subgraph invoke |
| Worker Subgraph | 메인 그래프의 경량 버전. 단일 태스크 실행 |
| AsyncMutex | 공유 상태 보호를 위한 단일 프로세스 async mutex |

### 태스크 속성

| 필드 | 타입 | 역할 |
|------|------|------|
| `exclusive` | boolean | true면 단독 실행 (barrier) |
| `parallelGroup` | string | 같은 그룹은 동시 실행 불가 |
| `priority` | number | 낮을수록 먼저 실행 (100: setup, 200-300: feature, 1000: final) |
| `packages` | string[] | 태스크가 속한 패키지 (설계 문서 split injection용) |

### 할당 알고리즘

1. 현재 실행 중인 parallelGroup 목록 수집
2. taskQueue 순회:
   - exclusive 태스크 -> barrier, 순회 중단
   - parallelGroup 미지정 -> running이 0일 때만 할당
   - parallelGroup이 running과 충돌 -> skip
   - 충돌 없음 -> 할당

### 오류 처리

| 오류 분류 | 예시 | 재시도 |
|-----------|------|--------|
| 결정적 (deterministic) | prompt too long, 400, 401, 403 | 즉시 실패 처리 |
| 일시적 (transient) | timeout, rate limit, 5xx | 최대 2회 재시도 |

실패한 태스크가 있어도 다른 실행 중 태스크는 계속 완료를 허용한다. 모든 태스크 종료 후 failedTasks가 있으면 Job을 `interrupted` 상태로 마킹한다 (`canResume: true`).

### Graceful Shutdown

```
handleInterruption(reason)
    1. drain = true, 주기적 체크포인트 중지
    2. 모든 worker에 requestStop() 호출
    3. running 태스크를 interrupted로 마킹, 큐에 복원
    4. 체크포인트 저장
    5. running 태스크가 0이면 run() resolve
```

## 세션 구조

### 디렉토리 레이아웃

```
sessions/
    architect/
        design.json
        code.json
        learn.json
    planner/
        plan.json
    creator/
        visual.json
    chat.json          (에이전트 무관, UI 레벨)
```

### 타입 계층

| 타입 | 값 | 의미 |
|------|---|------|
| `JobType` | code, design, learn, ask, plan, inline-ask, visual | 전체 Job 타입 |
| `DecomposableJobType` | code, design, learn | 태스크 분해가 있는 Job |
| `SessionableJobType` | code, design, learn, plan, visual | 세션 파일을 가지는 Job |

## 경계

- Job 큐와 실행 흐름: [10-job-lifecycle.md](10-job-lifecycle.md)
- Triage 분류: [12-triage-routing.md](12-triage-routing.md)
- Code Job 상세: [14-code-job.md](14-code-job.md)
- Design Job 상세: [15-design-job.md](15-design-job.md)
- Planner Job 상세: [16-planner-job.md](16-planner-job.md)
- Ask 시스템: [17-ask-system.md](17-ask-system.md)
- Visual Job 상세: [18-visual-job.md](18-visual-job.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, 오케스트레이터): [19-tool-system.md](19-tool-system.md)
