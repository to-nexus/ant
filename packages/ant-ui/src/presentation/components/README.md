# ANT UI Components Architecture

## 📐 Layout Structure

### Vertical Split (Default - top/bottom split)
**Default layout**: always shows the two boards stacked top/bottom
```
┌─────────────────────────────────────────────────────────┐
│                   GlobalNavBar                          │
├──────────┬─────────────────────────┬────────────────────┤
│          │  ┌──────────────────┐   │                    │
│ Explorer │  │  MainPanelBar    │   │ Config/File Editor │
│          │  ├──────────────────┤   │   (optional)       │
│          │  │  KanbanBoard     │   │                    │
│          │  │  (scroll)        │   │                    │
│          │  ├─── resizer ──────┤   │                    │
│          │  │ WorkflowBoard    │   │                    │
│          │  │  (scroll)        │   │                    │
│          │  ├──────────────────┤   │                    │
│          │  │  TerminalBar     │   │                    │
│          │  └──────────────────┘   │                    │
└──────────┴─────────────────────────┴────────────────────┘
```

### Horizontal Split (left/right split)
**Toggle option**: shows the two boards side by side
```
┌─────────────────────────────────────────────────────────┐
│                   GlobalNavBar                          │
├──────────┬─────────────────────────┬────────────────────┤
│          │  ┌──────────────────┐   │                    │
│ Explorer │  │  MainPanelBar    │   │ Config/File Editor │
│          │  ├─────────┬────────┤   │   (optional)       │
│          │  │ Kanban  │Workflw │   │                    │
│          │  │ Board   │Board   │   │                    │
│          │  │(scroll) │(scroll)│   │                    │
│          │  ├─────────┴────────┤   │                    │
│          │  │  TerminalBar     │   │                    │
│          │  └──────────────────┘   │                    │
└──────────┴─────────────────────────┴────────────────────┘
```

## 🎯 Core Components

### Bar (Base Component)
**Base component for all bar-style headers**

- Provides consistent styling across all bars
- Fixed height: `h-10`
- Consistent padding: `px-4`
- Consistent text size: `text-sm`
- Consistent background/border colors
- Left/right content areas

```tsx
<Bar
  left={<span>Title</span>}
  right={<button>Action</button>}
/>
```

**Used by:**
- `ExplorerBar` (top of Explorer)
- `MainPanelBar` (top of MainPanel)
- `TerminalBar` (header section)

---

### GlobalNavBar
**Top-level navigation bar**

- Location: Fixed at top of screen
- **Note**: the GNB is an independent navigation bar, not a regular Bar
- Responsibilities:
  - App branding (Ant)
  - Theme toggle (light/dark mode)
  - Connection status
  - Agent/Task selection
  - Run/Stop buttons
- Always visible across all views

```tsx
<GlobalNavBar 
  onRunTask={handleRunTask}
  onStopTask={handleStopTask}
  isRunning={isRunning}
/>
```

### MainPanel
**Primary viewport for board-style visualizations**

- Location: Center column between Explorer and side panels
- **Always displays split layout** (no single board mode)
- Responsibilities:
  - Display status bar at top (MainPanelBar)
  - Display split board content (Kanban + Workflow)
  - Manage independent scrolling per board
  - Contain terminal bar at bottom (TerminalBar)
- **Default**: Vertical split (top/bottom)
- **Options**: Toggle to horizontal split (left/right)

```tsx
<MainPanel
  headerBar={<MainPanelBar />}
  footer={<TerminalBar />}
>
  {/* Kanban and Workflow are mutually exclusive — pick one based on
      `taskViewMode` from the ui slice. */}
  {taskViewMode === 'workflow' ? <AgentWorkflowBoard /> : <KanbanBoard />}
</MainPanel>
```

### MainPanelBar
**Status bar at top of MainPanel**

- Location: Top of MainPanel (like VS Code status bar)
- Displays:
  - Current context (project, feature, mode, task ID)
  - **Layout toggle buttons** (horizontal/vertical split)
- Features:
  - **Vertical button**: Top/bottom split (default)
  - **Horizontal button**: Left/right split
  - Click to switch between layouts (always split, no single view)
- Similar to IDE status bars

```tsx
<MainPanelBar />
```

### TerminalBar
**Expandable terminal output bar**

- Location: Bottom of MainPanel
- Features:
  - Collapsible/expandable output
  - Resizable height
  - Auto-scroll to latest logs
  - Log type indicators (INFO, OUT, ERR, ERROR)
  - Clear logs functionality

```tsx
<TerminalBar />
```

### BoardContainer
**Minimal base wrapper for board-style components**

**Design Philosophy:**
- No wrapper padding or card borders (efficient space usage)
- Compact sticky header (matches gauge height ~36px)
- Screen split background serves as the container
- Maximum content area for visualization

**Features:**
- Compact header: `px-4 py-2`, `text-sm` title
- Scrollable content with minimal padding
- Dark mode support
- Used by KanbanBoard, AgentWorkflowBoard

```tsx
<BoardContainer 
  title="📋 Task Board"
  headerActions={<KanbanHeader />}
>
  {children}
</BoardContainer>
```

---

### AgentWorkflowBoard
**Agent workflow visualization board (Placeholder)**

- Displays agent execution flow
- Real-time node states and transitions
- Interactive node inspection (future)
- Uses BoardContainer for consistent styling

```tsx
<AgentWorkflowBoard />
```

## 📂 Component Organization

```
components/
├── GlobalNavBar.tsx          # Top navigation bar (standalone)
├── Bar.tsx                   # Base component for all bars ⭐
├── MainPanel.tsx             # Central viewport
├── MainPanelBar.tsx          # Status bar + view-mode toggles
├── TerminalBar.tsx           # Terminal output bar
├── BoardContainer.tsx        # Base board wrapper
├── kanban/                   # Kanban Board (Task management)
│   ├── KanbanBoard.tsx
│   ├── KanbanHeader.tsx
│   ├── KanbanColumns.tsx
│   └── ...
├── workflow/                 # Workflow Board (Agent visualization)
│   ├── AgentWorkflowBoard.tsx
│   └── README.md
└── ...
```

## 🏷️ Terminology

### "Bar" Components
A region positioned at the top or bottom of a specific area that displays a title, actions, and status information.

#### Base Component
- **Bar**: the common base component for all bars (unified height, padding, and text styling)

#### Application Bars
- **GlobalNavBar**: the app's top-level navigation bar (standalone, does not use Bar)
- **ExplorerBar**: bar at the top of the Explorer (uses Bar)
- **MainPanelBar**: status bar at the top of MainPanel (uses Bar)
- **TerminalBar**: terminal output bar at the bottom of MainPanel (uses Bar)

#### Design Principles
- All regular Bars use the `Bar` base component to maintain a **consistent height and style**
- GlobalNavBar is app-level, special-purpose navigation, so it is designed independently

This follows terminology commonly used in IDEs:
- VS Code: Activity Bar, Status Bar, Side Bar
- IntelliJ: Navigation Bar, Status Bar, Tool Window Bar

## 🔮 Future Extensions

### WorkflowBoard (planned)
```tsx
<MainPanel 
  headerBar={<MainPanelBar />}
  footer={<TerminalBar />}
>
  <BoardContainer 
    title="🔄 Workflow"
    headerActions={<WorkflowHeader />}
  >
    <WorkflowNodes />
    <WorkflowEdges />
  </BoardContainer>
</MainPanel>
```

### Dashboard (planned)
```tsx
<MainPanel 
  headerBar={<MainPanelBar />}
  footer={<TerminalBar />}
>
  <BoardContainer title="📊 Dashboard">
    <MetricsGrid />
    <ChartViews />
  </BoardContainer>
</MainPanel>
```

## 🎨 Design Principles

1. **Bar base component** = Single source of truth for all bar styling
   - Consistent height (`h-10`)
   - Consistent padding (`px-4`)
   - Consistent text size (`text-sm`)
2. **MainPanel** = Single active view
   - Kanban and Workflow are **mutually exclusive** — driven by `taskViewMode`
   - When in Kanban: `splitLayout` decides column arrangement (horizontal = stacked, vertical = grid-cols-3)
   - When in Workflow: graph is fixed LR (left → right), split toggle is hidden
3. **BoardContainer** = Minimal wrapper (no padding/borders, compact header)
4. **Board equality** = KanbanBoard and AgentWorkflowBoard sit at the same hierarchy level
5. **Feature folders** = Self-contained board implementations (kanban/, workflow/)
6. **Composition** = Mix and match components

## 📖 Related Documentation

- `/components/kanban/README.md` - Kanban Board details
- `/components/workflow/README.md` - Agent Workflow Board details
- `/components/BoardContainer.tsx` - Base container API
- `/lib/design-system.ts` - Theme colors and semantic colors
- `/lib/store.ts` - Global state management (includes `splitLayout` + `taskViewMode`)
