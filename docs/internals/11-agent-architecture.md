# Agent Architecture

## Overview

ANT's agents are implemented as LangGraph StateGraphs. Each agent has a
specialized role and shares common infrastructure (Triage, Broadcaster,
Checkpoint). Parallel task execution is handled by the TaskOrchestrator /
TaskWorker pattern.

## Agent List

| Agent | Role | Job types |
|-------|------|----------|
| planner | PRD authoring/revision | plan |
| architect | Design, implementation, learning, Q&A | design, code, learn, ask, inline-ask |
| creator | Creative asset production (visual, audible, animation, etc.) | visual (audible etc. planned) |
| reviewer | Code review (planned) | review |
| doc | Document generation (planned) | doc |

### Relationships between agents

The planner's output (`plan/prd.md`) becomes the architect's input. The creator
operates independently, producing project assets with reference to the PRD or
directive. The visual job is currently implemented; audible/animation and others
are planned. The workflow proceeds in the order planner -> architect -> reviewer.

## Directory Conventions

### Placement principle

> **If used by 2+ sub-graphs, place it at the agent root; if used by only 1
> sub-graph, place it inside that graph.**

### Canonical structure

```
agents/<agent>/
  index.ts              # Entry point
  types/                # Agent-level types (shared by 2+ sub-graphs)
    index.ts
    [domain].ts         # Per-domain types (e.g. task.ts)
  [memory/]             # Vector memory (optional, when used by 2+ sub-graphs)
  graph/
    <jobType>/
      graph.ts          # StateGraph definition
      runner.ts         # Graph runner
      state.ts          # State + Annotation
      nodes/            # Graph nodes
      [session/]        # Graph-specific (single-graph only)
      [utils/]          # Graph-specific (single-graph only)
      [parallel/]       # Parallel execution
      [routers/]        # Routing logic
      [config/]         # Configuration

agents/common/
  graph/                # Graph nodes/helpers shared by all agents
  tool/                 # Tool system shared by all agents
```

Directories marked with `[]` are created only when needed.

### Placement decision table

| Condition | Location | Example |
|------|------|------|
| Imported by 2+ sub-graphs | `<agent>/` root | `memory/`, `types/task.ts` |
| Imported by only 1 sub-graph | Inside `graph/<jobType>/` | `graph/code/session/`, `graph/code/utils/` |
| Shared by all agents | `common/` | triage, tool handlers |

### Forbidden patterns

- Coexistence of `<agent>/types.ts` (file) and `<agent>/types/` (directory) — unify into `types/index.ts`
- Placing single-graph-only code at the agent root (violates the reference-scope principle)

## LangGraph Patterns

### StateGraph structure

Every agent graph follows this pattern:

1. **State definition**: declare all state fields in channels
2. **Node registration**: each node is a function that takes state and returns partial state
3. **Edge definition**: conditional routing determines transitions between nodes
4. **Runner**: compiles and invokes the graph. Restores resume state, sets the recursion limit

### Common nodes

| Node | Location | Role |
|------|------|------|
| triage | `agents/common/nodes/triage/` | Intent classification, routing |
| detect | `agents/common/nodes/detect/` | RAC creation. Both explicit/infer paths go through the single `resolveToRAC()` funnel |
| resolve | Inside each agent graph | Initial state loading, resume determination |
| learn | Inside each agent graph | Session save, workflow termination |

### Progressive Basis (detect → decompose)

The basis is finalized incrementally across the detect and decompose span:

| Stage | What is finalized | Source |
|------|-----------|------|
| detect | `RAC.basis.techTier` (preset) | UI BasisWizard → `ActionMetadata.basis` (explicit path only) |
| detect | `RAC.basis.visualTier` (preset) | UI BasisWizard → `ActionMetadata.basis.visualTier` |
| decompose | `RAC.basis.techTier` (final) | `mergeTechTierConfigs(preset, inferred)` — preset fields win, empty fields filled by LLM inference |
| decompose | `RAC.basis.visualTier` (final) | `resolveVisualTierFromDecompose(llmResponse, preset)` — runs only for the `gen-code-directive` intent |

The `getTechTier(state)` helper (`@ant/shared`) reads the representative TechTier
from the RAC.

The basis is injected into prompts in the plan/execute nodes via
`PromptBuilder`'s `buildBasisSection()`:
- **techTier**: stack template + language base + framework template (`basis/techTier/stack/*.md`, `jobs/code/basis/techTier/framework/*.md`)
- **visualTier**: per-layer templates for the 6 layers (`basis/visualTier/{layer}/{variant}.md`)

### Broadcaster

State changes during Job execution are propagated in real time via Redis Pub/Sub.

| Broadcaster | Role | Channel |
|-------------|------|------|
| KanbanBroadcaster | Task queue state | `realtime:broadcast:{orgId}:{userId}` |
| WorkflowBroadcaster | Graph node state | `realtime:workflow:{orgId}:{userId}` |
| MessageBroadcaster | Chat messages | `realtime:broadcast:{orgId}:{userId}` |
| FileTreeBroadcaster | File changes | `realtime:broadcast:{orgId}:{userId}` |

## Parallel Task Execution

Activated when `ANT_TASK_CONCURRENCY > 1` (default: 3).

### Components

| Component | Role |
|----------|------|
| TaskOrchestrator | Central coordinator. Task assignment, conflict checks, checkpoints |
| TaskWorker | Independent task executor. Invokes the Worker Subgraph |
| Worker Subgraph | Lightweight version of the main graph. Executes a single task |
| AsyncMutex | Single-process async mutex protecting shared state |

### Task attributes

| Field | Type | Role |
|------|------|------|
| `exclusive` | boolean | If true, runs alone (barrier) |
| `parallelGroup` | string | Tasks in the same group cannot run concurrently |
| `priority` | number | Lower runs first. The window scheme is the `TASK_PRIORITY` SSOT — see [`41-task-priority-band-system.md`](41-task-priority-band-system.md) |
| `packages` | string[] | Packages the task belongs to (for design-document split injection) |

### Assignment algorithm

1. Collect the list of currently running parallelGroups
2. Iterate over the taskQueue:
   - exclusive task -> barrier, stop iterating
   - no parallelGroup -> assign only when running count is 0
   - parallelGroup conflicts with running -> skip
   - no conflict -> assign

### Worker Subgraph Channel Definition (SSOT pattern)

The Worker Subgraph is a lightweight version of the main graph, but LangGraph
**invokes it as a separate StateGraph**, so it needs its own Annotation. Channels
absent from the Annotation are silently DROPPED at `graph.invoke(workerState)`
time.

To prevent missing channels, the main graph exports its channel definition and
the Worker reuses it via spread:

| Job | Channel SSOT | Worker Subgraph | Files |
|-----|-----------|-----------------|------|
| Code | `CodeGraphChannels` | `...CodeGraphChannels` + worker-only | `graph/code/graph.ts` → `graph/code/parallel/workerGraph.ts` |
| Design | `DesignGraphChannels` | `...DesignGraphChannels` + worker-only | `graph/design/graph.ts` → `graph/design/parallel/workerGraph.ts` |

```typescript
// graph.ts — export the channel definition
export const CodeGraphChannels = {
  ...DetectableFields,
  // ... all job-specific fields
} as const;
const MainAnnotation = Annotation.Root(CodeGraphChannels);

// parallel/workerGraph.ts — reuse via spread
import { CodeGraphChannels } from '../graph';
const WorkerAnnotation = Annotation.Root({
  ...CodeGraphChannels,        // inherited automatically from the SSOT
  _taskCompleted: Annotation<any>,  // worker-only
});
```

When adding a new channel, adding it only to `*GraphChannels` automatically
propagates to both the main graph and the Worker.

### Error handling

| Error class | Examples | Retry |
|-----------|------|--------|
| Deterministic | prompt too long, 400, 401, 403 | Fail immediately |
| Transient | timeout, rate limit, 5xx | Retry up to 2 times |

Even when a task fails, other running tasks are allowed to run to completion.
After all tasks finish, if failedTasks exist, the Job is marked `interrupted`
(`canResume: true`).

### Graceful Shutdown

```
handleInterruption(reason)
    1. drain = true, stop periodic checkpoints
    2. call requestStop() on all workers
    3. mark running tasks as interrupted, restore them to the queue
    4. save checkpoint
    5. resolve run() when running task count is 0
```

## Session Structure

### Directory layout

```
sessions/
    architect/
        design.json
        code.json
        learn.json
    planner/
        plan.json
    creator/
        visual.json
    chat.json          (agent-independent, UI level)
```

### Type hierarchy

| Type | Values | Meaning |
|------|---|------|
| `JobType` | code, design, learn, ask, plan, inline-ask, visual | All Job types |
| `DecomposableJobType` | code, design, learn | Jobs with task decomposition |
| `SessionableJobType` | code, design, learn, plan, visual | Jobs that have a session file |

## Boundaries

- Job queue and execution flow: [10-job-lifecycle.md](10-job-lifecycle.md)
- Triage classification: [12-triage-routing.md](12-triage-routing.md)
- Code Job details: [14-code-job.md](14-code-job.md)
- Design Job details: [15-design-job.md](15-design-job.md)
- Planner Job details: [16-planner-job.md](16-planner-job.md)
- Ask system: [17-ask-system.md](17-ask-system.md)
- Visual Job details: [18-visual-job.md](18-visual-job.md)
- Tool system (tool catalog, registry, orchestrator): [19-tool-system.md](19-tool-system.md)
