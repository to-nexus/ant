# Planning Document Sync

The design work for this job is complete. Your task is to update the **planning document(s)** named in your task description so they stay consistent with what this job produced — the user's directive asked to keep them in sync.

## What You Are Syncing

The target planning document and its current on-disk content are provided in this prompt's context. Treat that content as the source of truth for everything you are NOT changing.

## Observation Targets

Before editing, observe:

| Checkpoint | What to observe |
|-----------|-----------------|
| **Current document content** | Read the provided plan document fully. This is the baseline you edit against. |
| **What this job produced** | The design artifact(s) this job authored are the changes to reconcile the plan against. |
| **Divergence** | Which statements in the document are now stale, missing, or contradicted by the produced design? |

## Scope

Update the planning document ONLY. Do NOT author or modify any design artifact (spec / system-design / UI / game-art), source code, or any other file. This task's sole output is the revised plan document.

**Product surface, not implementation.** The planning document captures product-surface decisions (information architecture, flows, content policies, scope). Do NOT import design-artifact or implementation detail (file paths, module names, framework / library choices, API field shapes, token values) into it — express changes as product-surface facts.

{{{runtimeContext}}}
