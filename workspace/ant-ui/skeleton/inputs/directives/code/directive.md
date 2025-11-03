# Migrate ANT UI from Electron to Browser-Based Web Application

## Context

The current ant-ui is designed for Electron with Node.js file system access. However, we have now implemented a REST API + SSE server in ant-cli (`ExpressServerAdapter`). We want to migrate ant-ui to a pure browser application that communicates with this server.

## Objective

Transform ant-ui from an Electron desktop app into a browser-based React application that:

1. **Removes all Electron dependencies** - Delete electron/ folder, remove Electron packages, clean up package.json
2. **Implements real API client** - Replace all mock/stub implementations with actual HTTP + SSE calls to ant-cli server
3. **Maintains existing UI/UX** - Keep the same visual design and user experience
4. **Supports desktop viewport only** - No mobile responsiveness needed (min-width: 1280px)

## Server API Endpoints Available

The ant-cli server (`http://localhost:3001`) provides:

- `GET /api/projects` - List all projects
- `GET /api/projects/:id/session` - Get current session data
- `POST /api/projects/:id/execute` - Execute a task (returns taskId)
- `GET /api/tasks/:taskId/stream` - SSE stream of real-time logs
- `GET /api/tasks/:taskId/status` - Get task status

## Key Changes Required

### 1. Remove Electron Infrastructure

**Delete these files:**
- `electron/main.ts` - Electron main process
- `electron/preload.ts` - Electron preload script
- `tsconfig.electron.json` - Electron TypeScript config

**Update package.json:**
- Remove any Electron dependencies
- Remove `chokidar` (file watching, not needed)
- Keep only: `dev`, `build`, `preview` scripts
- Remove Electron-related scripts

### 2. Implement Real API Client

**Create `src/lib/api.ts`** with these functions:

```typescript
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

// Fetch projects list
export async function fetchProjects(): Promise<string[]>

// Fetch session for a project
export async function fetchSession(projectId: string): Promise<Session | null>

// Execute a task
export async function executeTask(params: {
  project: string;
  task: 'design' | 'code' | 'learn';
  agent?: 'architect';
  mode?: 'generate' | 'refactor' | 'explain';
}): Promise<{ taskId: string }>

// Subscribe to task logs via SSE
export function subscribeToLogs(taskId: string, onLog: (log: LogEntry) => void): EventSource

// Get task status
export async function fetchTaskStatus(taskId: string): Promise<TaskStatus>
```

Use native browser APIs:
- `fetch()` for HTTP requests
- `EventSource` for SSE streaming
- No external HTTP libraries needed

### 3. Replace Mock Implementations

**src/lib/projects.ts:**
- Replace the stub `listProjects()` with call to `fetchProjects()`
- Remove browser compatibility warnings

**src/lib/session.ts:**
- Replace `watchSession()` stub with:
  - Initial fetch via `fetchSession()`
  - Polling every 2 seconds to check for updates
  - Call callback when session changes
- Replace `loadSession()` with `fetchSession()`
- Remove browser warnings

**src/lib/cli.ts:**
- Replace `executeCodeTask()` mock with:
  - Call `executeTask()` to get taskId
  - Subscribe to `subscribeToLogs(taskId)` for real-time output
  - Return object with taskId and EventSource
- Remove all mock child process logic

### 4. Update Store for Real-Time Logs

**src/lib/store.ts** (or wherever LogStore is):

Add these new capabilities:
- Track active EventSource connections (Map<taskId, EventSource>)
- Add `startLogStream(taskId)` method
- Add `stopLogStream(taskId)` method to close SSE connection
- Add connection status: `'connected' | 'disconnected' | 'error'`

When task starts:
1. Clear old logs
2. Call `startLogStream(taskId)`
3. EventSource sends logs → `addLog()` each one

When task completes:
1. Call `stopLogStream(taskId)` to close connection
2. Set running status to false

### 5. Update React Components

**src/App.tsx:**
- Remove Electron-specific useRef for watchers
- Use the new API client functions
- Handle SSE connections properly
- Show connection status indicator

**src/components/TerminalOutput.tsx:**
- Already displays logs from store - no major changes
- Optionally add "streaming..." indicator when EventSource is active

**src/components/SessionView.tsx:**
- Already displays session from store - minimal changes

**New component (optional): `src/components/ConnectionStatus.tsx`:**
```tsx
export function ConnectionStatus({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-2">
      {status === 'connected' && <span className="text-green-500">🟢 Connected</span>}
      {status === 'disconnected' && <span className="text-red-500">🔴 Disconnected</span>}
      {status === 'error' && <span className="text-yellow-500">🟡 Connection Error</span>}
    </div>
  );
}
```

### 6. Add Environment Configuration

**Create `.env.development`:**
```env
VITE_API_BASE=http://localhost:3001/api
```

**Create `.env.production`:**
```env
VITE_API_BASE=/api
```

**Update vite.config.ts:**
Add proxy for development:
```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
```

### 7. Add Type Definitions

**Create `src/types/api.ts`:**
```typescript
export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
```

## Implementation Notes

**Preserve existing implementations:**
- Keep all existing UI components (Header, ProjectList, SessionView, TaskQueue, TerminalOutput)
- Keep Tailwind styling exactly as is
- Keep store structure (just add SSE management)
- Keep type definitions in `src/types/session.ts`

**Error handling:**
- Wrap all API calls in try/catch
- Show user-friendly error messages
- Log detailed errors to console
- Add retry logic for failed connections

**Testing during development:**
1. Terminal 1: `cd packages/ant-cli && pnpm dev:server` (starts server on :3001)
2. Terminal 2: `cd packages/ant-ui && pnpm dev` (starts Vite on :5173)
3. Browser: http://localhost:5173
4. Should see projects list from real API
5. Execute task should show real logs streaming

## Success Criteria

After implementation:

✅ No Electron files or dependencies remain
✅ `pnpm dev` starts browser app successfully
✅ Projects list loads from ant-cli server API
✅ Selecting project shows real session data
✅ Clicking "Run Code" executes actual task via API
✅ Terminal shows real-time logs from SSE stream
✅ Task completion updates session state
✅ Connection status visible to user
✅ Proper error handling for network failures

## Example Flow After Migration

1. User opens browser to http://localhost:5173
2. App fetches projects from GET /api/projects
3. User selects "test-app" project
4. App fetches session from GET /api/projects/test-app/session
5. User clicks "Run Code" button
6. App POSTs to /api/projects/test-app/execute
7. Server returns `{ taskId: "task-123..." }`
8. App subscribes to GET /api/tasks/task-123.../stream (SSE)
9. Logs stream in real-time to terminal output
10. Task completes, EventSource closes
11. Session polling detects updated session.json

## Files to Modify

**Delete:**
- `electron/main.ts`
- `electron/preload.ts`
- `tsconfig.electron.json`

**Create:**
- `src/lib/api.ts` (new API client)
- `src/types/api.ts` (new type definitions)
- `.env.development`
- `.env.production`
- `src/components/ConnectionStatus.tsx` (optional)

**Modify:**
- `package.json` (remove Electron deps, update scripts)
- `src/lib/projects.ts` (use real API)
- `src/lib/session.ts` (use real API + polling)
- `src/lib/cli.ts` (use real API + SSE)
- `src/lib/store.ts` (add SSE management)
- `src/App.tsx` (use API client, handle SSE)
- `vite.config.ts` (add proxy)

**Keep unchanged:**
- All UI components visual styling
- `src/components/Header.tsx`
- `src/components/ProjectList.tsx`
- `src/components/SessionView.tsx`
- `src/components/TaskQueue.tsx`
- `src/components/TerminalOutput.tsx` (just receives logs from store)

## Important Notes

- The ant-cli server is already implemented and running - just use its APIs
- Focus on making the UI communicate with server, not building new server features
- Maintain the exact same user experience, just with real backend
- Desktop-only viewport (no mobile support needed)
- Server must be running on localhost:3001 for development
