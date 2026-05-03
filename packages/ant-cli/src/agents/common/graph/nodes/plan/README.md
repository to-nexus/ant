# `common/graph/nodes/plan/` — shared plan-LLM helpers

This directory hosts **function-only utility helpers** consumed by both
the code job's plan node and the design job's plan node.

## What lives here

- `runPlanWithTools` — single-round plan-LLM stream driver (XML parser
  + StreamOrchestrator) returning either a sealed `<plan>` text, an
  assistant message with tool calls, or null.
- `runPlanToolLoopPhase` — re-entry orchestrator that decides whether to
  invoke `runRound` or `onOverLimit` based on history length.
- `extractPlanText` — regex-only `<plan>...</plan>` body extractor with
  length gating.
- `PLAN_TOOL_LOOP_MAX` — shared ceiling constant.
- Types: `PlanRoundResult`, `PlanLoopOutcome`, `PlanLLMResponse`,
  `PlanToolCall`, `MinimalPlanState`, `RunPlanWithToolsArgs`,
  `RunPlanToolLoopPhaseArgs`.

## What does NOT live here (by design)

- **No `PlanStrategy<TState, TTask>` interface.** Code (5-stage
  entry/shortcut/RAG/llm/outcome) and design (lean per-doc) plan nodes
  diverge in structure too much for a shared interface to be useful;
  any abstraction surface that fits both becomes too narrow to remove
  duplication elsewhere, while the cost of phantom strategy methods on
  whichever callee fits less well is paid every time the interface is
  read.
- **No `createPlanNode(strategy)` factory.** Same reason. Each job
  retains its own phase-node body that calls these helpers directly.
- **No unified state base type.** Each job's state interface declares
  its own `_activePhase` channel (code's domain is wider —
  plan/execute/apply/verify; design's is narrower — `'plan'` or
  undefined). The shared helpers depend only on the minimal subset
  declared in `MinimalPlanState` (token bookkeeping fields).
- **No prompt template inventory.** Prompt building stays in each job's
  own plan node (code: `code/nodes/plan/llm/prompt.ts`, design:
  `design/nodes/plan/prompt.ts`).
- **No model selection.** Caller passes a pre-resolved `LLMClient`
  (`runPlanWithTools` accepts `llm` directly).
- **No tool-set selection.** Caller passes pre-collected `ToolDefinition[]`.

## Why "plan/" as the directory name?

Sibling directories (`triage/`, `detect/`, `resolve/`) are
strategy-based reusable phase nodes — they export `createXxxNode(strategy)`
factories and own a phase-node lifecycle.

This directory is **not** that. The name reflects the phase the helpers
relate to (plan), not the architectural pattern (utility function set).
The README disambiguates explicitly so the directory's `index.ts`
shape (re-exports of plain functions) cannot mislead readers expecting
a strategy factory.
