# HTTP Adapter Layer

This directory implements the HTTP adapter layer following **Hexagonal Architecture** principles.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Core Domain                               │
│                    (Ports/Interfaces)                            │
│  - HttpServerPort, JobExecutionPort                             │
│  - TaskQueueUpdatePort, FileTreeUpdatePort                      │
│  - WorkflowStateUpdatePort                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ implements
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    HTTP Adapter Layer                            │
│                     (Periphery)                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ExpressServerAdapter (API Server)                        │   │
│  │ - Implements HttpServerPort, JobExecutionPort            │   │
│  │ - Implements TaskQueueUpdatePort, FileTreeUpdatePort     │   │
│  │ - Coordinates services and routes                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Services (Business Logic)                                │   │
│  │ - KanbanService, WorkflowStateService                    │   │
│  │ - ProjectService, SessionService                         │   │
│  │ - Independent, testable units                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Routes (HTTP Endpoints)                                  │   │
│  │ - createJobRoutes, createKanbanRoutes                    │   │
│  │ - Dependency injection pattern                           │   │
│  │ - Thin routing layer                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
http/
├── express/
│   ├── ExpressServerAdapter.ts   # Main adapter (API server)
│   ├── bridges/
│   │   └── WorkflowBridge.ts     # Kanban + FileTree broadcasting
│   ├── managers/
│   │   ├── JobCleanupManager.ts
│   │   ├── JobStateTracker.ts
│   │   └── ...
│   └── config/
│       └── RouteConfigurator.ts
├── services/                      # Business logic services
│   ├── KanbanService.ts
│   ├── WorkflowStateService.ts   # READ + cleanup (endJob) only
│   ├── ProjectService.ts
│   ├── SessionService.ts
│   └── ...
├── routes/                        # HTTP endpoint definitions
│   ├── job.routes.ts
│   ├── kanban.routes.ts
│   ├── workflow.routes.ts         # GET only (graph-metadata, state)
│   ├── sse.routes.ts
│   └── ...
└── types/                         # Type definitions
    └── workflow.ts                # Re-exports from core/ports/stateStore.ts
```

## Workflow State Architecture

### How Workflow State Flows (Cloud Mode)

```
┌────────────────────────────────────────┐
│  ant-job Pod (Job Worker)              │
│                                        │
│  job-runner.ts → orchestrator.ts       │
│       ↓                                │
│  WorkflowBroadcaster                   │
│  (core/realtime/WorkflowBroadcaster)   │
│       │                                │
│       │ WRITE WorkflowRealtimeState    │
│       ↓                                │
│  Redis: ant:job:workflow:{jobId}       │
│  Redis Pub/Sub: realtime:workflow:...  │
└────────────────────────────────────────┘
                    │
                    ↓
┌────────────────────────────────────────┐
│  Redis (Shared State)                  │
│                                        │
│  KEY: ant:job:workflow:{jobId}         │
│  TYPE: WorkflowRealtimeState (JSON)    │
│  CHANNEL: realtime:workflow:{org}:{id} │
└────────────────────────────────────────┘
          │                    │
          ↓                    ↓
┌──────────────────┐  ┌──────────────────┐
│  ant-realtime Pod │  │  ant-api Pod      │
│                    │  │                    │
│  SSEService        │  │  JobCleanupManager │
│  subscribes to     │  │       ↓            │
│  Redis Pub/Sub     │  │  WorkflowState-    │
│       ↓            │  │  Service.endJob()  │
│  SSE → Frontend    │  │  (READ + finalize) │
└──────────────────┘  └──────────────────┘
```

### Key Design Decisions

1. **Single canonical type**: `WorkflowRealtimeState` defined in `core/ports/stateStore.ts`
2. **Single writer**: `WorkflowBroadcaster` in Job Worker child process (WRITE)
3. **Readers**: `WorkflowStateService` for cleanup + SSE initial state (READ)
4. **No HTTP intermediary**: Direct Redis Pub/Sub replaces HTTP client/server pattern

### WorkflowStateService Responsibilities

`WorkflowStateService` is a **read + cleanup** service. It does NOT write workflow state during job execution.

- `getState(jobId)` — Read current workflow state from Redis (REST API)
- `getInitialState(jobId)` — Read state for SSE client connection
- `endJob(jobId)` — Finalize state and broadcast end event (cleanup)

### WorkflowBroadcaster Responsibilities

`WorkflowBroadcaster` (in `core/realtime/`) is the **primary writer** of workflow state.

- Maintains `WorkflowRealtimeState` in-memory during job execution
- Writes to Redis on every state change (enterNode, exitNode, etc.)
- Publishes to user-scoped Redis Pub/Sub channel for real-time SSE updates

## Design Patterns

### 1. Hexagonal Architecture (Ports & Adapters)

**Core Principle**: Business logic depends on interfaces (ports), not implementations (adapters).

- **Ports** (in `core/ports/`): Interfaces defining capabilities
- **Adapters** (in `periphery/adapters/`): Implementations of ports

### 2. Dependency Injection

**Routes**: Accept dependencies as function parameters
```typescript
export function createJobRoutes(deps: {
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  getJobStatus: (jobId: string) => any;
}): Router
```

**Services**: Accept configuration in constructor
```typescript
export class KanbanService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly taskQueueSnapshots: Map<...>
  ) {}
}
```

### 3. Port Interface Pattern

`WorkflowStateUpdatePort` is implemented by different adapters depending on execution context:

| Context | Implementation | Communication |
|---|---|---|
| Job Worker child process | `WorkflowBroadcaster` | Direct Redis Pub/Sub |
| API Server (cleanup) | `WorkflowStateService` | Redis read/write |

## Service Layer Design

### Principles
1. **Single Responsibility**: Each service handles one domain
2. **No HTTP Knowledge**: Services don't know about Express/HTTP
3. **Testable**: Can be tested without HTTP layer
4. **Reusable**: Can be used by multiple routes/adapters

## Route Layer Design

### Principles
1. **Thin Layer**: Routes are just HTTP handling
2. **Delegate to Services**: Business logic in services
3. **Dependency Injection**: Accept all deps as parameters
4. **Function Export**: Not classes (simplicity)

### Example: workflow.routes.ts
```typescript
export function createWorkflowRoutes(deps: {
  graphMetadataService: GraphMetadataService;
  workflowStateService: WorkflowStateService;
}): Router {
  const router = Router();
  
  // GET /api/agents/:agent/jobs/:job/graph-metadata
  router.get('/agents/:agent/jobs/:job/graph-metadata', ...);
  
  // GET /api/jobs/:jobId/workflow/state
  router.get('/jobs/:jobId/workflow/state', ...);
  
  return router;
}
```

## Adding New Features

### 1. Add a New Service
```typescript
// services/MyService.ts
export class MyService {
  constructor(private deps: ...) {}
  
  myBusinessLogic() {
    // Pure domain logic
  }
}

// services/index.ts
export { MyService } from './MyService';
```

### 2. Add New Routes
```typescript
// routes/myRoutes.ts
export function createMyRoutes(deps: {
  myService: MyService;
}): Router {
  const router = Router();
  
  router.get('/my-endpoint', (req, res) => {
    const result = deps.myService.myBusinessLogic();
    res.json(result);
  });
  
  return router;
}

// routes/index.ts
export { createMyRoutes } from './myRoutes';
```

### 3. Register in RouteConfigurator
```typescript
// express/config/RouteConfigurator.ts
private setupRoutes(): void {
  const myRoutes = createMyRoutes({
    myService: this.deps.myService
  });
  this.app.use('/api', myRoutes);
}
```

## Testing Strategy

### Unit Tests (Services)
```typescript
describe('WorkflowStateService', () => {
  it('should read workflow state', async () => {
    const service = new WorkflowStateService(mockStateStore);
    const state = await service.getState('job-1');
    expect(state?.currentNode).toBe('resolve');
  });
});
```

### Integration Tests (Routes)
```typescript
describe('GET /jobs/:jobId/workflow/state', () => {
  it('should return workflow state', async () => {
    const response = await request(app)
      .get('/api/jobs/job-1/workflow/state');
    
    expect(response.status).toBe(200);
    expect(response.body.currentNode).toBeDefined();
  });
});
```

## Best Practices

### Do
- Keep services independent of HTTP layer
- Use dependency injection
- Follow single responsibility principle
- Add JSDoc comments
- Handle errors gracefully
- Log important events
- Use TypeScript types strictly

### Don't
- Mix HTTP logic with business logic
- Access global state directly
- Use concrete implementations (use interfaces)
- Ignore errors silently
- Create god classes/services
- Bypass the port interfaces

## Hexagonal Architecture Compliance

### This implementation follows:
1. **Ports** defined in `core/ports/`
2. **Adapters** implement ports in `periphery/adapters/`
3. **Dependency Inversion**: Core depends on interfaces, adapters depend on core
4. **Testability**: Services can be tested without adapters
5. **Flexibility**: Easy to swap implementations

### Key Benefits:
- **Independent of frameworks**: Business logic doesn't depend on Express
- **Testable**: Can test without HTTP server
- **Flexible**: Can add new adapters without changing core
- **Maintainable**: Clear separation of concerns
