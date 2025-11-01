# ANT UI - Product Requirements Document

## Overview

**Desktop application** that monitors and controls ANT CLI agents running on the **same machine**. Visualizes workflow execution, task queues, and output by directly reading files that ANT CLI writes.

**Deployment Model**: Single-machine deployment (CLI and UI run on the same machine, no network required)

## Goals

### Primary Goals
1. Execute all architect agent CLI commands through UI (via Node.js `child_process`)
2. Visualize LangGraph workflow execution in real-time
3. Monitor task queue dynamics
4. Display terminal output in UI
5. Track session state changes
6. Handle recursion limit scenarios with user prompts

### Secondary Goals
- Eliminate need for terminal access for non-technical users
- Provide debugging visibility into agent internals
- Enable workflow analysis and optimization

## Architecture Constraints

**CRITICAL**: ANT CLI does NOT provide any API or WebSocket server. It only writes files:

```
workspace/
  {project}/
    skeleton/
      outputs/
        session.json     ← Real-time state (task queue, progress)
        reports/*.log    ← Terminal output logs
        design/*.md      ← Design documents
```

**ANT UI must:**
- **Read** these files directly using Node.js `fs` APIs
- **Watch** for changes using `chokidar` file watcher
- **Execute** CLI commands using `child_process.spawn`
- **Stream** CLI stdout/stderr to UI in real-time

**NO HTTP, NO WebSocket, NO REST API - Just file I/O!**

## User Personas

### Persona 1: Developer
- Needs to monitor agent execution
- Wants to debug workflow issues
- Requires detailed logs and state information

### Persona 2: Technical Lead
- Oversees multiple projects
- Needs quick status overview
- Wants to retry failed tasks

### Persona 3: Non-Technical Stakeholder
- Wants to see progress without CLI
- Needs simple project/feature creation
- Requires visual confirmation of completion

## Use Cases

### UC-1: Create New Project
**Actor**: Developer  
**Flow**:
1. Click "New Project" button
2. Enter project name
3. UI creates `workspace/{project}/config.json` using `fs.writeFile`
4. UI shows project in sidebar

**Implementation**: Direct file creation via Node.js `fs` module

### UC-2: Create Feature
**Actor**: Developer  
**Flow**:
1. Select project from sidebar
2. Click "New Feature"
3. Enter feature name
4. UI creates directory structure using `fs.mkdir`
5. UI shows feature in project tree

**Implementation**: Direct directory creation via Node.js `fs` module

### UC-3: Upload PRD
**Actor**: Developer  
**Flow**:
1. Select feature
2. Click "Upload PRD" or drag-drop
3. UI saves file to `workspace/{project}/{feature}/inputs/sources/prd.md`
4. UI shows file in inputs panel

**Implementation**: Direct file write via Node.js `fs.writeFile`

### UC-4: Execute Design Task
**Actor**: Developer  
**Flow**:
1. Select feature with PRD
2. Click "Run Design Task" button
3. UI spawns CLI process: `pnpm dev arch design workspace/{project}/{feature}/`
4. UI streams stdout/stderr to output panel in real-time
5. UI watches `session.json` for state changes
6. Design document appears in outputs when CLI completes

**Implementation**:
- **Execute**: `child_process.spawn('pnpm', ['dev', 'arch', 'design', '...'])`
- **Stream output**: Listen to `process.stdout.on('data', ...)`
- **Monitor state**: `chokidar.watch('workspace/{project}/*/outputs/session.json')`

### UC-5: Execute Code Task
**Actor**: Developer  
**Flow**:
1. Select feature with design document
2. Click "Run Code Task" button
3. UI spawns CLI process: `pnpm dev arch code workspace/{project}/{feature}/`
4. UI displays:
   - Task queue (read from `session.json.state.taskQueue`)
   - Current task (read from `session.json.state.currentTask`)
   - Terminal output (stream from CLI process)
   - File changes (read from `session.json.turns[].output.files`)
5. UI updates in real-time as `session.json` changes

**Implementation**:
- **Execute**: `child_process.spawn()`
- **Real-time updates**: `chokidar` detects `session.json` changes → parse JSON → update UI state

### UC-6: Handle Recursion Limit
**Actor**: Developer  
**Flow**:
1. CLI hits recursion limit and exits
2. UI detects process exit
3. UI reads `session.json.state` to show current progress
4. User clicks "Resume" button
5. UI executes same CLI command again (CLI resumes from saved state)

**Implementation**:
- **Detect**: `process.on('exit', (code) => ...)`
- **Read state**: `fs.readFileSync('session.json')` → parse `state` field
- **Resume**: Spawn new CLI process (CLI reads `state` automatically)

### UC-7: Monitor Real-Time Session State
**Actor**: Developer  
**Flow**:
1. CLI is running (spawned by UI)
2. CLI writes to `session.json` every few seconds
3. `chokidar` detects file change
4. UI reads updated JSON
5. UI displays:
   - Task queue length
   - Current task name
   - Completed task count
   - Retry count
   - Last error (if any)

**Implementation**:
```typescript
const watcher = chokidar.watch('workspace/*/skeleton/outputs/session.json');
watcher.on('change', (path) => {
  const session = JSON.parse(fs.readFileSync(path, 'utf-8'));
  updateUI(session.state);
});
```

### UC-8: View Terminal Output
**Actor**: Developer  
**Flow**:
1. CLI process is running
2. CLI writes to stdout/stderr
3. UI captures output via `process.stdout.on('data', ...)`
4. UI displays in scrollable terminal panel
5. UI also tails `.log` file for historical view

**Implementation**:
- **Real-time**: `process.stdout.pipe(terminalUI)`
- **Historical**: `fs.readFileSync('outputs/reports/architect-code-*.log')`

### UC-9: Browse Project Files
**Actor**: Developer  
**Flow**:
1. User clicks "Files" tab
2. UI reads directory structure: `fs.readdirSync('workspace/{project}')`
3. UI shows file tree
4. User clicks file
5. UI reads file content: `fs.readFileSync(path)`
6. UI displays in code viewer

**Implementation**: Direct file system traversal and reading

## Functional Requirements

### FR-1: Command Execution Panel
- Button to execute design/code/learn tasks
- Executes via `child_process.spawn()`
- Shows process status (running/completed/failed)
- Displays exit code

### FR-2: Terminal Output Panel
- Scrollable terminal-style output
- Real-time streaming from CLI stdout/stderr
- Auto-scroll to bottom (with pause option)
- Search/filter logs
- Download full log file

### FR-3: Session State Monitor
**Displays data from `session.json`:**
- Session ID
- Project name
- Feature name
- Created/Updated timestamps
- Task queue:
  - Total tasks
  - Completed tasks
  - Current task details
  - Remaining tasks with priorities
- Retry count
- Latest artifacts (design path, branch, etc.)

**Update mechanism**: `chokidar.watch()` → parse JSON → update React state

### FR-4: Task Queue Visualization
**Reads from `session.json.state.taskQueue`:**
- List of tasks with:
  - ID
  - Name
  - Priority
  - Status (pending/in_progress/completed)
  - Validation type
- Current task highlighted
- Real-time updates as tasks complete

### FR-5: File Browser
- Tree view of `workspace/` directory
- File content viewer
- Syntax highlighting for code files
- Markdown rendering for `.md` files

### FR-6: Resume Capability
- Detect CLI process exit
- Read `session.json.state` to check if resumable
- Show "Resume" button if `taskQueue` has remaining tasks
- Execute same CLI command (CLI auto-resumes from saved state)

### FR-7: Project/Feature Management
- List all projects (read `workspace/` directories)
- Create new project (write `config.json`)
- Create new feature (create directory structure)
- Select active project/feature for monitoring

## Technical Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript 5
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI primitives)
- **State Management**: Zustand
- **File Watching**: chokidar
- **Process Execution**: Node.js `child_process`
- **File I/O**: Node.js `fs` / `fs/promises`
- **Date Utilities**: date-fns

### Architecture Pattern

**Feature-Sliced Design (FSD)** with **Repository Pattern** for data access:

```
src/
  app/          - Application setup
  pages/        - Page components
  widgets/      - Complex feature blocks
  features/     - User interactions
  entities/     - Business entities
  shared/       - Reusable components
```

**Repository Pattern** for extensibility:

```typescript
// Domain Layer - Interface
interface ISessionRepository {
  loadSession(project: string): Promise<Session>;
  watchSession(project: string, callback: (session: Session) => void): void;
}

// Infrastructure Layer - Current Implementation
class FileSystemSessionRepository implements ISessionRepository {
  async loadSession(project: string) {
    const path = `workspace/${project}/skeleton/outputs/session.json`;
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content);
  }
  
  watchSession(project: string, callback) {
    const path = `workspace/${project}/skeleton/outputs/session.json`;
    chokidar.watch(path).on('change', async () => {
      const session = await this.loadSession(project);
      callback(session);
    });
  }
}

// Application Layer - Uses interface
function useSession(project: string) {
  const [session, setSession] = useState(null);
  
  useEffect(() => {
    const repo = new FileSystemSessionRepository();
    repo.watchSession(project, setSession);
  }, [project]);
  
  return session;
}
```

**Why Repository Pattern?**
- **Current need**: File system access only
- **Future flexibility**: Could add HTTP/WebSocket implementation later without changing application code
- **Testability**: Easy to mock repositories in tests
- **Clean Architecture**: Domain/Application layers don't know about file system details

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│                    React UI                         │
│  - Displays session state                           │
│  - Shows task queue                                 │
│  - Renders terminal output                          │
└───────────────────┬─────────────────────────────────┘
                    │
                    │ (updates state)
                    │
┌───────────────────▼─────────────────────────────────┐
│           Repository Layer                          │
│  FileSystemSessionRepository                        │
│  FileSystemCommandRepository                        │
│  FileSystemLogRepository                            │
└───────────────────┬─────────────────────────────────┘
                    │
                    │ (fs.readFile, chokidar.watch, child_process.spawn)
                    │
┌───────────────────▼─────────────────────────────────┐
│            File System + Process                    │
│                                                     │
│  workspace/{project}/skeleton/outputs/              │
│    - session.json  (ANT CLI writes this)            │
│    - reports/*.log                                  │
│    - design/*.md                                    │
│                                                     │
│  ANT CLI Process (spawned by UI)                    │
│    - stdout/stderr piped to UI                      │
│    - Exit code captured                             │
└─────────────────────────────────────────────────────┘
```

### Implementation Details

**1. Session Monitoring**
```typescript
class FileSystemSessionRepository {
  watchSession(project: string, callback: (session: Session) => void) {
    const sessionPath = `workspace/${project}/skeleton/outputs/session.json`;
    
    // Initial load
    callback(this.loadSession(project));
    
    // Watch for changes
    chokidar.watch(sessionPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    }).on('change', async () => {
      callback(await this.loadSession(project));
    });
  }
}
```

**2. Command Execution**
```typescript
class FileSystemCommandRepository {
  executeArchitectCommand(
    task: 'design' | 'code' | 'learn',
    projectPath: string,
    onOutput: (data: string) => void,
    onExit: (code: number) => void
  ) {
    const proc = spawn('pnpm', ['dev', 'arch', task, projectPath], {
      cwd: ANT_CLI_ROOT,
      shell: true
    });
    
    proc.stdout.on('data', (data) => onOutput(data.toString()));
    proc.stderr.on('data', (data) => onOutput(data.toString()));
    proc.on('exit', (code) => onExit(code));
    
    return proc; // Return for kill() capability
  }
}
```

**3. Log Tailing**
```typescript
class FileSystemLogRepository {
  watchLatestLog(project: string, callback: (content: string) => void) {
    const logsDir = `workspace/${project}/skeleton/outputs/reports`;
    
    // Find latest log file
    const logs = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
    
    const latestLog = path.join(logsDir, logs[0]);
    
    // Watch for changes
    chokidar.watch(latestLog).on('change', () => {
      const content = fs.readFileSync(latestLog, 'utf-8');
      callback(content);
    });
  }
}
```

## Non-Functional Requirements

### NFR-1: Performance
- UI updates within 100ms of `session.json` change
- Terminal output streams with <50ms latency
- Handles log files up to 100MB

### NFR-2: Reliability
- Gracefully handle CLI process crashes
- Recover from `session.json` parse errors (malformed JSON during write)
- Auto-reconnect file watchers if files are deleted/recreated

### NFR-3: Usability
- Desktop-first design (1920x1080 target)
- Keyboard shortcuts for common actions
- Dark/light theme support

### NFR-4: Maintainability
- TypeScript strict mode enabled
- ESLint + Prettier configured
- Repository pattern for data access (easy to extend to HTTP later)

## Out of Scope (V1)

❌ **NO HTTP server** - File system only  
❌ **NO WebSocket server** - `chokidar` for real-time updates  
❌ **NO REST API** - Direct file I/O  
❌ **NO authentication** - Local desktop app  
❌ **NO multi-user support** - Single user per machine  
❌ **NO remote monitoring** - Same-machine only  

## Future Considerations (V2+)

If remote monitoring becomes a requirement:
1. Create `HTTPSessionRepository` implementing `ISessionRepository`
2. Build separate backend service that exposes ANT CLI data via REST/WebSocket
3. Switch repository implementation without changing application code
4. Enable remote dashboard for team leads

**But for V1: File system access only!**

## Success Metrics

- Users can execute all architect tasks without touching terminal
- Real-time UI updates reflect CLI state within 100ms
- Zero network dependencies (works offline)
- Developers prefer UI over CLI for monitoring tasks
