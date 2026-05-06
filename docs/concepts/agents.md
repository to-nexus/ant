# Agents

Ant has two production agents and two stubs reserved for upcoming
roles. Every agent runs as a **LangGraph StateGraph** — a typed state
machine with explicit phase nodes, channels, and routers.

For the deep dive on each agent's graph, see
[internals/11-agent-architecture.md](../internals/11-agent-architecture.md).

## Roster

| Agent      | Production | Job types                          | Output                       |
|------------|:----------:|------------------------------------|------------------------------|
| `architect`| ✅          | `code`, `design`, `learn`, `ask`, `inline-ask` | source / design docs / index / chat |
| `planner`  | ✅          | `plan`                              | PRD                          |
| `reviewer` | stub       | `review`                            | (placeholder)                |
| `doc`      | stub       | `doc`                               | (placeholder)                |

## architect

`architect` is the workhorse. It owns code generation, design-doc
generation, RAG indexing, and inline Q&A. The agent has separate sub-graphs
for each job type (`runCodeGraph`, `runDesignGraph`, `runLearnGraph`,
`runInlineAsk`), but they share the **standard graph shape**:

```
       resolve
          │
       triage
       /  │  \
   detect decompose    [job-specific phases]
       \  │  /
         learn
          │
         END
```

The shared phases:

- **resolve** — load state, decide whether this is a fresh entry or a
  resume. Initialise dependencies (memory, file system, prompt builder).
- **triage** — classify intent, gate on workspace state.
- **detect** — build the Resolved Action Context (RAC). Decide what
  artifacts the job needs as `refs` (authoritative) and `context`
  (binding background).
- **decompose** — break the work into tasks; emit `<executionTier>` and
  `<tasks>` tags.
- **plan** + **execute** — per-task plan/exec cycles.
- **checkTaskStatus** — verify retryability, route to next task or
  termination.
- **learn** — persist session, optionally index outputs into the vector DB.

The architect also runs **task-typed hooks** at certain phase boundaries.
The hook system is what keeps phase nodes blind to `task.type` (R1
invariant in [AGENTS.md](../../AGENTS.md)).

## planner

`planner` produces and revises PRDs. It's a smaller graph (resolve →
triage → plan → learn) and emits a single Markdown file (`plan/prd.md`).

Why is the planner separate from the architect? Different role, different
prompt surface, and the planner explicitly declines to write code or
design — its job is to clarify *what* should be built, not *how*.

## How agents share infrastructure

Both production agents:

- Use the **PromptBuilder** as the single entry point for LLM prompts.
  The builder composes 4 declarative tiers (injections, agents,
  domain/job, nodes) into a system + user message pair.
- Use the **DI ports** in `core/ports/` for filesystem, memory, LLM,
  command execution, and git. Adapters live in `periphery/adapters/`.
- Stream tool calls and node lifecycle events through Redis Pub/Sub for
  the realtime UI.

## How agents differ from "agentic frameworks"

A few decisions worth highlighting because they show up across the
codebase:

- **Phases are LangGraph nodes**, not "tools the agent decides to call".
  The orchestration is fixed and explicit; only the *content* of each
  phase varies.
- **Tools are scoped per phase.** Decompose can call `list_files` /
  `read_file`; execute has the full toolset. This avoids tool-call
  thrashing where the agent re-explores the workspace mid-implementation.
- **Verification is a task type, not a hidden gate.** A code job at Tier
  3+ produces an explicit `verification` task that runs gates and emits
  diagnostic violations. Failed gates produce `error` tasks that fix and
  re-verify.
- **State is durable.** Every state field is declared as a LangGraph
  channel. Resuming a job re-uses the channel snapshot.

## Read next

- [**jobs**](jobs.md) — what each job type produces.
- [**execution-tiers**](execution-tiers.md) — Tier 0–4 and the verification
  matrix.
- [internals/14-code-job.md](../internals/14-code-job.md),
  [internals/15-design-job.md](../internals/15-design-job.md),
  [internals/16-planner-job.md](../internals/16-planner-job.md) — full
  graph layouts.
