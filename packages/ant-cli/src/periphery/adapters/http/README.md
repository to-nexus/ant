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
│  │ ExpressServerAdapter (Primary/Server-side)               │   │
│  │ - Implements all ports directly (in-process)             │   │
│  │ - Coordinates services and routes                        │   │
│  │ - Singleton pattern for parent process                   │   │
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
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Clients (HTTP Proxies)                                   │   │
│  │ - WorkflowHttpClient (for child processes)               │   │
│  │ - Remote Proxy pattern                                   │   │
│  │ - Implements ports via HTTP calls                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
http/
├── ExpressServerAdapter.ts   # Main adapter (server-side)
├── services/                  # Business logic services
│   ├── KanbanService.ts
│   ├── WorkflowStateService.ts
│   ├── ProjectService.ts
│   ├── SessionService.ts
│   └── ...
├── routes/                    # HTTP endpoint definitions
│   ├── jobRoutes.ts
│   ├── kanbanRoutes.ts
│   ├── workflowRoutes.ts
│   └── ...
├── clients/                   # HTTP client adapters
│   └── WorkflowHttpClient.ts  # For child processes
└── types/                     # Type definitions
    └── workflow.ts
```

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
  // ...
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

### 3. Singleton Pattern

**ExpressServerAdapter**: Single instance per process
```typescript
private static instance: ExpressServerAdapter | null = null;

static getInstance(): ExpressServerAdapter | null {
  return ExpressServerAdapter.instance;
}
```

### 4. Remote Proxy Pattern

**WorkflowHttpClient**: Implements port interface via HTTP
```typescript
export class WorkflowHttpClient implements WorkflowStateUpdatePort {
  // Forwards calls to parent process server via HTTP
  enterNode(jobId: string, nodeId: string): void {
    this.sendUpdate(jobId, 'enterNode', { nodeId });
  }
}
```

## Process Communication Architecture

### Parent Process (Server)
```
ExpressServerAdapter (Singleton)
  ↓ (directly implements)
WorkflowStateUpdatePort
  ↓
WorkflowStateService (business logic)
  ↓
SSE Broadcast to Frontend
```

### Child Process (Agent Execution)
```
WorkflowHttpClient
  ↓ (HTTP POST)
ExpressServerAdapter (in parent)
  ↓
WorkflowStateService
  ↓
SSE Broadcast to Frontend
```

### Why This Design?

1. **Process Isolation**: Agent runs in separate process (tsx) for security/stability
2. **Communication**: Child process can't access parent's singleton instance
3. **Solution**: HTTP client acts as proxy to parent's services
4. **Benefits**:
   - Clean separation of concerns
   - Testable in isolation
   - Same port interface for both processes

## Service Layer Design

### Principles
1. **Single Responsibility**: Each service handles one domain
2. **No HTTP Knowledge**: Services don't know about Express/HTTP
3. **Testable**: Can be tested without HTTP layer
4. **Reusable**: Can be used by multiple routes/adapters

### Example: WorkflowStateService
```typescript
export class WorkflowStateService {
  // Domain logic only
  enterNode(jobId: string, nodeId: string): void {
    // Update state
    // Broadcast to clients
  }
}
```

## Route Layer Design

### Principles
1. **Thin Layer**: Routes are just HTTP handling
2. **Delegate to Services**: Business logic in services
3. **Dependency Injection**: Accept all deps as parameters
4. **Function Export**: Not classes (simplicity)

### Example: workflowRoutes.ts
```typescript
export function createWorkflowRoutes(deps: {
  workflowStateService: WorkflowStateService;
}): Router {
  const router = Router();
  
  router.post('/jobs/:jobId/workflow/update', (req, res) => {
    // Parse HTTP request
    // Call service
    // Return HTTP response
  });
  
  return router;
}
```

## Client Layer Design

### Purpose
Enable child processes to communicate with parent server.

### Principles
1. **Implements Port Interface**: Same as server adapter
2. **HTTP Communication**: Uses fetch/http module
3. **Fire-and-Forget**: Non-blocking, logs warnings
4. **Fail-Safe**: Doesn't crash on network errors

### Usage
```typescript
// In orchestrator (child process detection)
// ANT_API_URL is set by parent process (JobWorker, JobExecutionManager)
if (process.env.ANT_API_URL) {
  const { WorkflowHttpClient } = await import('./clients');
  workflowUpdate = new WorkflowHttpClient();  // Uses ANT_API_URL internally
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

### 3. Register in ExpressServerAdapter
```typescript
private setupRoutes(): void {
  // ...
  const myRoutes = createMyRoutes({
    myService: this.myService
  });
  this.app.use('/api', myRoutes);
}
```

### 4. (Optional) Add Client if needed
```typescript
// clients/MyHttpClient.ts
export class MyHttpClient implements MyPort {
  async myMethod() {
    await this.sendUpdate(...);
  }
}
```

## Testing Strategy

### Unit Tests (Services)
```typescript
describe('WorkflowStateService', () => {
  it('should track node entry', () => {
    const service = new WorkflowStateService();
    service.startJob('job-1');
    service.enterNode('job-1', 'resolve');
    
    const state = service.getState('job-1');
    expect(state.currentNode).toBe('resolve');
  });
});
```

### Integration Tests (Routes)
```typescript
describe('POST /jobs/:jobId/workflow/update', () => {
  it('should update workflow state', async () => {
    const response = await request(app)
      .post('/api/jobs/job-1/workflow/update')
      .send({ action: 'enterNode', nodeId: 'resolve' });
    
    expect(response.status).toBe(200);
  });
});
```

## Best Practices

### ✅ Do
- Keep services independent of HTTP layer
- Use dependency injection
- Follow single responsibility principle
- Add JSDoc comments
- Handle errors gracefully
- Log important events
- Use TypeScript types strictly

### ❌ Don't
- Mix HTTP logic with business logic
- Access global state directly
- Use concrete implementations (use interfaces)
- Ignore errors silently
- Create god classes/services
- Bypass the port interfaces

## Hexagonal Architecture Compliance

### ✅ This implementation follows:
1. **Ports** defined in `core/ports/`
2. **Adapters** implement ports in `periphery/adapters/`
3. **Dependency Inversion**: Core depends on interfaces, adapters depend on core
4. **Testability**: Services can be tested without adapters
5. **Flexibility**: Easy to swap implementations (e.g., ExpressServerAdapter → FastifyAdapter)

### 🎯 Key Benefits:
- **Independent of frameworks**: Business logic doesn't depend on Express
- **Testable**: Can test without HTTP server
- **Flexible**: Can add new adapters without changing core
- **Maintainable**: Clear separation of concerns

