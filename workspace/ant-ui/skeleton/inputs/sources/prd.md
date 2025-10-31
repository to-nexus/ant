# ANT UI - Product Requirements Document

## Overview

Web-based monitoring and control interface for ANT (AI-Native Transformation) CLI agents. Provides real-time visualization of LangGraph workflows, task queue management, and interactive command execution replacing CLI commands with UI interactions.

## Goals

### Primary Goals
1. Execute all architect agent CLI commands through UI
2. Visualize LangGraph workflow execution in real-time (n8n-style node graph)
3. Monitor task queue dynamics (creation, completion, priority changes)
4. Display terminal output in dedicated UI panel
5. Track LLM API calls and responses
6. Visualize data persistence (Session JSON, Vector DB)
7. Handle recursion limit scenarios with user prompts

### Secondary Goals
- Eliminate need for terminal access for non-technical users
- Provide debugging visibility into agent internals
- Enable workflow analysis and optimization

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
3. System creates `workspace/{project}/config.json`
4. System shows project in sidebar

**CLI Equivalent**: `pnpm init:workspace {project}`

### UC-2: Create Feature
**Actor**: Developer  
**Flow**:
1. Select project from sidebar
2. Click "New Feature"
3. Enter feature name
4. System creates directory structure
5. System shows feature in project tree

**CLI Equivalent**: `pnpm init:feature {project} {feature}`

### UC-3: Upload PRD
**Actor**: Developer  
**Flow**:
1. Select feature
2. Click "Upload PRD" or drag-drop
3. File saves to `workspace/{project}/{feature}/inputs/sources/prd.md`
4. System shows file in inputs panel

### UC-4: Execute Design Task
**Actor**: Developer  
**Flow**:
1. Select feature with PRD
2. Click "Run Design Task" button
3. System executes: `pnpm dev arch design workspace/{project}/{feature}/`
4. Workflow visualization appears showing LangGraph nodes
5. Terminal output streams to output panel
6. Design document appears in outputs when complete

**CLI Equivalent**: `pnpm dev arch design workspace/{project}/{feature}/`

### UC-5: Execute Code Task
**Actor**: Developer  
**Flow**:
1. Select feature with design document
2. Click "Run Code Task" button
3. System executes: `pnpm dev arch code workspace/{project}/{feature}/`
4. Workflow graph shows:
   - resolve → decompose → plan → execute → writeFiles → validate → installDeps → runtimeValidate
5. Task queue panel shows dynamic task list with priorities
6. Terminal output streams continuously
7. LLM API calls show in dedicated panel with request/response
8. Session updates and Vector DB saves trigger visual indicators

**CLI Equivalent**: `pnpm dev arch code workspace/{project}/{feature}/`

### UC-6: Handle Recursion Limit
**Actor**: Developer  
**Flow**:
1. Code task hits recursion limit (25)
2. System pauses execution
3. Modal dialog appears: "Task paused due to recursion limit. Continue from checkpoint?"
4. User clicks "Resume"
5. System executes same command
6. Workflow continues from last checkpoint

### UC-7: Monitor Task Queue
**Actor**: Developer  
**Flow**:
1. During code task execution
2. Task queue panel shows:
   - Setup tasks (P100-149)
   - Error tasks (P1-99)
   - Feature tasks (P200-299)
3. Tasks appear, move up/down by priority, and disappear when completed
4. Completed tasks list grows in separate section
5. Real-time count: "3 completed, 5 remaining"

### UC-8: View Workflow Graph
**Actor**: Developer  
**Flow**:
1. During any task execution
2. Center panel shows n8n-style node graph:
   - Nodes: resolve, decompose, plan, execute, etc.
   - Edges: arrows between nodes
   - Active node: highlighted in blue with pulsing animation
   - Completed nodes: green checkmark
   - Current execution path: highlighted edges
3. Nodes update in real-time as workflow progresses

### UC-9: View Terminal Output
**Actor**: Developer  
**Flow**:
1. During task execution
2. Bottom panel shows terminal output:
   - Timestamp per line
   - Color-coded: info (white), warning (yellow), error (red), success (green)
   - Auto-scroll to latest
   - Search functionality
   - Copy button

### UC-10: Track Data Persistence
**Actor**: Developer  
**Flow**:
1. During/after task execution
2. Right panel shows storage events:
   - "Session checkpoint saved" with JSON icon
   - "Vector DB: 4 chunks stored" with database icon
   - Click event to see details (JSON viewer)

## Functional Requirements

### FR-1: Project Management
- **FR-1.1**: Create workspace project via UI form
- **FR-1.2**: List all projects in sidebar
- **FR-1.3**: Select project to view features
- **FR-1.4**: Delete project (with confirmation)

### FR-2: Feature Management
- **FR-2.1**: Create feature under project via UI form
- **FR-2.2**: List features in tree view
- **FR-2.3**: Select feature to view details
- **FR-2.4**: Show feature status (has PRD, has design, has code)
- **FR-2.5**: Delete feature (with confirmation)

### FR-3: File Management
- **FR-3.1**: Upload PRD file (drag-drop or file picker)
- **FR-3.2**: Upload design directive
- **FR-3.3**: Upload code directive
- **FR-3.4**: View uploaded files in inputs panel
- **FR-3.5**: Edit files inline (Markdown editor)
- **FR-3.6**: Download generated files (design docs, code)

### FR-4: Task Execution
- **FR-4.1**: Execute design task via button
- **FR-4.2**: Execute code task via button
- **FR-4.3**: Execute learn task via button
- **FR-4.4**: Cancel running task
- **FR-4.5**: Retry failed task
- **FR-4.6**: Resume from checkpoint (after recursion limit)

### FR-5: Workflow Visualization
- **FR-5.1**: Display LangGraph nodes as interactive graph
- **FR-5.2**: Highlight active node during execution
- **FR-5.3**: Show completed nodes with checkmark
- **FR-5.4**: Show failed nodes with error icon
- **FR-5.5**: Display edge transitions with animation
- **FR-5.6**: Support different graphs (design, code, learn)
- **FR-5.7**: Show conditional edges (validate → enforce vs installDeps)

### FR-6: Task Queue Monitoring
- **FR-6.1**: Display task queue in real-time
- **FR-6.2**: Show task properties: id, name, type, priority
- **FR-6.3**: Sort tasks by priority
- **FR-6.4**: Highlight current task
- **FR-6.5**: Show completed tasks list
- **FR-6.6**: Display task statistics (3/8 completed)
- **FR-6.7**: Show task type badges (setup, error, feature)

### FR-7: Terminal Output
- **FR-7.1**: Stream terminal output in real-time
- **FR-7.2**: Color-code by log level
- **FR-7.3**: Auto-scroll to latest
- **FR-7.4**: Manual scroll with sticky bottom behavior
- **FR-7.5**: Search/filter logs
- **FR-7.6**: Copy logs to clipboard
- **FR-7.7**: Clear logs button
- **FR-7.8**: Download logs as file

### FR-8: LLM API Monitoring
- **FR-8.1**: Display LLM API call events
- **FR-8.2**: Show request details (prompt, model, tokens)
- **FR-8.3**: Show response details (content, finish_reason, tokens)
- **FR-8.4**: Show timing (duration)
- **FR-8.5**: Collapsible request/response panels

### FR-9: Data Persistence Tracking
- **FR-9.1**: Show session checkpoint events
- **FR-9.2**: Show vector DB storage events
- **FR-9.3**: Display data size (chunks, KB)
- **FR-9.4**: Click to view stored data (JSON viewer)
- **FR-9.5**: Show session.json updates in real-time

### FR-10: Error Handling
- **FR-10.1**: Display validation violations in UI
- **FR-10.2**: Show diagnostics details (file, line, message)
- **FR-10.3**: Recursion limit modal with resume option
- **FR-10.4**: Max retries modal with skip/abort options
- **FR-10.5**: Build error details with suggested fixes

### FR-11: Settings
- **FR-11.1**: Configure LLM provider (OpenAI/Anthropic)
- **FR-11.2**: Configure LLM model
- **FR-11.3**: Set workspace root path
- **FR-11.4**: Configure recursion limit
- **FR-11.5**: Enable/disable auto-resume

## Technical Requirements

### TR-1: Architecture
- **TR-1.1**: React + TypeScript
- **TR-1.2**: Vite for build/dev
- **TR-1.3**: Repository pattern for data access (FileWatcherRepository)
- **TR-1.4**: CommandService for CLI execution (child_process)
- **TR-1.5**: State management (React Context or Zustand)

### TR-2: Data Access
- **TR-2.1**: Read session.json via file system
- **TR-2.2**: Watch session.json for changes (chokidar)
- **TR-2.3**: Read log files for terminal output
- **TR-2.4**: Execute CLI commands via spawn
- **TR-2.5**: Stream command output in real-time

### TR-3: Type Safety
- **TR-3.1**: Import types from @ant/cli:
  ```typescript
  import { 
    Task, 
    Session, 
    Violation, 
    ArchitectGraphState 
  } from '@ant/cli/src/agents/architect/graph/code/state';
  ```

### TR-4: Workflow Visualization
- **TR-4.1**: Use React Flow library for node graph
- **TR-4.2**: Define node types (standard, conditional, terminal)
- **TR-4.3**: Animate active node (pulsing border)
- **TR-4.4**: Animate edge transitions
- **TR-4.5**: Support zoom/pan

### TR-5: Real-Time Updates
- **TR-5.1**: File watcher triggers state updates
- **TR-5.2**: Command output triggers log updates
- **TR-5.3**: 100ms debounce for rapid updates
- **TR-5.4**: WebSocket (future: for remote execution)

### TR-6: Performance
- **TR-6.1**: Virtual scrolling for large logs (react-window)
- **TR-6.2**: Memoize expensive components
- **TR-6.3**: Lazy load file contents
- **TR-6.4**: Limit log buffer (max 10,000 lines)

### TR-7: Error Recovery
- **TR-7.1**: Graceful handling of missing files
- **TR-7.2**: Retry failed file reads
- **TR-7.3**: Show error notifications (toast)
- **TR-7.4**: Persist UI state to localStorage

## UI/UX Design

### Desktop-Only Application

**Target Platform**: Desktop (macOS, Windows, Linux)  
**Minimum Resolution**: 1920x1080 (Full HD)  
**Recommended**: 2560x1440 or higher for optimal experience

**Rationale**:
- Complex multi-panel layout requires wide screen
- Workflow graph visualization needs space
- Terminal output with logs requires horizontal space
- Developer tool (primary users work on desktops)
- No need for touch interactions

### Layout (Fixed Desktop Layout)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [ANT UI]  [New Project] [Settings]                    [User] [Help]    │
├─────────────────────────────────────────────────────────────────────────┤
│ SIDEBAR │              MAIN CONTENT               │   RIGHT PANEL       │
│  280px  │                                          │      320px          │
│ Projects│  ┌────────────────────────────────────┐ │ TASK QUEUE          │
│ ├─test  │  │   WORKFLOW GRAPH (n8n style)       │ │ ┌─────────────────┐ │
│ │ ├─auth│  │                                    │ │ │[P100] Setup     │ │
│ │ │ PRD │  │   [resolve] → [decompose]          │ │ │[P200] Feature1  │ │
│ │ │ ✓Des│  │        ↓                           │ │ │[P220] Feature2  │ │
│ │ │ ⏳Code  │   [plan] → [execute] →            │ │ └─────────────────┘ │
│ │ └─api│  │   [writeFiles]                     │ │ Completed: 1/3      │
│ └─blog │  │        ↓                           │ │                     │
│         │  │   [validate] → [installDeps]       │ │ STORAGE EVENTS      │
│ [+New]  │  │        ↓                           │ │ ┌─────────────────┐ │
│         │  │   [runtimeValidate]                │ │ │📄 Session saved │ │
│         │  │        ↓                           │ │ │💾 Vector: 4 cks │ │
│         │  │   [evaluate] → [learn]             │ │ └─────────────────┘ │
│         │  └────────────────────────────────────┘ │                     │
│         │                                          │                     │
│         │  [▶ Run Design] [▶ Run Code] [⏹ Stop]  │                     │
├─────────┼──────────────────────────────────────────┴─────────────────────┤
│         │ TERMINAL OUTPUT (300px height, resizable)                     │
│         │ ┌────────────────────────────────────────────────────────────┐ │
│         │ │ [10:30:15] 🎯 Next task: Setup Project Configuration       │ │
│         │ │ [10:30:16] 📝 Generating plan...                           │ │
│         │ │ [10:30:18] 💻 Generating code...                           │ │
│         │ │ [10:30:20] ✨ CREATED package.json                         │ │
│         │ │ [10:30:20] ✨ CREATED tsconfig.json                        │ │
│         │ │ [10:30:21] ✅ Task completed successfully!                 │ │
│         │ │ █                                                           │ │
│         │ └────────────────────────────────────────────────────────────┘ │
│         │ [Clear] [Copy] [Download] [🔍 Search]                          │
└─────────┴──────────────────────────────────────────────────────────────┘

Total Width: 1920px minimum (280px + 1320px + 320px)
Total Height: 1080px minimum
```

### Color Scheme
- **Primary**: Blue (#3b82f6) - Active elements, buttons
- **Success**: Green (#10b981) - Completed nodes, success messages
- **Warning**: Yellow (#f59e0b) - Warnings, in-progress
- **Error**: Red (#ef4444) - Errors, failed nodes
- **Background**: Dark (#1e1e1e) - Dark theme for code/terminal
- **Surface**: Gray (#2d2d2d) - Panels, cards

### Components

#### 1. Project Sidebar
- Tree view with expand/collapse
- Icons for status (✓ has design, ⏳ in progress)
- Context menu (right-click): Edit, Delete, Open in Finder
- Drag-drop files to upload

#### 2. Workflow Graph (Center)
- Node types:
  - **Standard**: Rectangle with rounded corners
  - **Conditional**: Diamond shape
  - **Terminal**: Circle (start/end)
- Node states:
  - **Pending**: Gray border
  - **Active**: Blue border + pulsing animation
  - **Completed**: Green border + checkmark
  - **Failed**: Red border + X icon
- Edge animations:
  - Dashed line moving along path when active

#### 3. Task Queue Panel (Right)
- Card list with priority badges
- Color-coded by type:
  - Setup: Purple
  - Error: Red
  - Feature: Blue
- Current task highlighted
- Progress bar at bottom

#### 4. Terminal Output (Bottom)
- Monospace font (Fira Code)
- Syntax highlighting for file paths
- Icons for log levels (ℹ️ 📝 ⚠️ ❌ ✅)
- Sticky scroll behavior
- Search bar with regex support

#### 5. Storage Events Panel (Right)
- Timeline view (latest on top)
- Expandable cards
- JSON viewer for details
- Icons: 📄 (session), 💾 (vector)

#### 6. Modals
- **New Project**: Name input + Create/Cancel
- **New Feature**: Name input + Create/Cancel
- **Recursion Limit**: "Task paused. Resume from checkpoint?" + Resume/Abort
- **Settings**: Form with all config options

## Architecture

### Frontend Stack
```
React 18 + TypeScript
├── State Management: Zustand
├── Routing: React Router
├── UI Library: Tailwind CSS + shadcn/ui
├── Workflow Graph: React Flow
├── Terminal: xterm.js (optional) or custom
├── File Watching: chokidar (Node.js API via Electron or local server)
└── CLI Execution: child_process (via Electron or local server)
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ UI Components                                                │
│ ├─ ProjectSidebar                                           │
│ ├─ WorkflowGraph                                            │
│ ├─ TaskQueue                                                │
│ ├─ TerminalOutput                                           │
│ └─ StorageEvents                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ hooks (useSession, useLogs, etc.)
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Services Layer                                               │
│ ├─ CommandService.executeStream()                          │
│ ├─ SessionRepository.watchSession()                        │
│ ├─ LogRepository.watchLogs()                               │
│ └─ FileRepository.uploadFile()                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ File System / CLI                                            │
│ ├─ workspace/{project}/{feature}/outputs/session.json      │
│ ├─ workspace/{project}/{feature}/outputs/reports/*.log     │
│ ├─ packages/ant-cli (execute commands)                     │
│ └─ @ant/cli types (import)                                 │
└─────────────────────────────────────────────────────────────┘
```

### Key Services

#### SessionRepository
```typescript
interface SessionRepository {
  getSession(project: string, feature: string): Promise<Session>;
  watchSession(
    project: string, 
    feature: string, 
    callback: (session: Session) => void
  ): () => void;
  getTasks(project: string, feature: string): Promise<TaskState>;
}
```

#### CommandService
```typescript
interface CommandService {
  executeStream(
    command: string,
    args: string[],
    onOutput: (line: string, level: LogLevel) => void,
    onComplete: (exitCode: number) => void
  ): Promise<void>;
  cancel(): void;
}
```

#### LogRepository
```typescript
interface LogRepository {
  getLatestLog(project: string, feature: string): Promise<LogFile>;
  watchLog(
    logPath: string,
    callback: (newLines: string[]) => void
  ): () => void;
}
```

## Data Models

### Session (from @ant/cli)
```typescript
interface Session {
  sessionId: string;
  project: string;
  feature: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  state?: SessionState;
}

interface SessionState {
  taskQueue: Task[];
  completedTasks: string[];
  retries: number;
  lastViolations: Violation[];
}
```

### WorkflowNode (UI-specific)
```typescript
interface WorkflowNode {
  id: string;
  type: 'standard' | 'conditional' | 'terminal';
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  position: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated: boolean;
}
```

### LogLine (UI-specific)
```typescript
interface LogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  icon?: string;
}
```

## Success Metrics

### Performance
- Initial load: < 1s
- Command execution start: < 200ms
- Log update latency: < 100ms
- File watch reaction: < 50ms

### Usability
- 100% CLI commands available in UI
- 0 crashes during normal operation
- < 2 clicks to execute common tasks

### Adoption
- 80% of users prefer UI over CLI (survey)
- 50% reduction in support questions about CLI usage

## Out of Scope

### Phase 1 (Current)
- Multi-user support
- Authentication/authorization
- Remote execution (cloud agents)
- Custom workflow creation
- Plugin system
- **Mobile/Tablet support (Desktop-only application)**
- Dark/light theme toggle (dark only)

### Future Phases
- Phase 2: Remote execution via WebSocket
- Phase 3: Multi-agent orchestration (reviewer, planner)
- Phase 4: Workflow customization
- Phase 5: Team collaboration features

## Technical Constraints

1. **Electron or Local Server Required**
   - File system access not available in browser
   - Options:
     - Option A: Electron app (full desktop)
     - Option B: Local Node.js server + web frontend
   - **Recommended**: Local server (simpler for Phase 1)

2. **File Watching Limitations**
   - Large directories may impact performance
   - Need to watch only relevant paths

3. **Type Safety**
   - Must maintain sync with @ant/cli types
   - Breaking changes in CLI require UI updates

4. **CLI Execution**
   - Must run from packages/ant-cli directory
   - Must handle long-running processes
   - Must capture stdout/stderr separately

## Development Phases

### Phase 1: Core Functionality (Week 1-2)
- Project/feature management (create, list, select)
- File upload (PRD, directives)
- Execute design/code tasks
- Basic terminal output display
- Session.json reading

### Phase 2: Workflow Visualization (Week 3)
- React Flow integration
- Node graph for code workflow
- Active node highlighting
- Edge animations

### Phase 3: Advanced Monitoring (Week 4)
- Task queue real-time display
- LLM API call tracking
- Storage event visualization
- Log search/filter

### Phase 4: Polish (Week 5)
- Error handling (recursion limit, max retries)
- Settings panel
- Keyboard shortcuts
- Documentation

## Risk Mitigation

### Risk 1: File System Access in Browser
**Mitigation**: Use local Node.js server instead of pure web app

### Risk 2: CLI Types Breaking Changes
**Mitigation**: Pin @ant/cli version, automated tests for type compatibility

### Risk 3: Performance with Large Logs
**Mitigation**: Virtual scrolling, log buffer limits, streaming

### Risk 4: Workflow Graph Complexity
**Mitigation**: Start simple (linear layout), iterate based on feedback

## Acceptance Criteria

### Must Have
- ✅ Create project/feature via UI
- ✅ Upload PRD file
- ✅ Execute design task and see output
- ✅ Execute code task and see output
- ✅ Display workflow graph with active node
- ✅ Show task queue in real-time
- ✅ Stream terminal output
- ✅ Handle recursion limit with resume prompt

### Should Have
- LLM API call monitoring
- Storage event visualization
- Log search functionality
- Settings panel

### Nice to Have
- Keyboard shortcuts
- Drag-drop for file upload
- Context menus
- Workflow graph zoom/pan

## Technical Stack Summary

```json
{
  "frontend": {
    "framework": "React 18 + TypeScript",
    "build": "Vite",
    "styling": "Tailwind CSS",
    "components": "shadcn/ui",
    "state": "Zustand",
    "routing": "React Router",
    "workflow": "React Flow",
    "icons": "lucide-react"
  },
  "backend": {
    "runtime": "Node.js (local server)",
    "fileWatch": "chokidar",
    "processExec": "child_process",
    "fileSystem": "fs/promises"
  },
  "types": {
    "source": "@ant/cli",
    "imports": [
      "Task",
      "Session",
      "Violation",
      "ArchitectGraphState"
    ]
  }
}
```

