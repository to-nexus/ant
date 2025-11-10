# ANT-UI Architecture

> **Version:** 2.0  
> **Architecture:** Clean Architecture (Modified for React/SSE)  
> **Last Updated:** 2025-01-10  

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Principles](#core-principles)
3. [Layer Definitions](#layer-definitions)
4. [Directory Structure](#directory-structure)
5. [Dependency Rules](#dependency-rules)
6. [Implementation Rules](#implementation-rules)
7. [Comparison with ant-cli](#comparison-with-ant-cli)
8. [Migration Plan](#migration-plan)

---

## Architecture Overview

ANT-UI는 **Clean Architecture**를 기반으로 설계되었습니다. React와 SSE(Server-Sent Events)의 특성을 고려한 변형 구조를 사용합니다.

### Why Clean Architecture?

**문제점 (기존):**
- SSE가 React 생명주기에 종속 → 무한 리렌더링
- 비즈니스 로직이 UI 컴포넌트에 분산
- 테스트 어려움, 재사용 불가능
- 의존성 방향 불명확

**해결책 (Clean Architecture):**
- 명확한 레이어 분리
- 단방향 의존성 규칙
- 독립적인 비즈니스 로직
- 외부 시스템 교체 가능 (Ports & Adapters)

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                                                       │
│         PRESENTATION LAYER (UI)                      │
│   React Components, Views, Layouts                   │
│   - No business logic                                │
│   - Only renders & user events                       │
│                                                       │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
                       ↓
┌─────────────────────────────────────────────────────┐
│                                                       │
│         APPLICATION LAYER (Use Cases)                │
│   View Adapter Hooks, UI State Derivation           │
│   - Connects UI to Domain                            │
│   - No external dependencies                         │
│                                                       │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
                       ↓
┌─────────────────────────────────────────────────────┐
│                                                       │
│         DOMAIN LAYER (Business Logic)                │
│   Store (State + Actions), Domain Models            │
│   - Core business rules                              │
│   - Independent of frameworks                        │
│                                                       │
└──────────────────────┬──────────────────────────────┘
                       │ depends on
                       ↓
┌─────────────────────────────────────────────────────┐
│                                                       │
│         INFRASTRUCTURE LAYER (External)              │
│   SSE, HTTP, Storage Adapters                        │
│   - Framework-specific implementations               │
│   - Replaceable                                      │
│                                                       │
└─────────────────────────────────────────────────────┘
```

---

## Core Principles

### 1. Dependency Inversion

> **"의존성은 항상 안쪽(Domain)으로만 향한다"**

```
Presentation → Application → Domain ← Infrastructure
                              ▲
                              │ (implements ports)
```

### 2. Single Responsibility

> **"각 레이어는 하나의 책임만 갖는다"**

- **Presentation**: 렌더링, 사용자 이벤트
- **Application**: Use Case 조율
- **Domain**: 비즈니스 로직, 상태 관리
- **Infrastructure**: 외부 시스템 접근

### 3. Framework Independence

> **"비즈니스 로직은 프레임워크와 독립적이다"**

- Domain Layer는 React를 import하지 않음
- Store는 Zustand로 구현되지만, 인터페이스는 framework-agnostic

### 4. Testability

> **"각 레이어는 독립적으로 테스트 가능하다"**

- Infrastructure를 mocking 없이 Domain 테스트 가능
- Presentation을 분리하여 Use Case 테스트 가능

---

## Layer Definitions

### Layer 1: Presentation (UI)

**책임:**
- 사용자에게 정보 표시
- 사용자 입력 수집
- Application Layer의 Use Case 호출

**금지사항:**
- ❌ 비즈니스 로직 포함
- ❌ Infrastructure 직접 접근
- ❌ Domain Store 직접 조작 (Application Hook 경유)

**예시:**
```typescript
// ✅ GOOD: Presentation Layer
function KanbanBoard() {
  const { kanban, stats } = useKanban(); // Application Hook
  return <div>{stats.todoCount} tasks</div>;
}

// ❌ BAD: Presentation Layer
function KanbanBoard() {
  const store = useStore(); // ❌ Store 직접 접근
  const kanban = store.kanban;
  return <div>{kanban.todo.length}</div>; // ❌ 로직 포함
}
```

---

### Layer 2: Application (Use Cases)

**책임:**
- Domain Layer와 Presentation Layer 연결
- UI에 필요한 데이터 형태로 가공
- 복잡한 파생 상태 계산

**금지사항:**
- ❌ 비즈니스 규칙 정의 (Domain의 역할)
- ❌ Infrastructure 직접 접근
- ❌ UI 렌더링 로직 포함

**예시:**
```typescript
// ✅ GOOD: Application Layer (Hook)
export function useKanban() {
  // Domain에서 데이터 가져오기
  const kanban = useStore(state => state.kanban);
  
  // UI용 파생 상태 계산
  const stats = useMemo(() => ({
    todoCount: kanban.todo?.length ?? 0,
    completedCount: kanban.completed?.length ?? 0,
  }), [kanban]);
  
  return { kanban, stats };
}
```

---

### Layer 3: Domain (Business Logic)

**책임:**
- 애플리케이션의 핵심 비즈니스 규칙
- 상태 관리 (Zustand Store)
- 도메인 모델 정의 (Types)
- 비즈니스 액션 정의

**금지사항:**
- ❌ UI 로직 포함
- ❌ Infrastructure 구현 상세 의존

**예시:**
```typescript
// ✅ GOOD: Domain Layer (Store)
export const useStore = create<Store>((set, get) => ({
  // State
  kanban: { todo: [], inProgress: null, completed: [] },
  
  // Business Action
  updateKanban: (data: KanbanData) => {
    set({ kanban: data });
  },
  
  // Lifecycle Management (Infrastructure 조율)
  initializeSSE: () => {
    const state = get();
    sseManager.connect('kanban', url, (data) => {
      get().updateKanban(data); // ✅ Store 액션 호출
    });
  },
}));
```

---

### Layer 4: Infrastructure (External Systems)

**책임:**
- 외부 시스템과의 실제 통신
- SSE, HTTP, LocalStorage 등 구현
- Framework-specific 코드

**금지사항:**
- ❌ 비즈니스 로직 포함
- ❌ Domain 상태 직접 조작

**예시:**
```typescript
// ✅ GOOD: Infrastructure Layer
class SSEManager {
  connect(key: string, url: string, onMessage: (data: any) => void) {
    const es = new EventSource(url);
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data); // ✅ 콜백으로 Domain에 전달
    };
  }
}
```

---

## Directory Structure

### Before (기존 - 혼재)

```
src/
├── components/
├── hooks/              # Application + Infrastructure 혼재
├── lib/
│   ├── store.ts        # Domain + Infrastructure 혼재
│   └── api.ts
└── services/           # 새로 추가됨
```

### After (Clean Architecture)

```
src/
├── presentation/                    # Layer 1: UI
│   ├── components/
│   │   ├── kanban/                  # Feature: Kanban
│   │   │   ├── KanbanBoard.tsx
│   │   │   ├── KanbanCard.tsx
│   │   │   └── index.ts
│   │   ├── workflow/                # Feature: Workflow
│   │   │   ├── WorkflowVisualization.tsx
│   │   │   ├── NodeCard.tsx
│   │   │   └── index.ts
│   │   ├── chat/                    # Feature: Chat
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatHistory.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   └── index.ts
│   │   ├── layout/                  # Layout Components
│   │   │   ├── ExplorerPanel.tsx
│   │   │   ├── MainContentArea.tsx
│   │   │   ├── ChatSidebarWrapper.tsx
│   │   │   └── GlobalNavBar.tsx
│   │   └── common/                  # Shared UI Components
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       └── index.ts
│   └── App.tsx                      # Root Component
│
├── application/                     # Layer 2: Use Cases
│   └── hooks/
│       ├── features/                # Feature-specific Hooks
│       │   ├── useKanban.ts
│       │   ├── useWorkflow.ts
│       │   └── useChat.ts
│       └── ui/                      # UI-specific Hooks
│           ├── useLayoutState.ts
│           ├── useResizeHandlers.ts
│           ├── useChatPolicy.ts
│           └── useConfigLoader.ts
│
├── domain/                          # Layer 3: Business Logic
│   ├── store/
│   │   └── index.ts                 # Main Store (Zustand)
│   └── models/                      # Domain Types
│       ├── kanban.ts
│       ├── workflow.ts
│       ├── chat.ts
│       ├── session.ts
│       └── index.ts
│
├── infrastructure/                  # Layer 4: External Systems
│   ├── sse/
│   │   └── SSEManager.ts            # SSE Adapter
│   ├── http/
│   │   ├── api.ts                   # HTTP Client
│   │   └── cli.ts                   # CLI Execution
│   └── storage/
│       └── LocalStorageAdapter.ts   # Storage Adapter
│
└── shared/                          # Cross-cutting Concerns
    ├── types/                       # Shared Types
    ├── utils/                       # Utility Functions
    └── constants/                   # Constants
```

### 파일 매핑

| 기존 경로 | 새 경로 (Clean Architecture) |
|----------|----------------------------|
| `/components/KanbanBoard.tsx` | `/presentation/components/kanban/KanbanBoard.tsx` |
| `/hooks/useKanbanSSE.ts` | ❌ 삭제 (SSE는 Infrastructure로) |
| `/hooks/useKanban.ts` | `/application/hooks/features/useKanban.ts` |
| `/lib/store.ts` | `/domain/store/index.ts` |
| `/services/SSEManager.ts` | `/infrastructure/sse/SSEManager.ts` |
| `/lib/api.ts` | `/infrastructure/http/api.ts` |
| `/types/kanban.ts` | `/domain/models/kanban.ts` |

---

## Dependency Rules

### Allowed Dependencies

```typescript
// ✅ Presentation → Application
import { useKanban } from '@/application/hooks/features/useKanban';

// ✅ Application → Domain
import { useStore } from '@/domain/store';

// ✅ Domain → Infrastructure (Inversion of Control)
import { sseManager } from '@/infrastructure/sse/SSEManager';
// Domain calls Infrastructure, but only through interfaces/callbacks
```

### Forbidden Dependencies

```typescript
// ❌ Presentation → Infrastructure
import { sseManager } from '@/infrastructure/sse/SSEManager';

// ❌ Infrastructure → Domain
import { useStore } from '@/domain/store';

// ❌ Application → Infrastructure
import { api } from '@/infrastructure/http/api';
```

### 의존성 방향 검증

```bash
# 의존성 검사 스크립트
pnpm check:dependencies

# 예상 결과:
# ✅ presentation → application: OK
# ✅ application → domain: OK
# ✅ domain → infrastructure: OK (IoC)
# ❌ presentation → infrastructure: VIOLATION!
```

---

## Implementation Rules

### Rule 1: Presentation는 Application Hook만 사용

```typescript
// ❌ BAD
function MyComponent() {
  const kanban = useStore(s => s.kanban); // ❌ Store 직접 접근
  return <div>{kanban.todo.length}</div>;
}

// ✅ GOOD
function MyComponent() {
  const { stats } = useKanban(); // ✅ Application Hook 사용
  return <div>{stats.todoCount}</div>;
}
```

### Rule 2: Application Hook은 View Adapter만 담당

```typescript
// ✅ GOOD: Application Hook
export function useKanban() {
  // Domain에서 데이터 가져오기
  const kanban = useStore(state => state.kanban);
  
  // 파생 상태 계산
  const stats = useMemo(() => ({
    todoCount: kanban.todo?.length ?? 0,
  }), [kanban]);
  
  return { kanban, stats };
}
```

### Rule 3: Domain Store는 Infrastructure를 조율만 함

```typescript
// ✅ GOOD: Domain Store
export const useStore = create<Store>((set, get) => ({
  kanban: initialState,
  
  updateKanban: (data) => {
    set({ kanban: data });
  },
  
  initializeSSE: () => {
    // Infrastructure를 호출하되, 콜백으로 Domain 액션 전달
    sseManager.connect('kanban', url, (data) => {
      get().updateKanban(data); // ✅ Domain 액션
    });
  },
}));
```

### Rule 4: Infrastructure는 순수 Adapter

```typescript
// ✅ GOOD: Infrastructure Adapter
class SSEManager {
  connect(key: string, url: string, onMessage: (data: any) => void) {
    const es = new EventSource(url);
    es.onmessage = (event) => {
      onMessage(JSON.parse(event.data)); // ✅ 콜백만 호출
    };
    this.connections.set(key, es);
  }
}
```

### Rule 5: 레이어 간 통신은 Interface로

```typescript
// Domain: Port 정의 (암묵적)
interface SSEPort {
  connect(key: string, url: string, onMessage: (data: any) => void): void;
  disconnect(key: string): void;
}

// Infrastructure: Adapter 구현
class SSEManager implements SSEPort {
  connect(key, url, onMessage) { /* ... */ }
  disconnect(key) { /* ... */ }
}
```

---

## Comparison with ant-cli

| Aspect | ant-cli (Hexagonal) | ant-ui (Clean) |
|--------|-------------------|----------------|
| **Architecture** | Hexagonal (Ports & Adapters) | Clean Architecture |
| **Core** | `/core` (Domain Logic) | `/domain` (Store + Models) |
| **Ports** | Explicit Interfaces (`/core/ports`) | Implicit (Store Actions) |
| **Adapters** | `/periphery/adapters` | `/infrastructure` |
| **Use Cases** | `/agents` (Agent Logic) | `/application/hooks` |
| **UI** | CLI (minimal) | `/presentation/components` |
| **Dependency Direction** | Inward to Core | Inward to Domain |
| **Testing** | Core is testable | Domain is testable |

### Similarities

1. **의존성 방향**: 둘 다 안쪽(Core/Domain)으로 향함
2. **Port/Adapter 패턴**: Infrastructure는 교체 가능
3. **비즈니스 로직 독립**: Framework와 분리

### Differences

1. **Ports 정의**: 
   - ant-cli: 명시적 인터페이스 파일
   - ant-ui: Store 액션이 암묵적 port

2. **State Management**:
   - ant-cli: LangGraph 상태
   - ant-ui: Zustand Store

3. **UI Layer**:
   - ant-cli: CLI (minimal)
   - ant-ui: React (complex)

---

## Migration Plan

### Phase 1: Directory Restructure

```bash
# 1. 디렉토리 생성
mkdir -p src/{presentation,application,domain,infrastructure}

# 2. 파일 이동
mv src/components/* src/presentation/components/
mv src/hooks/* src/application/hooks/
mv src/lib/store.ts src/domain/store/index.ts
mv src/services/* src/infrastructure/
```

### Phase 2: Import Path Update

```typescript
// 모든 파일의 import 경로 업데이트
// Before:
import { useStore } from '@/lib/store';

// After:
import { useStore } from '@/domain/store';
```

### Phase 3: Layer Separation

```typescript
// 1. Infrastructure 분리
// src/hooks/useKanbanSSE.ts 삭제
// SSE 로직을 SSEManager + Store로 이동

// 2. Application Hook 생성
// src/application/hooks/features/useKanban.ts
```

### Phase 4: Dependency Check

```bash
# tsconfig paths 설정
{
  "compilerOptions": {
    "paths": {
      "@/presentation/*": ["src/presentation/*"],
      "@/application/*": ["src/application/*"],
      "@/domain/*": ["src/domain/*"],
      "@/infrastructure/*": ["src/infrastructure/*"]
    }
  }
}
```

### Phase 5: Validation

```bash
# 빌드 성공 확인
pnpm build

# 의존성 규칙 검증
pnpm check:dependencies

# 테스트 실행
pnpm test
```

---

## Anti-Patterns

### ❌ Anti-Pattern 1: Presentation이 Infrastructure 접근

```typescript
// ❌ BAD
function MyComponent() {
  useEffect(() => {
    sseManager.connect(...); // ❌ Infrastructure 직접 접근
  }, []);
}

// ✅ GOOD
function MyComponent() {
  // Infrastructure는 Store의 initializeSSE에서 관리
  useEffect(() => {
    useStore.getState().initializeSSE();
  }, []);
}
```

### ❌ Anti-Pattern 2: Infrastructure가 Domain 조작

```typescript
// ❌ BAD
class SSEManager {
  connect(key, url) {
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      useStore.getState().updateKanban(data); // ❌ Domain 직접 조작
    };
  }
}

// ✅ GOOD
class SSEManager {
  connect(key, url, onMessage) {
    es.onmessage = (event) => {
      onMessage(JSON.parse(event.data)); // ✅ 콜백으로 전달
    };
  }
}
```

### ❌ Anti-Pattern 3: Application이 비즈니스 로직 포함

```typescript
// ❌ BAD: Application Hook
export function useKanban() {
  const kanban = useStore(s => s.kanban);
  
  // ❌ 비즈니스 로직 (Domain의 역할)
  const addTask = (task: Task) => {
    if (task.priority > 5) {
      // ...complex business rule
    }
  };
  
  return { kanban, addTask };
}

// ✅ GOOD: Application Hook
export function useKanban() {
  const kanban = useStore(s => s.kanban);
  const addTask = useStore(s => s.addTask); // ✅ Domain 액션 위임
  
  // ✅ View 최적화만
  const stats = useMemo(() => ({
    todoCount: kanban.todo?.length ?? 0,
  }), [kanban]);
  
  return { kanban, addTask, stats };
}
```

---

## Benefits

### 1. Testability

```typescript
// Domain Layer 테스트 (Infrastructure 없이)
describe('Store', () => {
  it('should update kanban data', () => {
    const store = useStore.getState();
    store.updateKanban(mockData);
    expect(store.kanban).toEqual(mockData);
  });
});
```

### 2. Flexibility

```typescript
// Infrastructure 교체 가능
// Before: EventSource
// After: WebSocket
// → Domain/Application 코드 변경 없음
```

### 3. Maintainability

```typescript
// 레이어별 독립적 수정 가능
// UI 변경 → Presentation만
// 비즈니스 로직 변경 → Domain만
// SSE → WebSocket → Infrastructure만
```

### 4. Scalability

```typescript
// 새 기능 추가 시 레이어별 확장
// 1. Domain: 새 state + action
// 2. Infrastructure: 새 adapter
// 3. Application: 새 hook
// 4. Presentation: 새 component
```

---

## Conclusion

ANT-UI는 **Clean Architecture**를 통해:

1. ✅ **무한 리렌더링 해결** - SSE가 React 외부에서 동작
2. ✅ **명확한 책임 분리** - 각 레이어의 역할 명확
3. ✅ **테스트 용이성** - 레이어별 독립 테스트
4. ✅ **유지보수성** - 변경 영향 최소화
5. ✅ **확장성** - 새 기능 추가 용이

**이 아키텍처를 준수하면 안정적이고 확장 가능한 시스템이 보장됩니다.**

---

**Version History:**

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2025-01-10 | Clean Architecture로 재설계 |
| 1.0 | 2024-XX-XX | 초기 Flux 패턴 |
