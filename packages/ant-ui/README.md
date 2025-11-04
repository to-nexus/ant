# ANT UI

A file-based task management and session monitoring application built with React, TypeScript, and Vite. ANT UI provides a real-time interface for monitoring code generation sessions through file system watching - **no backend server required**.

## 🏗️ Architecture Overview

ANT UI is a **pure file-based system** that monitors workspace directories for session changes:

- **No Backend Server**: All data comes from the file system
- **File Watching**: Uses `chokidar` to monitor `session.json` files in real-time
- **Workspace Structure**: Organized by project ID with standardized directory layout
- **Session Format**: JSON-based session files with task queues and metadata

### How It Works

1. **Project Selection**: User selects a project from the workspace directory
2. **File Monitoring**: Application watches `workspace/{projectId}/skeleton/outputs/session.json`
3. **Real-time Updates**: Changes to session.json automatically update the UI
4. **Task Visualization**: Displays task queue, progress, and session details

## 📁 Workspace Structure

The application expects the following directory structure:

```
workspace/
├── project-1/
│   └── skeleton/
│       └── outputs/
│           └── session.json
├── project-2/
│   └── skeleton/
│       └── outputs/
│           └── session.json
└── project-3/
    └── skeleton/
        └── outputs/
            └── session.json
```

**Key Points:**
- Each project has its own directory under `workspace/`
- Session data is stored in `skeleton/outputs/session.json`
- The file watcher monitors this specific path for each project
- Projects are discovered by scanning the workspace directory

## 📄 Session.json Format

The `session.json` file contains all session and task information:

```json
{
  "id": "session-uuid",
  "projectId": "my-project",
  "status": "active",
  "description": "Implementing user authentication feature",
  "goals": [
    "Create login component",
    "Implement JWT authentication",
    "Add protected routes"
  ],
  "tasks": [
    {
      "id": "task-1",
      "type": "implementation",
      "description": "Create login form component",
      "status": "completed",
      "priority": "high",
      "dependencies": [],
      "estimatedHours": 2,
      "actualHours": 1.5,
      "tags": ["frontend", "auth"],
      "notes": "Used React Hook Form for validation"
    },
    {
      "id": "task-2",
      "type": "implementation",
      "description": "Implement JWT token handling",
      "status": "in_progress",
      "priority": "critical",
      "dependencies": ["task-1"],
      "estimatedHours": 3,
      "tags": ["backend", "auth"]
    },
    {
      "id": "task-3",
      "type": "testing",
      "description": "Write authentication tests",
      "status": "pending",
      "priority": "medium",
      "dependencies": ["task-2"],
      "estimatedHours": 2,
      "tags": ["testing", "auth"]
    }
  ],
  "createdAt": "2024-11-03T10:00:00.000Z",
  "updatedAt": "2024-11-03T12:30:00.000Z",
  "startedAt": "2024-11-03T10:05:00.000Z",
  "metadata": {
    "totalTasks": 3,
    "completedTasks": 1,
    "failedTasks": 0,
    "blockedTasks": 0,
    "totalEstimatedHours": 7,
    "totalActualHours": 1.5
  }
}
```

### Session Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique session identifier |
| `projectId` | string | Project identifier (matches workspace directory name) |
| `status` | string | Session status: `active`, `paused`, `completed`, `cancelled` |
| `description` | string | Optional session description |
| `goals` | string[] | Optional list of session goals |
| `tasks` | Task[] | Array of task objects |
| `createdAt` | string | ISO 8601 timestamp of session creation |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `startedAt` | string | Optional ISO 8601 timestamp when session started |
| `completedAt` | string | Optional ISO 8601 timestamp when session completed |
| `pausedAt` | string | Optional ISO 8601 timestamp when session paused |
| `cancelledAt` | string | Optional ISO 8601 timestamp when session cancelled |
| `metadata` | object | Optional metadata with progress statistics |

### Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task identifier |
| `type` | string | Task type: `research`, `implementation`, `testing`, `documentation`, `review`, `deployment`, `bugfix`, `refactor` |
| `description` | string | Task description |
| `status` | string | Task status: `pending`, `in_progress`, `completed`, `failed`, `blocked` |
| `priority` | string | Optional priority: `low`, `medium`, `high`, `critical` |
| `dependencies` | string[] | Array of task IDs this task depends on |
| `assignee` | string | Optional assignee name |
| `estimatedHours` | number | Optional estimated hours to complete |
| `actualHours` | number | Optional actual hours spent |
| `startedAt` | string | Optional ISO 8601 timestamp when task started |
| `completedAt` | string | Optional ISO 8601 timestamp when task completed |
| `blockedReason` | string | Optional reason if task is blocked |
| `notes` | string | Optional task notes |
| `tags` | string[] | Optional array of tags |

## 🛠️ Technology Stack

- **React 18.2.0** - UI framework with hooks
- **TypeScript 5.3.0** - Type safety and developer experience
- **Vite 5.0.0** - Fast build tool and dev server with HMR
- **Zustand 4.4.0** - Lightweight state management
- **Tailwind CSS 3.4.0** - Utility-first CSS framework
- **chokidar 3.5.3** - File system watcher for real-time updates
- **lucide-react 0.294.0** - Icon library
- **class-variance-authority** - Component variant management

### Development Tools

- **ESLint** - Code linting with TypeScript support
- **PostCSS** - CSS processing with Autoprefixer
- **TypeScript ESLint** - TypeScript-specific linting rules

## 🚀 Setup Instructions

### Prerequisites

- **Node.js 18+** installed
- **pnpm** package manager (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ant-ui
```

2. Install dependencies:
```bash
pnpm install
```

### Development

Start the development server with hot module replacement:
```bash
pnpm dev
```

The application will open at `http://localhost:3000`

### Build

Create a production build:
```bash
pnpm build
```

The build output will be in the `dist` directory.

### Preview Production Build

Preview the production build locally:
```bash
pnpm preview
```

### Linting

Run ESLint to check code quality:
```bash
pnpm lint
```

## 📖 Usage Guide

### 1. Select a Project

- Launch the application
- The left sidebar displays all available projects from the `workspace/` directory
- Click on a project to select it
- The application will start monitoring that project's `session.json` file

### 2. Run Code

- Click the **"Run Code"** button in the header
- This executes the code generation task for the selected project
- The terminal output panel shows real-time logs from the execution
- Task queue updates automatically as tasks progress

### 3. View Session

The main interface displays:

- **Session Details Card**: Shows session metadata, status, goals, and progress statistics
- **Task Queue Panel**: Lists all tasks with their status, priority, type, and dependencies
- **Terminal Output**: Real-time logs from code execution (stdout, stderr, info, errors)

### 4. Monitor Progress

- **Current Task**: Highlighted in the task queue
- **Task Status Badges**: Color-coded status indicators (pending, in progress, completed, failed, blocked)
- **Priority Badges**: Visual priority indicators (low, medium, high, critical)
- **Progress Metrics**: Total tasks, completed, failed, blocked counts
- **Time Tracking**: Estimated vs actual hours for each task

## 🏗️ Project Structure

```
ant-ui/
├── src/
│   ├── components/          # React components
│   │   ├── Header.tsx       # Top navigation with Run Code button
│   │   ├── ProjectList.tsx  # Project selection sidebar
│   │   ├── SessionView.tsx  # Session details display
│   │   ├── TaskQueue.tsx    # Task list with status
│   │   └── TerminalOutput.tsx # Log output display
│   ├── lib/                 # Core utilities
│   │   ├── cli.ts           # CLI execution utilities
│   │   ├── projects.ts      # Project discovery and management
│   │   ├── session.ts       # Session file loading and watching
│   │   └── store.ts         # Zustand state management
│   ├── store/               # Additional stores
│   │   └── useStore.ts      # Log store
│   ├── types/               # TypeScript type definitions
│   │   ├── session.ts       # Session and Task types
│   │   └── node.d.ts        # Node.js type declarations
│   ├── ui/                  # Reusable UI components
│   │   ├── badge.tsx        # Badge component with variants
│   │   ├── button.tsx       # Button component with variants
│   │   ├── card.tsx         # Card component family
│   │   └── index.ts         # UI component exports
│   └── main.tsx             # Application entry point
├── public/                  # Static assets
├── workspace/               # Project workspace (not in repo)
├── dist/                    # Build output (not in repo)
├── index.html               # HTML entry point
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── postcss.config.js        # PostCSS configuration
├── .eslintrc.cjs            # ESLint configuration
├── package.json             # Dependencies and scripts
└── README.md                # This file
```

## 🔧 Development Notes

### File Watching Implementation

The application uses `chokidar` with the following configuration:

```typescript
chokidar.watch(sessionPath, {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50
  }
});
```

**Key Features:**
- `awaitWriteFinish`: Ensures file is completely written before triggering
- `stabilityThreshold`: Waits 100ms after last change before reading
- `pollInterval`: Checks every 50ms for file stability

### State Management

The application uses Zustand for state management with two stores:

1. **Main Store** (`src/lib/store.ts`):
   - Selected project
   - Current session data
   - Running state
   - Log entries

2. **Log Store** (`src/store/useStore.ts`):
   - Terminal output logs
   - Log type categorization (info, stdout, stderr, error)

### Path Aliases

The project uses TypeScript path aliases for cleaner imports:

```typescript
// Instead of: import { Button } from '../../ui/button'
import { Button } from '@/ui/button';
```

Configured in:
- `tsconfig.json`: `"@/*": ["src/*"]`
- `vite.config.ts`: `alias: { '@': path.resolve(__dirname, './src') }`

### Component Patterns

- **Functional Components**: All components use React function components with hooks
- **TypeScript Props**: All components have typed props interfaces
- **Variant System**: UI components use `class-variance-authority` for variant management
- **Composition**: Card components use composition pattern (Card, CardHeader, CardContent, etc.)

### Error Handling

- File system errors are caught and logged
- Missing session files show appropriate UI messages
- Invalid JSON in session files is handled gracefully
- Process execution errors are captured and displayed in terminal

## 🎨 Styling

The application uses Tailwind CSS with a custom color palette:

- **Primary Colors**: Blue scale (50-900) for primary actions and highlights
- **Semantic Colors**: Success (green), error (red), warning (yellow)
- **Component Variants**: Defined using `class-variance-authority`
- **Responsive Design**: Desktop-first layout (no mobile optimization in MVP)

## 🔍 Troubleshooting

### Session Not Loading

1. Check that `workspace/{projectId}/skeleton/outputs/session.json` exists
2. Verify the JSON file is valid (no syntax errors)
3. Check browser console for file watching errors

### Projects Not Appearing

1. Ensure `workspace/` directory exists in project root
2. Check that project directories contain the required `skeleton/outputs/` structure
3. Verify directory permissions

### File Watcher Not Updating

1. Check that the session.json file is being written completely
2. Verify `awaitWriteFinish` settings in `src/lib/session.ts`
3. Check for file system permission issues

### Build Errors

1. Run `pnpm install` to ensure all dependencies are installed
2. Check that Node.js version is 18 or higher
3. Clear `node_modules` and reinstall if needed: `rm -rf node_modules && pnpm install`

## 📝 License

MIT

## 🤝 Contributing

This is an MVP implementation focused on core file-based monitoring functionality. Future enhancements may include:

- Project creation and management UI
- Session history and analytics
- Task filtering and search
- Export functionality
- Dark mode support
- Mobile responsive layout

For bug reports and feature requests, please open an issue in the repository.