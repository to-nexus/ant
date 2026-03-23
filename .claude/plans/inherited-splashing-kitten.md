# Fix: Worker Subgraph Missing `plan` Edge for Verification Re-verify

## Context

Commit `2d4e538a` (feat: re-run full verification after codeGen applies fixes) added a new routing path: when a verification task's execute node produces `done=true`, `routeAfterExecute` returns `'plan'` instead of `'checkTaskStatus'`, so the plan node re-runs a fresh build/test/devServer diagnostic.

This `plan` destination was added to the **main graph's** execute edge map (`graph.ts:1252`), but was **NOT added to the worker subgraph's** execute edge map (`workerGraph.ts:430-434`). Since parallel mode (ANT_TASK_CONCURRENCY > 1) runs tasks through the worker subgraph, any verification task that completes hits `return 'plan'` in the router, and LangGraph throws "Branch condition returned unknown or null destination" because `this.ends['plan']` is undefined.

## Root Cause

**File:** `packages/ant-cli/src/agents/architect/graph/code/parallel/workerGraph.ts` lines 426-435

```typescript
// Execute → Router (tool / checkTaskStatus / execute)  ← missing plan!
graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    {
      tool: 'tool',
      checkTaskStatus: 'checkTaskStatus',
      execute: 'execute',
      // plan: 'plan',  ← MISSING
    } as any,
);
```

The main graph (`graph.ts:1248-1254`) has `plan: "plan"` but the worker subgraph doesn't.

## Fix

### 1. Add `plan` to worker subgraph execute edge map

**File:** `packages/ant-cli/src/agents/architect/graph/code/parallel/workerGraph.ts`

Add `plan: 'plan'` to the execute conditional edges (line ~433):

```typescript
graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    {
      tool: 'tool',
      checkTaskStatus: 'checkTaskStatus',
      execute: 'execute',
      plan: 'plan',   // verification task execute done → plan re-verify
    } as any,
);
```

### 2. Add `_awaitingFinalVerify` channel to worker subgraph (safety)

The `_awaitingFinalVerify` flag is set by the router via `(state as any)._awaitingFinalVerify = true` and read by plan node. It should be in the worker subgraph's channel definition for reliable state propagation:

```typescript
_awaitingFinalVerify: null as any,
```

Add this after `_batchSplitRequeued` in the channels definition (~line 404).

### 3. Update comment on line 426

Change comment from `// Execute → Router (tool / checkTaskStatus / execute)` to `// Execute → Router (tool / checkTaskStatus / execute / plan)`.

## Verification

1. `cd packages/ant-cli && pnpm test` - ensure existing tests pass
2. Run a code job with verification task in parallel mode (ANT_TASK_CONCURRENCY=3) and confirm the Final Verification task completes successfully instead of failing with "Branch condition returned unknown or null destination"
