# Execution tiers

Ant's 5-tier execution model is the key abstraction that decides **how
formal a job should be**. Tier picks decomposition strategy, prompt
overlays, and verification depth.

For the implementation SSOT, see
[`packages/ant-cli/src/core/executionTier/`](../../packages/ant-cli/src/core/executionTier/).
For the binding rules and the full matrix per code job, see
[AGENTS.md § Tier × Verification Matrix](../../AGENTS.md#tier--verification-matrix-code-job).

## The matrix

| Tier | Name           | Writes  | Tasks (decompose) | Verification         | Typical use                                    |
|------|----------------|---------|-------------------|----------------------|------------------------------------------------|
| 0    | Reflex         | ❌      | 0                 | N/A (direct)         | "What does this function do?"                  |
| 1    | OneShot        | ✅      | 0                 | None (direct)        | "Add a comment to this function."              |
| 2    | Exploratory    | ✅      | 1                 | Two-cycle self-verify| "Refactor this small util."                    |
| 3    | Task           | ✅      | ≥2 + verification | Verification task     | "Build a TODO app."                            |
| 4    | RefsGrounded   | ✅      | ≥2 + verification | Verification task     | "Build per the design refs."                    |

The tier is decided in **decompose** based on the LLM's
`<executionTier>N</executionTier>` tag, with retries (max 2) if the LLM
omits the tag or picks Tier 0 for a write-class job.

## What each tier means

### Tier 0 — Reflex

Read-only answers. No filesystem writes are allowed. The agent dispatches
to the `direct` node which bypasses plan/execute entirely.

Examples:
- "Where is the auth middleware?"
- "Summarize what this PR changes."

### Tier 1 — OneShot

Bounded writes that don't need verification. Two-step direct pipeline:
the agent picks a single edit and applies it.

Examples:
- "Add a JSDoc to this function."
- "Rename this constant."

### Tier 2 — Exploratory

A single unit of work that may need to verify itself. The phase order is:

```
plan → execute → <done> → reverify (init Session) → plan' → execute' → check → ...
```

The first cycle applies the change. The second cycle, triggered by the
`<done>` tag, re-enters plan/execute as a verification phase. If the
self-verify finds a violation, it routes through the `_shared/verify/`
infrastructure to gate retries.

Internally the task carries `selfVerifyOnDone: true`. Larger work units
escalate to Tier 3 at runtime via `batchSplit`.

### Tier 3 — Task

Multiple units of work plus an explicit verification task. Decompose
emits ≥2 tasks where one is `type='verification'` with `priority: 1000`
(runs last). The verification task runs all the gates (typecheck, build,
tests) and emits violations.

Failed gates produce remediation `error` tasks, then a new verification
loop. The retry budget is bounded to prevent infinite loops
(`MAX_BATCH_SPLIT_CYCLES = 10`).

### Tier 4 — RefsGrounded

Tier 3 + the work is anchored to authoritative refs (e.g. a system
design and an API contract are present in the RAC). The decompose phase
produces a stricter task graph that respects ref-level invariants.

The runtime behaviour matches Tier 3; the difference is in the prompt
overlays and the discovery-tool whitelist.

## Direct vs decomposed

| Tier | Path                                            |
|------|-------------------------------------------------|
| 0–1  | `direct` node (bypasses plan/execute)           |
| 2    | Two-cycle plan → execute → reverify             |
| 3–4  | Decompose → plan/execute per task → verification|

The `isDirectTier(tier)` predicate (returns true for Tier ≤ 1) is the
canonical gate.

## Why tiers?

Without tiers, you would have to choose between two bad options:

- **Always run the full pipeline.** Every "rename this variable" request
  pays the cost of decompose + plan + execute + verification. Slow and
  expensive.
- **Skip the pipeline entirely.** Every "build a CRUD app" gets dropped
  into a single LLM call that tries to do everything. Fragile and
  unverifiable.

Tiers give the agent a way to choose the right level of formality
based on the request shape, without you having to specify it.

## How tiers affect verification

| Tier | Verification responsibility                     |
|------|-------------------------------------------------|
| 0–1  | None.                                           |
| 2    | The task self-verifies via `_shared/verify/`.   |
| 3–4  | A dedicated `verification` task gates the queue.|

The verification infrastructure is one SSOT under `tasks/_shared/verify/`.
Tier 2 self-verify and Tier 3/4 dedicated verification share the same
plan/execute/check/router/orchestrator/tool stack.

## Domain-aware behaviour

Tiers compose with **domain** (`service` or `game`) and **techTier**
(framework / language). A Tier 4 game job and a Tier 4 service job differ
in:

- Which design-input partials fire (`game-art-source` vs `ui-source-*`).
- Which artifact slots are valid in the RAC.
- Which decomposition rules apply (verification gates, foundation/
  integration bands).

The full domain-tier matrix lives in
[`packages/ant-shared/src/tier-matrix.ts`](../../packages/ant-shared/src/tier-matrix.ts).

## Read next

- [internals/18-session-redesign.md](../internals/18-session-redesign.md)
  — tier strategy matrix and the D11 invariant guard.
- [internals/17-code-verification-task.md](../internals/17-code-verification-task.md)
  — how Tier 2 self-verify and Tier 3/4 dedicated verification share the
  same infrastructure.
- [internals/NODE_GRAPH_LAYOUT.md](../internals/NODE_GRAPH_LAYOUT.md) —
  R1 (phases are task-type blind) and the rest of the layout invariants.
