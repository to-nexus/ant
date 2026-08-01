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

---

## Architecture Overview

ANT-UI is designed around **Clean Architecture**, adapted to account for the characteristics of React and SSE (Server-Sent Events).

### Why Clean Architecture?

**Problems (previous design):**
- SSE was bound to the React lifecycle → infinite re-renders
- Business logic scattered across UI components
- Hard to test, impossible to reuse
- Unclear dependency direction

**Solution (Clean Architecture):**
- Clear layer separation
- Unidirectional dependency rule
- Independent business logic
- Swappable external systems (Ports & Adapters)

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

> **"Dependencies always point inward (toward Domain)"**

```
Presentation → Application → Domain ← Infrastructure
                              ▲
                              │ (implements ports)
```

### 2. Single Responsibility

> **"Each layer has exactly one responsibility"**

- **Presentation**: rendering, user events
- **Application**: use-case orchestration
- **Domain**: business logic, state management
- **Infrastructure**: access to external systems

### 3. Framework Independence

> **"Business logic is independent of frameworks"**

- The Domain Layer does not import React
- The Store is implemented with Zustand, but its interface is framework-agnostic

### 4. Testability

> **"Each layer is testable in isolation"**

- The Domain can be tested without mocking Infrastructure
- Use cases can be tested with Presentation detached

---

## Layer Definitions

### Layer 1: Presentation (UI)

**Responsibilities:**
- Display information to the user
- Collect user input
- Invoke Application Layer use cases

**Prohibited:**
- ❌ Containing business logic
- ❌ Accessing Infrastructure directly
- ❌ Manipulating the Domain Store directly (go through Application hooks)

**Example:**
```typescript
// ✅ GOOD: Presentation Layer
function KanbanBoard() {
  const { kanban, stats } = useKanban(); // Application Hook
  return <div>{stats.todoCount} tasks</div>;
}

// ❌ BAD: Presentation Layer
function KanbanBoard() {
  const store = useStore(); // ❌ direct Store access
  const kanban = store.kanban;
  return <div>{kanban.todo.length}</div>; // ❌ contains logic
}
```

---

### Layer 2: Application (Use Cases)

**Responsibilities:**
- Connect the Domain Layer to the Presentation Layer
- Shape data into the form the UI needs
- Compute complex derived state

**Prohibited:**
- ❌ Defining business rules (that is the Domain's job)
- ❌ Accessing Infrastructure directly
- ❌ Containing UI rendering logic

**Example:**
```typescript
// ✅ GOOD: Application Layer (Hook)
export function useKanban() {
  // Fetch data from the Domain
  const kanban = useStore(state => state.kanban);
  
  // Compute derived state for the UI
  const stats = useMemo(() => ({
    todoCount: kanban.todo?.length ?? 0,
    completedCount: kanban.completed?.length ?? 0,
  }), [kanban]);
  
  return { kanban, stats };
}
```

---

### Layer 3: Domain (Business Logic)

**Responsibilities:**
- The application's core business rules
- State management (Zustand Store)
- Domain model definitions (Types)
- Business action definitions

**Prohibited:**
- ❌ Containing UI logic
- ❌ Depending on Infrastructure implementation details

**Example:**
```typescript
// ✅ GOOD: Domain Layer (Store)
export const useStore = create<Store>((set, get) => ({
  // State
  kanban: { todo: [], inProgress: null, completed: [] },
  
  // Business Action
  updateKanban: (data: KanbanData) => {
    set({ kanban: data });
  },
  
  // Lifecycle Management (orchestrates Infrastructure)
  initializeSSE: () => {
    const state = get();
    sseManager.connect('kanban', url, (data) => {
      get().updateKanban(data); // ✅ invokes a Store action
    });
  },
}));
```

---

### Layer 4: Infrastructure (External Systems)

**Responsibilities:**
- Actual communication with external systems
- Implementations of SSE, HTTP, LocalStorage, etc.
- Framework-specific code

**Prohibited:**
- ❌ Containing business logic
- ❌ Manipulating Domain state directly

**Example:**
```typescript
// ✅ GOOD: Infrastructure Layer
class SSEManager {
  connect(key: string, url: string, onMessage: (data: any) => void) {
    const es = new EventSource(url);
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data); // ✅ hands data to the Domain via callback
    };
  }
}
```

---

## Directory Structure

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

### Verifying Dependency Direction

There is no automated dependency-check script today — layer direction is a
review convention. A quick manual sweep:

```bash
# List presentation files importing infrastructure directly
rg "from '.*infrastructure/" src/presentation --type ts -l
```

Presentation should reach the backend through application hooks; the direct
infrastructure imports this sweep surfaces are legacy exceptions to shrink
over time, not a pattern to extend.

---

## Implementation Rules

### Rule 1: Presentation uses Application hooks only

```typescript
// ❌ BAD
function MyComponent() {
  const kanban = useStore(s => s.kanban); // ❌ direct Store access
  return <div>{kanban.todo.length}</div>;
}

// ✅ GOOD
function MyComponent() {
  const { stats } = useKanban(); // ✅ uses an Application hook
  return <div>{stats.todoCount}</div>;
}
```

### Rule 2: Application hooks act only as view adapters

```typescript
// ✅ GOOD: Application Hook
export function useKanban() {
  // Fetch data from the Domain
  const kanban = useStore(state => state.kanban);
  
  // Compute derived state
  const stats = useMemo(() => ({
    todoCount: kanban.todo?.length ?? 0,
  }), [kanban]);
  
  return { kanban, stats };
}
```

### Rule 3: The Domain Store only orchestrates Infrastructure

```typescript
// ✅ GOOD: Domain Store
export const useStore = create<Store>((set, get) => ({
  kanban: initialState,
  
  updateKanban: (data) => {
    set({ kanban: data });
  },
  
  initializeSSE: () => {
    // Call Infrastructure, but hand it a Domain action as the callback
    sseManager.connect('kanban', url, (data) => {
      get().updateKanban(data); // ✅ Domain action
    });
  },
}));
```

### Rule 4: Infrastructure is a pure adapter

```typescript
// ✅ GOOD: Infrastructure Adapter
class SSEManager {
  connect(key: string, url: string, onMessage: (data: any) => void) {
    const es = new EventSource(url);
    es.onmessage = (event) => {
      onMessage(JSON.parse(event.data)); // ✅ only invokes the callback
    };
    this.connections.set(key, es);
  }
}
```

### Rule 5: Cross-layer communication goes through interfaces

```typescript
// Domain: Port definition (implicit)
interface SSEPort {
  connect(key: string, url: string, onMessage: (data: any) => void): void;
  disconnect(key: string): void;
}

// Infrastructure: Adapter implementation
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

1. **Dependency direction**: both point inward (toward Core/Domain)
2. **Port/Adapter pattern**: Infrastructure is replaceable
3. **Independent business logic**: separated from frameworks

### Differences

1. **Port definitions**: 
   - ant-cli: explicit interface files
   - ant-ui: Store actions serve as implicit ports

2. **State Management**:
   - ant-cli: LangGraph state
   - ant-ui: Zustand Store

3. **UI Layer**:
   - ant-cli: CLI (minimal)
   - ant-ui: React (complex)

---

## Anti-Patterns

### ❌ Anti-Pattern 1: Presentation accessing Infrastructure

```typescript
// ❌ BAD
function MyComponent() {
  useEffect(() => {
    sseManager.connect(...); // ❌ direct Infrastructure access
  }, []);
}

// ✅ GOOD
function MyComponent() {
  // Infrastructure is managed by the Store's initializeSSE
  useEffect(() => {
    useStore.getState().initializeSSE();
  }, []);
}
```

### ❌ Anti-Pattern 2: Infrastructure manipulating the Domain

```typescript
// ❌ BAD
class SSEManager {
  connect(key, url) {
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      useStore.getState().updateKanban(data); // ❌ direct Domain manipulation
    };
  }
}

// ✅ GOOD
class SSEManager {
  connect(key, url, onMessage) {
    es.onmessage = (event) => {
      onMessage(JSON.parse(event.data)); // ✅ hands off via callback
    };
  }
}
```

### ❌ Anti-Pattern 3: Application containing business logic

```typescript
// ❌ BAD: Application Hook
export function useKanban() {
  const kanban = useStore(s => s.kanban);
  
  // ❌ business logic (the Domain's job)
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
  const addTask = useStore(s => s.addTask); // ✅ delegates to a Domain action
  
  // ✅ view optimization only
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
// Testing the Domain Layer (without Infrastructure)
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
// Infrastructure is swappable
// Before: EventSource
// After: WebSocket
// → No changes to Domain/Application code
```

### 3. Maintainability

```typescript
// Each layer can be modified independently
// UI change → Presentation only
// Business logic change → Domain only
// SSE → WebSocket → Infrastructure only
```

### 4. Scalability

```typescript
// New features extend each layer independently
// 1. Domain: new state + action
// 2. Infrastructure: new adapter
// 3. Application: new hook
// 4. Presentation: new component
```

---

## Conclusion

Through **Clean Architecture**, ANT-UI achieves:

1. ✅ **No infinite re-renders** — SSE runs outside React
2. ✅ **Clear separation of responsibilities** — each layer's role is explicit
3. ✅ **Testability** — layers can be tested in isolation
4. ✅ **Maintainability** — change impact is minimized
5. ✅ **Scalability** — new features are easy to add

**Adhering to this architecture keeps the system stable and extensible.**

---

**Version History:**

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2025-01-10 | Redesigned around Clean Architecture |
| 1.0 | 2024-XX-XX | Initial Flux pattern |
