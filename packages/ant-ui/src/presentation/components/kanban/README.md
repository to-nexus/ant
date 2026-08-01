# Kanban Board Components

Refactored Kanban Board component structure

## 📁 File Structure

```
kanban/
├── KanbanBoard.tsx         # Main orchestrator (SSE, state management)
├── KanbanHeader.tsx        # Header actions (data source, gauges)
├── KanbanEstimating.tsx    # Estimating state display
├── KanbanColumns.tsx       # 3-column layout (To Do, In Progress, Completed)
├── index.ts               # Export barrel
└── README.md              # This file
```

## 🧩 Component Roles

### KanbanBoard (Main Orchestrator)
- SSE connection management
- Global state management (Zustand)
- Animation state management
- Resume Task logic
- Sub-component composition

### KanbanHeader
- Data Source indicator (Live/Session/Estimating)
- Recursion Limit gauge
- Tasks progress gauge

### KanbanEstimating (KanbanEstimatingSkeleton)
- Shows 3 columns of skeleton cards during the decompose/revise phase
- Used together with NodeActivityBanner

### NodeActivityBanner
- Shows the activity label + live timer of the currently running non-task node
- Auto mount/unmount based on estimatingLabel/estimatingStartedAt

### KanbanColumns
- 3-column layout
- TaskCard rendering
- Framer Motion animation handling
  - Shine effect (completed)
  - Slide animation (in-progress)

## 🔄 Data Flow

```
SSE Stream → KanbanBoard (state) → Sub Components
     ↓
  KanbanData
  {
    todo: UnifiedTask[]
    inProgress: UnifiedTask | null
    completed: UnifiedTask[]
    isEstimating: boolean
    dataSource: 'live' | 'session' | 'estimating'
    recursionCount: number
    recursionLimit: number
    pausedDueToLimit: boolean
    tasksRemaining: number
  }
```

## 🎨 Animations

- **Completed**: Slide from right + Shine effect
- **In Progress**: Slide from left (delayed)
- **Layout**: Smooth card repositioning (Framer Motion)

## 🔌 Reusable Base Component

**BoardContainer** (`../BoardContainer.tsx`)
- Reusable for the Kanban Board, Workflow, etc.
- Consistent Card styling
- Header actions support

## 📦 Usage Example

```tsx
import { KanbanBoard } from '@/components/kanban';

function App() {
  return <KanbanBoard />;
}
```

## 🚀 Future Extensions

A **WorkflowBoard** can be implemented with the same pattern:
```
workflow/
├── WorkflowBoard.tsx
├── WorkflowHeader.tsx
├── WorkflowNodes.tsx
└── WorkflowEdges.tsx
```

All built on `BoardContainer` as the base.

