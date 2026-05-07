# Jobs

A **job** is a single agent run kicked off by an HTTP request. Jobs queue
through BullMQ, dequeue into the worker, spawn a `job-runner` child, and
execute the right LangGraph for the job type.

For the lifecycle internals, see
[internals/10-job-lifecycle.md](../internals/10-job-lifecycle.md).

## Job types

| Job type      | Agent     | Output                                    | Typical entry point                |
|---------------|-----------|-------------------------------------------|------------------------------------|
| `plan`        | planner   | `plan/prd.md`                              | "Plan a TODO app PRD"              |
| `design`      | architect | `architecture/system/*.md`, `architecture/spec/*.md`, `visual/ui/ant/*.json` | "Design the system per the PRD"    |
| `code`        | architect | Files under `codebase/`                   | "Implement the system"             |
| `learn`       | architect | Vector DB index of the codebase           | "Re-index the codebase"            |
| `ask`         | architect | Chat answer (read-only)                    | "Why does X work this way?"        |
| `inline-ask`  | architect | Inline chat answer (faster, narrower)      | Quick clarification                |

The job type is decided by **triage** based on the directive's intent. You
can hint the intent with a prefix:

```
explain: how does the auth flow work?
review:  the cart page
refactor: extract the date helper
```

Most directives don't need hints — triage classifies them correctly.

## Intents

An **intent** narrows the job type. The intent determines:

- Which prompt variants the job uses (e.g. `gen-ui-figma` vs `rev-code`).
- Which artifact slots populate the RAC (refs vs context).
- Which task types are valid in the decomposition.

| Intent group | Examples                                              | Job type   | Status |
|--------------|-------------------------------------------------------|------------|--------|
| `gen-code-*` | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`| `code`     | Stable |
| `rev-code`   | code review                                           | `code`     | Stable |
| `explain-*`  | `explain-code`, `explain-ui`                          | `code`     | Stable |
| `gen-ui-*`   | `gen-ui-figma`, `gen-ui-desc`                         | `design`   | Stable |
| `rev-ui`     | UI review                                             | `design`   | Stable |
| `gen-game-art-*` | `gen-game-art-figma`, `gen-game-art-desc`         | `design`   | In development (game vertical) |
| `gen-plan`   | PRD authoring                                         | `plan`     | Stable |
| `gen-learn`  | re-index codebase                                     | `learn`    | Stable |
| `ask`        | open Q&A                                              | `ask`      | Stable |

The full intent registry lives in
[`packages/ant-shared/src/action-config-matrix.ts`](../../packages/ant-shared/src/action-config-matrix.ts).
Each intent declares its slot layout, role assignments (ref/context), and
domain gate (`service`, `game`, both).

> The `gen-game-art-*` intents and the `game` domain gate are wired but
> the **game vertical is in development**. Service-domain workflows are
> the supported path today; game-domain end-to-end paths are still being
> validated.

## The shared phase chain

Every architect-driven job runs through the same backbone:

```
resolve → triage → detect → decompose → plan → execute → checkTaskStatus → learn
                                          ↑          │
                                          └──────────┘
                                          (per-task loop)
```

- `resolve` and `triage` are job-agnostic.
- `detect` builds the Resolved Action Context (RAC) — the explicit set of
  artifacts the job is allowed to read.
- `decompose` produces the task queue.
- `plan` and `execute` run per task.
- `checkTaskStatus` decides retry / next task / termination.
- `learn` persists the session and optionally indexes outputs.

Tier 0/1 jobs short-circuit to a `direct` node that bypasses
plan/execute (no decomposition needed for one-shot answers). See
[execution-tiers](execution-tiers.md).

## Resume

Every job is resumable. State is checkpointed to
`workspaces/<project>/<feature>/sessions/<agent>/<jobType>.json` after each
phase. When you re-enter a feature with an in-progress job, Ant:

1. Loads the session.
2. Routes through `resolve` to the right phase based on `_nextPlanEntry`
   and friends.
3. Continues without re-running the upstream phases.

Workers also tolerate process restarts: BullMQ stalls and re-queues.

## Tasks

A `code` or `design` job at Tier 3+ decomposes into multiple **tasks**.
Tasks have a discriminated `type` (one of `feature`, `error`,
`verification`, `ui`, `design-system`, `test-code`, `doc`, `setup`,
`explain`) which determines:

- Which prompt overlays apply per phase.
- Which scheduling band the task lands in (foundation / integration /
  generic).
- Whether self-verification fires at apply-done time.

The task model is canonical SSOT in `@ant/shared/task.ts`; the deep rules
on type / band / priority axes live in
[AGENTS.md § Three-Axis Task Modeling](../../AGENTS.md#three-axis-task-modeling--type--band--priority).

## Read next

- [**execution-tiers**](execution-tiers.md) — when each job type uses
  which decomposition strategy.
- [**workspace**](workspace.md) — where all the artifacts land.
- [internals/14-code-job.md](../internals/14-code-job.md) and
  [internals/15-design-job.md](../internals/15-design-job.md) — full job
  walkthroughs with channel schemas.
