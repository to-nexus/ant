# Concepts

Conceptual documentation. Read these to understand *why* Ant is built the
way it is — not how to deploy it (that's [guides/](../guides/)) or what
flags exist (that's [reference/](../reference/)).

## Recommended reading order

1. [**spec-driven**](spec-driven.md) — Why Ant rejects vibe coding. The
   manifesto. Read this first.
2. [**architecture**](architecture.md) — The 4-process modular monolith.
   How the pieces talk.
3. [**agents**](agents.md) — Planner, architect, and how LangGraph state
   machines drive each job.
4. [**jobs**](jobs.md) — Plan / Design / Code / Learn / Ask: what each
   produces and when each runs.
5. [**execution-tiers**](execution-tiers.md) — The 5-tier model that
   decides decomposition strategy and verification depth.
6. [**workspace**](workspace.md) — Project / Feature / Workspace data
   layout and what each directory means.

## Background documents

These ship as part of the runtime contract:

- [**design-input-channels**](design-input-channels.md) — Why three design
  sources are first-class, and the FPOP "observe-only" rule that keeps
  Claude handoff working without a schema.

The deeper, regression-grade documents (NodeGraph layout, prompt system,
verification task internals, etc.) live in [internals/](../internals/) and
are intended for contributors.
