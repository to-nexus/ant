# Token Usage Tracking

Three scales of token accounting live side-by-side in Ant. This document defines which is canonical for what, and which helper publishes each to the frontend. The invariant is *one* broadcast SSOT per scale — if two code paths publish the same snapshot, the system will drift.

## Three units of measurement

| Scale | Field on state | Purpose | UI surface |
|---|---|---|---|
| **Job-level** | `state.tokenUsage: TokenUsage` | Cumulative across every LLM call in the job. Survives task boundaries. | Chat-input sidebar "total tokens" badge |
| **Task-level** | `state._currentTaskTokenUsage: TokenUsage` | Cumulative within the currently-running task. Reset per task. | Per-task card token counts in the Kanban view |
| **Node-phase snapshot** | `state.currentPhaseTokenUsage: PhaseTokenUsage` | Latest single LLM-call snapshot for the currently-running graph node. Overwritten — *not* accumulated. | Chat-input **context gauge** ((input+output) / `phase.contextWindow`) |

`PhaseTokenUsage` is defined in `@ant/shared/src/task.ts`. The gauge's denominator is per-model: `MODEL_CONTEXT_WINDOWS` SSOT (Opus 4.8 / Sonnet 4.6 = 1_000_000, Haiku 4.5 = 200_000) is resolved via `getModelContextWindow(modelId)` and stamped onto `PhaseTokenUsage.contextWindow`. `DEFAULT_FALLBACK_CONTEXT_WINDOW = 1_000_000` is the first-frame placeholder before any snapshot arrives.

## Why "overwrite, not accumulate" for the node-phase snapshot

Every LLM call sends the full prompt (system + history + current message). `inputTokens` returned by the provider therefore already reflects the current context fullness. Accumulating across calls inside the same node would count the same history repeatedly and inflate the gauge to a meaningless number. The gauge answers "how full is the context window on the most recent call?" — a question only answerable by *replacing* the snapshot each call.

## SSOT pipelines

```
                    ┌─────────────────────────────────────────────────┐
                    │  Graph wiring: `withPhaseTracking(phaseId, fn)`│
                    │  → seeds `state.currentPhaseTokenUsage`        │
                    │  → label via `resolveNodePhaseLabel(id, loc)`  │
                    └────────────────────────┬────────────────────────┘
                                             │ node invoked
                                             ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Node body performs LLM call(s)                │
                    │  → each call ends in `accumulateTokenUsage()` │
                    │    • job-level    +=                          │
                    │    • task-level   +=                          │
                    │    • node-phase   =  (overwrite)              │
                    │    • Redis publish via                        │
                    │      `deps.kanbanUpdate                       │
                    │        .updateCurrentPhaseTokenUsage()`       │
                    └─────────────────────────────────────────────────┘
```

## Responsibility split per helper

| Helper | Responsibility | Broadcast? |
|---|---|---|
| `withPhaseTracking(phaseId, node)` (`llmHelpers.ts`) | Graph-wiring wrapper. Seeds the phase snapshot with `beginNodePhase(...)` *before* the node executes. SSOT for phase-id → label mapping via `resolveNodePhaseLabel`. | ❌ Seed only. Broadcast happens on first LLM call inside the node. |
| `resolveNodePhaseLabel(phaseId, locale)` (`timing/estimatingLabels.ts`) | SSOT for localized phase labels used by both the estimating banner and the gauge tooltip. | — |
| `beginNodePhase(state, phase, label)` (`llmHelpers.ts`) | Low-level primitive that resets `state.currentPhaseTokenUsage`. **Only two authorized callers**: `withPhaseTracking` and `applyEstimatingUsage`. Node implementations MUST NOT invoke it. | ❌ |
| `accumulateTokenUsage(state, usage, opts)` (`llmHelpers.ts`) | Updates all three scales atomically after every LLM response. **The single authorized publisher** of `updateCurrentPhaseTokenUsage`. | ✅ gauge |
| `updateKanbanTokenUsage(state)` (`llmHelpers.ts`) | Syncs the active task card and the Kanban job-level badge. | ✅ task/job (not gauge) |
| `applyEstimatingUsage(state, nodeId, usage)` (`llmHelpers.ts`) | Estimating-phase bookkeeping when an external subgraph returns a usage snapshot. Calls `accumulateTokenUsage` (which handles the gauge broadcast). Seeds the estimating banner via `setEstimatingActivity`. | ✅ job-level badge only (gauge via accumulate) |
| `KanbanBroadcaster.updateCurrentPhaseTokenUsage(snapshot)` (`core/realtime/KanbanBroadcaster.ts`) | Caches the snapshot and publishes a `KanbanData` payload over Redis Pub/Sub. Only caller permitted is `accumulateTokenUsage`. | ✅ publish |

## Graph state wiring

`currentPhaseTokenUsage` is declared once in `agents/common/graph/annotationHelpers.ts` (`ResolvableFields`). Every graph state inherits it via the common chain (`ResolvableFields → TriageableFields → DetectableFields`). This means:

- No `state as any` casts are needed at the call sites.
- LangGraph treats the field as a first-class channel, so the snapshot persists across node boundaries via the default last-write-wins reducer (consistent with the "overwrite per call" semantics).
- Workers (`CodeGraphChannels`, `DesignGraphChannels`) spread the same block, so parallel worker subgraphs participate uniformly.

## Frontend persistence (gauge behaviour during idle)

The Redux slice at `packages/ant-ui/src/domain/store/slices/sse/kanbanReducer.ts` preserves the last `currentPhaseTokenUsage` value when the next SSE update omits the field (e.g. job idle, task boundary). This gives the gauge a "most recent meaningful reading" semantic instead of blanking out between LLM calls. The frontend component `presentation/components/chat/TurnTokenGauge.tsx` renders `(input + output) / phase.contextWindow` (where `contextWindow` is the model-specific denominator stamped by `getModelContextWindow`) and shows a tooltip with the split.

## Enforcement (keep the SSOTs honest)

Run these from the repo root; each should match zero lines (modulo the file signatures noted).

```bash
# (1) beginNodePhase must not be called from nodes.
# Only llmHelpers.ts (definition + withPhaseTracking + applyEstimatingUsage)
# is allowed.
rg "beginNodePhase\(" packages/ant-cli/src/agents \
  --glob '!**/common/graph/llmHelpers.ts' \
  --glob '!**/common/graph/timing/**'
# Expected: 0 matches.

# (2) Exactly one explicit caller of updateCurrentPhaseTokenUsage: accumulate.
rg "updateCurrentPhaseTokenUsage\?\.\(" packages/ant-cli/src
# Expected: 1 line — llmHelpers.ts inside accumulateTokenUsage.

# (3) No direct state casts to reach the phase snapshot.
rg "state as any.*currentPhaseTokenUsage" packages/ant-cli/src
# Expected: 0 matches.

# (4) Context window constant is a single source.
rg "CONTEXT_WINDOW_MAX_TOKENS" packages/
# Expected: definition in ant-shared/src/task.ts, consumers elsewhere.
```

## Adding a new LLM-calling node

1. Implement the node normally — it already has `state.currentPhaseTokenUsage` typed on its state via the common annotation chain.
2. Wrap at wiring time:
   ```ts
   import { withPhaseTracking } from '../../common/graph/llmHelpers';
   graph.addNode('my-node', withPhaseTracking('my-node', myNode) as any);
   ```
3. If the `phaseId` needs a localized label, add it to `LABELS` in `estimatingLabels.ts`. Unknown ids fall back to the phaseId itself.
4. Inside the node, call `accumulateTokenUsage(state, usage)` after every LLM response. That is the only action required for the gauge to update.

## Anti-patterns (do not do this)

- Calling `beginNodePhase` inside a node body. Wrap at wiring.
- Calling `deps.kanbanUpdate.updateCurrentPhaseTokenUsage` from anywhere other than `accumulateTokenUsage`. The gauge will double-publish.
- Reading `state.tokenUsage?.inputTokens` to derive the gauge value. That field is job-cumulative and answers a different question.
- Hard-coding a phase label in the node (`beginNodePhase(state, 'plan', 'Plan')`). The label SSOT is `resolveNodePhaseLabel`.
