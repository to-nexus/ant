# Job ID Architecture Analysis

## 문제점 진단

현재 시스템에서 **5가지 다른 job ID 관련 변수**가 사용되고 있어 혼란과 중복 구현이 발생하고 있습니다.

---

## 1. 현재 Job ID 변수 목록

### 프론트엔드 (ant-ui)

| 변수명 | 위치 | 타입 | 역할 | 생명주기 |
|--------|------|------|------|----------|
| `currentJobId` | Store (state) | `string \| undefined` | 현재 실행 중인 job의 ID | job 시작~종료 |
| `activeJobId` | KanbanData (props) | `string \| undefined` | Kanban에서 받은 활성 job ID | SSE 업데이트마다 |
| `taskId` | Store (activeTasks) | `string` (Map key) | 로그 스트림 식별자 (deprecated) | Logs SSE 연결 중 |

### 백엔드 (ant-cli)

| 변수명 | 위치 | 타입 | 역할 | 생명주기 |
|--------|------|------|------|----------|
| `jobId` | SessionState | `string \| undefined` | 세션 파일에 저장된 job ID | 세션 생성~완료 |
| `jobId` | ExpressServerAdapter | `string` (Map key) | HTTP 서버에서 관리하는 job ID | job 등록~종료 |
| `_httpTaskId` | ArchitectGraphState | `string \| undefined` | Deprecated - HTTP 태스크 식별자 | (사용 안 됨) |

---

## 2. 중복 및 혼란 포인트

### 🔴 문제 1: 프론트엔드에서 2개의 Job ID
```typescript
// Store.ts
currentJobId: string | undefined;  // Job 시작 시 설정
currentJob: JobExecution | null;   // Job 실행 객체

// KanbanData (from SSE)
activeJobId: string | undefined;   // 서버에서 전송
```

**충돌 케이스**:
- 새로고침 시: `currentJobId`는 `undefined`, `activeJobId`는 세션에서 복원됨
- Job 종료 시: `currentJobId` 클리어 타이밍과 `activeJobId` 업데이트 타이밍 불일치
- Resume 시: `currentJobId`는 새 ID, `activeJobId`는 이전 ID

**현재 처리 방식** (혼란스러움):
```typescript
// updateKanban에서 activeJobId 기반으로 currentJobId 동기화
if (data.activeJobId && !state.isRunning) {
  set({ isRunning: true, currentJobId: data.activeJobId });
}
```

### 🔴 문제 2: taskId vs jobId 혼용
```typescript
// Store.ts
startLogStream: (taskId: string) => void;  // ❌ taskId라고 부르지만 실제론 jobId
stopLogStream: (taskId: string) => void;   // ❌ 동일

// 실제 사용:
startLogStream(jobId);  // jobId를 taskId로 전달
```

**혼란 원인**: 초기 구현 시 "task"와 "job"을 혼용했던 역사적 이유

### 🔴 문제 3: 백엔드에서 jobId의 다중 소스
```typescript
// ExpressServerAdapter.ts
static getCurrentJobId(): string | null {
  // Priority 1: 환경 변수
  if (process.env.ANT_JOB_ID) return process.env.ANT_JOB_ID;
  
  // Priority 2: 인스턴스 변수
  return ExpressServerAdapter.instance?.currentJobId || null;
}

// jobs Map
private jobs: Map<string, JobStatus> = new Map();
```

**문제**: jobId가 3곳에 분산되어 있어 동기화 이슈 발생 가능

### 🔴 문제 4: Session jobId vs Runtime jobId
```typescript
// SessionState (파일에 저장)
jobId?: string;  // 세션 파일에 저장된 ID

// Runtime (메모리)
activeJobId: string;  // 현재 실행 중인 ID
```

**충돌 케이스**:
- Resume: 새 jobId 생성되지만 세션 파일의 jobId는 이전 ID
- 새로고침: 세션의 jobId로 복원해야 하는데 activeJobId와 불일치

---

## 3. 근본 원인 분석

### 설계 문제
1. **단일 진실 원천(Single Source of Truth) 부재**
   - jobId가 여러 곳에 저장되고 관리됨
   - 동기화 로직이 산재되어 있음

2. **책임 분리 불명확**
   - 누가 jobId를 생성하는가? (서버 vs 클라이언트)
   - 누가 jobId를 소유하는가? (Store vs Kanban vs Session)

3. **네이밍 일관성 부재**
   - `taskId` vs `jobId` 혼용
   - `currentJobId` vs `activeJobId` 의미 차이 불명확

---

## 4. 제안: 단순화된 아키텍처

### 원칙
1. **단일 진실 원천**: 백엔드 세션이 jobId의 소유자
2. **명확한 네이밍**: `jobId`로 통일 (taskId 제거)
3. **단방향 데이터 흐름**: Server → SSE → Store → UI

### 새로운 구조

```typescript
// ✅ 프론트엔드: 단일 jobId
interface StoreState {
  // 제거: currentJobId, taskId
  // 추가: 단일 jobId (서버에서 받음)
  jobId: string | undefined;  // SSE를 통해 서버에서 동기화
  currentJob: JobExecution | null;  // 실행 객체 (선택적)
}

// ✅ 백엔드: jobId는 Session이 소유
interface SessionState {
  jobId: string;  // 필수 - 세션 생성 시 할당
  // ... 나머지 상태
}

// ✅ Kanban: activeJobId 제거, jobId로 통일
interface KanbanData {
  // 제거: activeJobId
  // jobId는 이미 SessionState에 있으므로 KanbanData에 불필요
  todo: KanbanTask[];
  inProgress: KanbanTask | null;
  completed: KanbanTask[];
  // ...
}
```

### 데이터 흐름

```
1. Job 시작
   Server: jobId 생성 → SessionState에 저장
         ↓
   SSE: jobId 전송
         ↓
   Store: jobId 업데이트
         ↓
   UI: jobId 표시

2. 새로고침
   Store: initializeSSE()
         ↓
   Server: SessionState에서 jobId 로드
         ↓
   SSE: jobId 전송
         ↓
   Store: jobId 복원 ✅

3. Job 완료
   Server: SessionState에 completedAt 기록, jobId 유지
         ↓
   SSE: jobId + completedAt 전송
         ↓
   Store: jobId 유지 (UI에서 결과 확인 가능)
```

---

## 5. 마이그레이션 계획

### Phase 1: 네이밍 통일 (Low Risk)
- [ ] `taskId` → `jobId` 변경
- [ ] `activeJobId` → 제거, 대신 `session.jobId` 사용
- [ ] `currentJobId` → `jobId`로 단순화

### Phase 2: 데이터 흐름 단순화 (Medium Risk)
- [ ] KanbanData에서 `activeJobId` 제거
- [ ] Store의 jobId를 SSE jobId 메시지로 동기화
- [ ] Session을 jobId의 단일 진실 원천으로 확립

### Phase 3: 로직 정리 (High Risk)
- [ ] `updateKanban`에서 jobId 동기화 로직 제거
- [ ] Job 상태 관리 단순화
- [ ] Workflow SSE 연결을 jobId 기반으로 통일

---

## 6. 즉시 수정 가능한 항목

### 🟢 Low Hanging Fruit

#### 1. taskId → jobId 변경
```typescript
// Before
startLogStream: (taskId: string) => void;

// After  
startLogStream: (jobId: string) => void;
```

#### 2. _httpTaskId 제거
```typescript
// ArchitectGraphState에서 제거 (사용 안 됨)
_httpTaskId?: string;  // ❌ 삭제
```

#### 3. 주석 추가로 의미 명확화
```typescript
// Store.ts
interface StoreState {
  // ✅ Single source of truth for current job
  // Synced from server via Kanban SSE
  jobId: string | undefined;
  
  // ✅ Job execution handle (optional, for client-initiated jobs)
  currentJob: JobExecution | null;
}
```

---

## 7. 결론

**현재 상태**: 🔴 복잡하고 혼란스러움
- 5개의 다른 jobId 관련 변수
- 동기화 로직이 3곳에 산재
- Resume/새로고침 시 일관성 문제

**목표 상태**: 🟢 단순하고 명확함
- 1개의 jobId (Server → Store)
- 세션이 단일 진실 원천
- 단방향 데이터 흐름

**우선순위**:
1. Phase 1 (네이밍) - 즉시 시작 가능
2. Phase 2 (데이터 흐름) - 리팩토링 후
3. Phase 3 (로직 정리) - 안정화 후

---

## 8. 참고: 현재 버그와의 연관성

**버그**: Job 완료 후 새로고침 시 태스크보드 비어있음

**원인**:
```typescript
// initializeSSE에서 잘못된 job 타입 전달
sseManager.connect(
  state.selectedProject, 
  state.selectedFeature, 
  state.currentMode || 'code'  // ❌ currentMode는 undefined
);

// 올바른 값
sseManager.connect(
  state.selectedProject, 
  state.selectedFeature, 
  state.selectedWorkType as 'design' | 'code' | 'learn'  // ✅
);
```

**연관성**: 
- jobId와 job 타입이 혼재되어 있어 잘못된 변수 참조
- `currentMode`와 `selectedWorkType`의 역할 혼란
- 명확한 네이밍이 있었다면 방지 가능했던 버그

