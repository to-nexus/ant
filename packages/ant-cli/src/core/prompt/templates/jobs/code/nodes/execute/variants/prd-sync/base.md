# Planning Document Sync

The code work for this job is complete. Your task is to update the **planning document(s)** named in your task description so they stay consistent with what was actually built — the user's directive asked to keep them in sync.

{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/prior-completed-files}}

## What You Are Syncing

The target planning document(s) and their current on-disk content are provided in this prompt's context. Treat that content as the source of truth for everything you are NOT changing.

## Observation Targets

Before editing, observe:

| Checkpoint | What to observe |
|-----------|-----------------|
| **Current document content** | Read the provided plan document(s) fully. This is the baseline you edit against. |
| **What actually changed** | The completed files above show the changes this job made. Reconcile the document against them. |
| **Divergence** | Which statements in the document are now stale, missing, or contradicted by the built behaviour? |

## Scope

Update the planning document(s) ONLY. Do NOT modify application source code, tests, or any file under `codebase/`. This task's sole output is the revised plan document(s).

**Product surface, not implementation.** The planning document captures product-surface decisions (information architecture, flows, content policies, scope). Do NOT import implementation detail (file paths, module names, framework / library / storage choices, exact timeout / retry numbers) from the code — express changes as product-surface facts.

{{{runtimeContext}}}
