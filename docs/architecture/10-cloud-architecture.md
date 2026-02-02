# ANT Cloud Architecture

> Multi-Pod 환경을 위한 클라우드 아키텍처 설계

## 1. 개요

### 1.1 현재 상태

ANT는 **SSE를 제외한 모든 컴포넌트**가 이미 Multi-Pod 지원 완료:

| 컴포넌트 | 상태 | 설명 |
|----------|------|------|
| API Server | ✅ Multi-Pod | 모든 상태 Redis 저장, Round-robin LB |
| Job Worker | ✅ Multi-Pod | BullMQ 기반, KEDA 스케일링 |
| Chat/Kanban/Workflow | ✅ Redis | 세션, 메시지, 상태 모두 Redis |
| Preview/IDE | ✅ Remote | Worker/K8s 기반 오케스트레이션 |
| **SSE** | ❌ **문제** | API Server에 혼합, Round-robin LB |

### 1.2 남은 문제: SSE

| 문제 | 증상 | 원인 |
|------|------|------|
| SSE 메시지 유실 | Chat UI에 메시지 안 나옴 | SSE 클라이언트가 Pod A에 연결, Pub/Sub은 모든 Pod에 broadcast |

**현재 Workaround**: Redis Pub/Sub으로 모든 Pod에 broadcast → 비효율적 (O(n) 복잡도)

### 1.3 목표

```
현재:  API Server = REST + SSE (혼합) + Round-robin LB
목표:  API Server = REST only + Realtime Server = SSE only (Sticky Session)
```

---

## 2. 아키텍처

### 2.1 현재 아키텍처 (SSE 혼합)

```
┌──────────────────────────────────────────────────────────────┐
│                    Load Balancer (Round-robin)               │
│                           /api/*                             │
└─────────────────────────────┬────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  API Pod A  │    │  API Pod B  │    │  API Pod C  │
    │ ┌─────────┐ │    │ ┌─────────┐ │    │ ┌─────────┐ │
    │ │REST API │ │    │ │REST API │ │    │ │REST API │ │
    │ ├─────────┤ │    │ ├─────────┤ │    │ ├─────────┤ │
    │ │SSE ❌   │ │    │ │SSE ❌   │ │    │ │SSE ❌   │ │ ← SSE가 API에 혼합
    │ └─────────┘ │    │ └─────────┘ │    │ └─────────┘ │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
           └──────────────────┼──────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌───────────┐   ┌───────────┐   ┌───────────┐
       │   Redis   │   │Job Worker │   │  Storage  │
       │State/Pub  │   │  Pool     │   │   (EFS)   │
       └───────────┘   └───────────┘   └───────────┘

문제: SSE 클라이언트가 Pod A에 연결 → Job은 어느 Pod에서든 실행 가능
     → Redis Pub/Sub으로 모든 Pod에 broadcast (비효율)
```

### 2.2 목표 아키텍처 (SSE 분리)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
│   ┌─────────────────────────┐    ┌─────────────────────────┐           │
│   │  REST API               │    │  SSE Connection          │           │
│   └────────────┬────────────┘    └────────────┬─────────────┘           │
└────────────────┼─────────────────────────────┼──────────────────────────┘
                 │                              │
                 ▼                              ▼
┌────────────────────────────┐    ┌────────────────────────────┐
│    API Gateway             │    │  Realtime Gateway          │
│    Round-robin             │    │  Sticky Session ✅         │
│    /api/*                  │    │  /realtime/*               │
└────────────┬───────────────┘    └────────────┬───────────────┘
             │                                  │
    ┌────────┼────────┐               ┌────────┼────────┐
    ▼        ▼        ▼               ▼        ▼        ▼
┌───────┐┌───────┐┌───────┐    ┌──────────┐┌──────────┐┌──────────┐
│API    ││API    ││API    │    │Realtime  ││Realtime  ││Realtime  │
│Pod    ││Pod    ││Pod    │    │Pod       ││Pod       ││Pod       │
│REST   ││REST   ││REST   │    │SSE ✅    ││SSE ✅    ││SSE ✅    │
│Only   ││Only   ││Only   │    │Only      ││Only      ││Only      │
└───┬───┘└───┬───┘└───┬───┘    └────┬─────┘└────┬─────┘└────┬─────┘
    └────────┴────────┴──────────────┴───────────┴───────────┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
      ┌───────────┐    ┌───────────┐    ┌───────────┐
      │   Redis   │    │Job Worker │    │  Storage  │
      └───────────┘    └───────────┘    └───────────┘

장점: SSE 클라이언트가 특정 Realtime Pod에 고정 (Sticky Session)
     → Pub/Sub 메시지를 해당 Pod만 처리 (효율적)
```

### 2.3 핵심 변경점

| 항목 | 현재 | 목표 |
|------|------|------|
| SSE 위치 | API Server에 혼합 | Realtime Server 분리 |
| SSE LB | Round-robin (문제) | Sticky Session |
| Pub/Sub | 모든 Pod에 broadcast | 해당 Pod만 처리 |

---

## 3. 컴포넌트 설계

### 3.1 API Server (ant-api) - ✅ 현재 운영 중

**역할**: Stateless REST API (+ SSE 혼합 - 분리 예정)  
**스케일링**: HPA (CPU/Memory 기반)  
**상태**: 모든 상태 Redis 저장 완료

```
현재 Endpoints:
├── REST API (Stateless) ✅
│   ├── POST /api/projects/:id/features/:feature/execute
│   ├── GET  /api/jobs/:jobId/status
│   ├── POST /api/chat/message
│   └── ...
│
└── SSE (분리 예정) ❌
    ├── GET /api/sse/stream
    └── GET /api/jobs/:jobId/workflow/stream
```

### 3.2 Realtime Server - 🔜 구현 예정

**패키지**: `ant-cli` (동일 패키지, 별도 entrypoint)  
**Entrypoint**: `infrastructure/realtime/start-realtime-server.ts`  
**실행**: `npm run dev:realtime-server`  
**LB**: Sticky Session

```
기존 SSE 엔드포인트 (현재 API Server에 혼합):

1. Feature SSE: /projects/:id/features/:feature/stream
   └── 구독 단위: Feature (프로젝트/피처)
   └── 전송: Chat, Kanban, FileTree, Git 변경
   └── 라이프사이클: 사용자가 화면 보는 동안 유지

2. Workflow SSE: /jobs/:jobId/workflow/stream
   └── 구독 단위: Job (실행 중인 작업)
   └── 전송: LangGraph 노드 상태, 현재 노드, 액터 상태
   └── 라이프사이클: Job 실행 중에만 연결

→ 이 두 SSE를 Realtime Server로 이동
```

### 3.3 Job Worker - ✅ 현재 운영 중

**역할**: LLM 호출, 코드 생성  
**스케일링**: KEDA (Queue depth)  
**큐**: BullMQ

### 3.4 Preview Worker - ✅ 현재 운영 중

**역할**: npm/vite dev server  
**포트**: 30001-39999

### 3.5 IDE Orchestration - ✅ 현재 운영 중

**로컬**: Docker  
**클라우드**: Kubernetes

---

## 4. Redis 데이터 모델

### 4.1 Key 구조

```
# Session (Chat)
ant:chat:session:{sessionKey}        # 세션 + 메시지 목록
ant:chat:currentMessage:{sessionKey} # 스트리밍 중인 메시지

# Job State
ant:job:status:{jobId}               # Job 상태
ant:job:logs:{jobId}                 # Job 로그 (List)
ant:job:mapping:{jobId}              # projectId, featureName 매핑
ant:job:userStopped:{jobId}          # 사용자 중지 마커

# Workflow State
ant:workflow:state:{jobId}           # 현재 노드, 히스토리 등

# Task Queue (Kanban)
ant:taskQueue:{jobId}                # 현재 태스크, 큐, 완료 목록

# Port Registry
ant:preview:{serverKey}              # Preview 호스트/포트
ant:ide:{serverKey}                  # IDE 호스트/포트

# Session Key Format: "{org}:{user}:{projectId}/{featureName}"
```

### 4.2 Pub/Sub 채널

```
chat:broadcast:{sessionKey}   # 채팅 메시지
chat:stream:{sessionKey}      # 스트리밍 청크
kanban:update:{sessionKey}    # 칸반 업데이트
workflow:update:{jobId}       # 워크플로우 상태
filetree:update:{sessionKey}  # 파일트리 변경
job:status:{jobId}            # Job 상태 변경
```

---

## 5. 데이터 흐름

### 5.1 Chat 메시지

```
User → POST /api/chat/message → API Server
                                    │
                                    ▼
                              Redis 저장
                              Pub/Sub publish
                                    │
                                    ▼
                            Realtime Server (구독 중인 Pod)
                                    │
                                    ▼
                              SSE → Frontend
```

### 5.2 LLM 스트리밍

```
Job Worker → LLM 응답 청크 → Redis 저장 + Pub/Sub
                                    │
                                    ▼
                            Realtime Server
                                    │
                                    ▼
                              SSE → Frontend (실시간 타이핑)
```

---

## 6. 환경 설정

### 6.1 공통 (필수)

```bash
ANT_REDIS_URL=redis://localhost:6379       # Redis (필수)
ANT_WORKSPACE_BASE_PATH=/path/to/workspaces
```

### 6.2 API Server

```bash
ANT_SERVER_MODE=local|cloud   # 인증 모드 (local: auto-auth, cloud: OAuth)
```

### 6.3 클라우드 전용

```bash
ANT_PREVIEW_WORKERS=http://preview-1:8080,http://preview-2:8080
ANT_K8S_NAMESPACE=ant-ide     # 설정 시 K8s IDE 사용
```

### 6.4 환경별 차이

| 구분 | Local | Cloud |
|------|-------|-------|
| Auth | local:local (auto) | OAuth |
| State | Redis | Redis |
| Job Queue | BullMQ | BullMQ |
| Preview | Local Worker | Remote Workers |
| IDE | Docker | Kubernetes |
| Storage | Local FS | EFS |

---

## 7. 인프라 요구사항

### 7.1 컴포넌트별 스펙

| Component | Spec | Count | Notes |
|-----------|------|-------|-------|
| API Server | 2 CPU, 2GB | 2+ | HPA |
| Realtime Server | 1 CPU, 512MB | 2+ | KEDA (connections) |
| Job Worker | 4 CPU, 8GB | 2+ | KEDA (queue depth) |
| Preview Worker | 4 CPU, 8GB | 2+ | Port range limited |
| Redis | 2 CPU, 4GB | 1 (HA: 3) | ElastiCache |
| EFS | 100GB+ | 1 | Shared storage |

### 7.2 예상 비용 (AWS)

| Component | Instance | Monthly |
|-----------|----------|---------|
| API Server x2 | t3.medium | ~$60 |
| Realtime Server x2 | t3.small | ~$30 |
| Job Worker x2 | c5.xlarge | ~$270 |
| Redis | cache.t3.medium | ~$50 |
| EFS | 100GB | ~$30 |
| **Total** | | **~$440/month** |

---

## 8. 구현 현황

### 8.1 Multi-Pod 완료 (SSE 제외)

| 항목 | 상태 | 비고 |
|------|------|------|
| Redis StateStore | ✅ | Job, Chat, Kanban, Workflow 상태 |
| BullMQ Job Queue | ✅ | KEDA 스케일링 |
| Job Worker 분리 | ✅ | 별도 프로세스 |
| ChatService | ✅ | 세션/메시지 Redis 저장 |
| Preview Orchestrator | ✅ | Remote Worker 지원 |
| IDE Orchestrator | ✅ | Docker/K8s 지원 |

### 8.2 SSE 분리 - ✅ 구현 완료

| 항목 | 상태 | 설명 |
|------|------|------|
| Realtime Server entrypoint | ✅ | `infrastructure/realtime/start-realtime-server.ts` |
| SSE 라우트 분리 | ✅ | `sse.routes.ts`를 RealtimeServer에서 사용 |
| API Server에서 SSE 제거 | ✅ | RouteConfigurator에서 setupSSERoutes 주석처리 |
| Frontend 수정 | ✅ | `getRealtimeBase()` 함수 추가, SSEManager 수정 |
| Ingress 설정 | 🔜 | 배포 시 `/realtime/*` Sticky Session 설정 필요 |

---

## 9. 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Redis 장애 | 높음 | ElastiCache Multi-AZ |
| Worker 장애 | 중간 | BullMQ 자동 재시도 |
| Sticky Session 불균형 | 중간 | KEDA 자동 스케일링 |
| 마이그레이션 버그 | 중간 | Feature flag + 점진적 배포 |

---

## 10. 구현 가이드: Realtime Server 분리

### 10.1 관련 파일 위치

```
ant-cli/src/
├── periphery/adapters/http/
│   ├── routes/
│   │   └── sse.routes.ts              # ✅ SSE 엔드포인트 (이동 대상)
│   ├── services/
│   │   └── SSEService.ts              # ✅ SSE 클라이언트 관리 + Redis Pub/Sub
│   └── express/config/
│       └── RouteConfigurator.ts       # setupSSERoutes() 제거 대상
│
├── infrastructure/
│   ├── worker/
│   │   └── start-job-worker.ts        # 참고: entrypoint 패턴
│   ├── preview/
│   │   └── start-preview-worker.ts    # 참고: entrypoint 패턴
│   └── realtime/                      # 🔜 새로 생성
│       ├── RealtimeServer.ts
│       └── start-realtime-server.ts

ant-ui/src/
└── infrastructure/
    ├── http/api.ts                    # getApiBase() - URL 결정
    └── sse/SSEManager.ts              # SSE 클라이언트 (URL 변경 필요)
```

### 10.2 현재 SSE 구조 이해

**SSEService** (`SSEService.ts`):
- 로컬 클라이언트 관리: `Map<sessionKey, Set<Response>>`
- Redis Pub/Sub 구독: `setupBroadcastSubscriptions(stateStore)`
- 채널: `chat:broadcast`, `sse:broadcast`, `sse:workflow`

**SSE Routes** (`sse.routes.ts`):
```typescript
// Feature SSE - 프로젝트/피처 단위
GET /api/projects/:id/features/:feature/stream
  → SSEService.registerClient()
  → 초기 상태 전송: kanban, chat, fileTree

// Workflow SSE - Job 단위  
GET /api/jobs/:jobId/workflow/stream
  → SSEService.registerWorkflowClient()
  → 초기 상태 전송: workflow state
```

**프론트엔드** (`SSEManager.ts`):
```typescript
// Feature SSE
const url = `${getApiBase()}/projects/${projectId}/features/${featureName}/stream`;
new EventSource(url);

// Workflow SSE
const url = `${getApiBase()}/jobs/${jobId}/workflow/stream`;
new EventSource(url);
```

### 10.3 구현 순서

#### Step 1: Realtime Server 생성

```bash
mkdir -p packages/ant-cli/src/infrastructure/realtime
```

**`RealtimeServer.ts`** 생성:
```typescript
import express from 'express';
import { createSSERoutes } from '../../periphery/adapters/http/routes';
import { SSEService } from '../../periphery/adapters/http/services/SSEService';
import { KanbanService, ChatService, ProjectService, WorkflowStateService } from '...';
import { getInfrastructureFactory } from '../adapters/InfrastructureFactory';

export async function createRealtimeServer(port: number) {
  const app = express();
  
  // 1. 서비스 초기화
  const stateStore = getInfrastructureFactory().getStateStore();
  const sseService = new SSEService();
  
  // 2. Redis Pub/Sub 구독 설정 (핵심!)
  await sseService.setupBroadcastSubscriptions(stateStore);
  
  // 3. 필요한 서비스들 초기화
  const kanbanService = new KanbanService(...);
  const chatService = new ChatService(...);
  const projectService = new ProjectService(...);
  const workflowStateService = new WorkflowStateService(...);
  
  // 4. SSE routes 마운트
  const sseRoutes = createSSERoutes({
    sseService,
    kanbanService,
    chatService,
    projectService,
    workflowStateService,
  });
  
  app.use('/api', sseRoutes);  // /api/projects/:id/features/:feature/stream
  
  // 5. Health check
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  
  return app.listen(port);
}
```

**`start-realtime-server.ts`** 생성:
```typescript
#!/usr/bin/env node
import 'dotenv/config';
import { createRealtimeServer } from './RealtimeServer';
import { logger } from '../../utils/logger';

const PORT = parseInt(process.env.ANT_REALTIME_PORT || '4101');

async function main() {
  logger.info(`Starting Realtime Server on port ${PORT}...`);
  await createRealtimeServer(PORT);
  logger.info(`Realtime Server running on port ${PORT}`);
}

main().catch(console.error);
```

#### Step 2: API Server에서 SSE 제거

**`RouteConfigurator.ts`** 수정:
```typescript
// 삭제 또는 주석 처리
// private setupSSERoutes(app: Express): void { ... }

// setupRoutes()에서 호출 제거
// this.setupSSERoutes(app);
```

#### Step 3: 프론트엔드 URL 분리

**`api.ts`** 수정:
```typescript
// 기존
const CLOUD_BACKEND_BASE = import.meta.env.VITE_CLOUD_BACKEND_BASE || 'http://localhost:4100/api';

// 추가
const CLOUD_REALTIME_BASE = import.meta.env.VITE_CLOUD_REALTIME_BASE || 'http://localhost:4101/api';

export function getRealtimeBase(): string {
  const backendMode = localStorage.getItem('ant-ui:backend-mode') || 'cloud';
  return backendMode === 'local' 
    ? 'http://localhost:4101/api'  // 로컬도 별도 포트
    : CLOUD_REALTIME_BASE;
}
```

**`SSEManager.ts`** 수정:
```typescript
import { getRealtimeBase } from '../http/api';  // 변경

// Feature SSE - getApiBase() → getRealtimeBase()
const url = `${getRealtimeBase()}/projects/${projectId}/features/${featureName}/stream`;

// Workflow SSE
const url = `${getRealtimeBase()}/jobs/${jobId}/workflow/stream`;
```

#### Step 4: package.json 스크립트 추가

```json
{
  "scripts": {
    "dev:realtime-server": "tsx src/infrastructure/realtime/start-realtime-server.ts"
  }
}
```

#### Step 5: K8s Ingress 설정

```yaml
# Realtime Ingress (Sticky Session)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ant-realtime-ingress
  annotations:
    alb.ingress.kubernetes.io/target-group-attributes: |
      stickiness.enabled=true,stickiness.lb_cookie.duration_seconds=86400
spec:
  rules:
  - http:
      paths:
      - path: /realtime
        pathType: Prefix
        backend:
          service:
            name: ant-realtime
            port:
              number: 4101
```

### 10.4 테스트 방법

```bash
# Terminal 1: API Server (SSE 없음)
npm run dev:server

# Terminal 2: Realtime Server (SSE 전용)
npm run dev:realtime-server

# Terminal 3: Job Worker
npm run dev:job-worker

# 프론트엔드 환경변수
VITE_CLOUD_REALTIME_BASE=http://localhost:4101/api
```

### 10.5 주의사항

1. **SSEService는 Redis 구독 필수**: `setupBroadcastSubscriptions()` 호출 없으면 cross-pod 메시지 수신 안됨
2. **서비스 의존성**: SSE routes는 KanbanService, ChatService, ProjectService, WorkflowStateService 필요
3. **인증**: SSE는 EventSource라 Header 설정 불가 → query param으로 user-email 전달
4. **CORS**: Realtime Server도 CORS 설정 필요

---

## Appendix: 참고 아키텍처

### Slack/Discord/Figma 공통 패턴

```
REST API (Stateless) ─────────────── API Servers (HPA)
                                          │
                                          ▼
                                        Redis
                                          │
                                          ▼
Realtime (Stateful) ─────────────── Realtime Servers (Sticky/Sharded)
```

**핵심**: REST와 Realtime의 **명확한 분리** + **독립적 스케일링**
