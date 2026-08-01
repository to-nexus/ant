# Agent Workflow Board

## Overview

The Agent Workflow Board is a component that visualizes the agent's execution flow.

## Current State

- The Workflow UI displays node transitions in real time via the **per-jobId Workflow SSE** (`/jobs/:jobId/workflow/stream`).
- To avoid cross-contamination in **multi-project / multi-job environments**, clients MUST **filter by `data.jobId`**.
- Server-side workflow state is currently **memory-based**, so **full recovery of past `nodeHistory` after a page/server refresh is not possible** (running jobs can be re-subscribed via the stream).

## Future Implementation Plans

### 1. LangGraph node visualization
- Visual representation of each node in the agent graph
- Display of edges between nodes
- Visualization of node states (pending, running, completed, error)

### 2. Real-time execution tracking
- Highlight the currently executing node
- Visualize the execution path
- Show per-node execution time

### 3. Interactive node inspection
- Show details when a node is clicked
- Inspect a node's input/output data
- Inspect node execution logs

### 4. State transition visualization
- Track agent state changes
- State transition history
- Display conditional branches

## Tech Stack (planned)

- **React Flow** or **D3.js**: node/graph visualization
- **SSE (Server-Sent Events)**: real-time state updates
- **Framer Motion**: animation effects

## Placement

The Agent Workflow Board is shown in the second region of MainPanel's split layout:
- Displayed alongside the Task Board when the split layout is active
- Independent scroll area
- Same hierarchy level as the Task Board

## Related Components

- `MainPanel`: parent container
- `KanbanBoard`: task management (mutually exclusive — switched via `taskViewMode`)

