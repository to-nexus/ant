# ExpressServerAdapter Refactoring

## Overview

ExpressServerAdapter was refactored into submodules so that each module has a single responsibility.

## Directory Structure

```
express/
├── ExpressServerAdapter.ts          # Main adapter (composition class)
├── index.ts                          # Export file
├── types/
│   └── index.ts                      # Shared type definitions
├── config/
│   ├── ServerConfigurator.ts         # HTTP server configuration (CORS, middleware, auth)
│   ├── RouteConfigurator.ts          # Route configuration and registration
│   └── index.ts
├── managers/
│   ├── JobStateTracker.ts            # Job state tracking (in-memory state)
│   ├── JobExecutionManager.ts        # Job execution management (child process)
│   ├── JobCleanupManager.ts          # Job cleanup and session persistence
│   ├── SessionFileWatcher.ts         # Session file watching
│   └── index.ts
├── bridges/
│   ├── WorkflowBridge.ts             # Workflow state update bridge
│   └── index.ts
├── lifecycle/
│   ├── ServerLifecycleManager.ts     # Server lifecycle (graceful shutdown)
│   └── index.ts
└── services/
    └── ServiceInitializer.ts         # Service dependency initialization
```

## Responsibilities per Module

### 1. ExpressServerAdapter (main adapter)
- Composes all submodules to implement the Port interface
- Thin delegation layer
- Singleton instance management

### 2. ServerConfigurator (server configuration)
- CORS configuration
- Body parser configuration
- Dev server & IDE proxy middleware
- Cloud mode authentication middleware

### 3. RouteConfigurator (route configuration)
- Registers all API endpoints
- Per-mode root route handling
- Internal endpoint setup

### 4. JobStateTracker (state tracking)
- In-memory storage of job state
- Task queue snapshot management
- Job-to-project mapping management
- State query and update API

### 5. JobExecutionManager (execution management)
- Starts job execution (executeJob)
- Child process creation and monitoring
- Log streaming
- Exit handler (success/failure/interruption)

### 6. JobCleanupManager (cleanup management)
- Cleanup on job termination
- Session file updates
- Restoring interrupted task queues
- Persisting interruption info
- Final Kanban broadcast

### 7. SessionFileWatcher (file watching)
- Watches session file changes
- Checks SSE clients

### 8. WorkflowBridge (Kanban/FileTree bridge)
- Task queue update → Kanban broadcast (via Redis Pub/Sub)
- File tree update notifications (via Redis Pub/Sub)
- Note: Workflow state tracking (enterNode, exitNode, etc.) is handled directly by the Job Worker's WorkflowBroadcaster

### 9. ServerLifecycleManager (lifecycle)
- Graceful shutdown
- Saving running jobs
- Terminating child processes
- Service cleanup
- Timeout and force shutdown

### 10. ServiceInitializer (service initialization)
- Creates all dependent services
- Per-mode service composition
- Initializes WorkspaceService, PortManager, IDEService, etc.

## Benefits

### 1. Single Responsibility Principle (SRP)
- Each module has one clear responsibility
- Adding/modifying a feature only touches the relevant module

### 2. Testability
- Each module can be tested independently
- Easy to inject mock dependencies

### 3. Readability
- 2,177 lines → 100–400 lines per module
- Files split by feature are easier to understand

### 4. Extensibility
- New features can be added as new modules
- Minimal impact on existing code

### 5. Maintainability
- Bug fixes only require inspecting the relevant module
- Dependencies are clearly defined

## Migration

Old code:
```typescript
import { ExpressServerAdapter } from '../periphery/adapters/http/ExpressServerAdapter';
```

New code:
```typescript
import { ExpressServerAdapter } from '../periphery/adapters/http/express';
```

The original file is backed up as `ExpressServerAdapter.ts.backup`.

## Future Improvements

1. **Wire up session file callbacks**: properly connect SessionService's onSessionChange callback in ExpressServerAdapter
2. **Better type safety**: replace `any` types with concrete types
3. **Standardized error handling**: unify error-handling patterns across modules
4. **Logging consistency**: use the same logging pattern in all modules
5. **Unit tests**: write test cases per module
