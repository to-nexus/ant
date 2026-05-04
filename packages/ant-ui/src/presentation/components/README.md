# ANT UI Components Architecture

## 📐 Layout Structure

### Vertical Split (Default - 상하 분할)
**기본 레이아웃**: 항상 2개의 보드를 상하로 표시
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

### Horizontal Split (좌우 분할)
**토글 옵션**: 2개의 보드를 좌우로 표시
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
- **Note**: GNB는 일반 Bar가 아닌 독립적인 네비게이션 바입니다
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
  <SplitLayout
    direction="vertical"
    first={<KanbanBoard />}
    second={<AgentWorkflowBoard />}
  />
</MainPanel>
```

### MainPanelBar
**Status bar at top of MainPanel**

- Location: Top of MainPanel (like VS Code status bar)
- Displays:
  - Current context (project, feature, mode, task ID)
  - **Layout toggle buttons** (horizontal/vertical split)
- Features:
  - **Vertical (상하) button**: Top/bottom split (default)
  - **Horizontal (좌우) button**: Left/right split
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

### SplitLayout
**Resizable split pane layout**

- Supports horizontal (left/right) or vertical (top/bottom) split
- Draggable resizer with visual feedback
- Minimum size constraints (default: 50px - compact header only)
- Independent scrolling for each panel
- Customizable initial ratio (default: 0.5)

```tsx
<SplitLayout
  direction="vertical"
  initialRatio={0.5}
  minSize={50}
  first={<KanbanBoard />}
  second={<AgentWorkflowBoard />}
/>
```

---

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
├── GlobalNavBar.tsx          # Top navigation bar (독립적)
├── Bar.tsx                   # Base component for all bars ⭐
├── MainPanel.tsx             # Central viewport (supports split)
├── MainPanelBar.tsx          # Status bar + layout toggles
├── TerminalBar.tsx           # Terminal output bar
├── SplitLayout.tsx           # Resizable split pane ⭐
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
특정 영역의 상단 또는 하단에 위치하며 제목, 액션, 상태 정보를 표시하는 영역입니다.

#### Base Component
- **Bar**: 모든 bar의 공통 base component (높이, 패딩, 텍스트 스타일 통일)

#### Application Bars
- **GlobalNavBar**: 앱 최상위 네비게이션 바 (독립적, Bar를 사용하지 않음)
- **ExplorerBar**: Explorer 상단 바 (Bar 사용)
- **MainPanelBar**: MainPanel 상단의 상태 표시 바 (Bar 사용)
- **TerminalBar**: MainPanel 하단의 터미널 출력 바 (Bar 사용)

#### 설계 원칙
- 모든 일반 Bar는 `Bar` base component를 사용하여 **일관된 높이와 스타일** 유지
- GlobalNavBar는 앱 수준의 특수한 네비게이션이므로 독립적으로 설계

이는 IDE에서 일반적으로 사용되는 용어입니다:
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
   - 일관된 높이 (`h-10`)
   - 일관된 패딩 (`px-4`)
   - 일관된 텍스트 크기 (`text-sm`)
2. **MainPanel** = Always split layout
   - **No single board view** (항상 2개 보드 표시)
   - Default: Vertical (상하) split
   - Toggle: Horizontal (좌우) split
   - Resizable panels (drag divider)
3. **SplitLayout** = IDE-style split pane
   - Draggable resizer with visual feedback
   - Independent scrolling per panel
   - Minimum size constraints (50px - compact header only)
   - 1:1 default ratio (adjustable)
4. **BoardContainer** = Minimal wrapper (no padding/borders, compact header)
5. **Board equality** = KanbanBoard와 AgentWorkflowBoard는 동일한 위계
6. **Feature folders** = Self-contained board implementations (kanban/, workflow/)
7. **Composition** = Mix and match components

## 📖 Related Documentation

- `/components/kanban/README.md` - Kanban Board details
- `/components/workflow/README.md` - Agent Workflow Board details
- `/components/BoardContainer.tsx` - Base container API
- `/components/SplitLayout.tsx` - Split pane implementation
- `/lib/design-system.ts` - Theme colors and semantic colors
- `/lib/store.ts` - Global state management (includes splitLayout state)
