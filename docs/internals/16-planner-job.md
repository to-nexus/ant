# Planner Job

## Overview

The Planner Job is the planner agent's LangGraph graph that takes a user directive and generates or revises documents (PRD, etc.). Unlike the Code/Design Jobs, there is no task decomposition — it runs as a single ReAct loop (generate ↔ tool). It supports multi-turn conversation and clarifying questions.

## Differences from the Architect Job

| Aspect | Architect (Code/Design) | Planner |
|------|------------------------|---------|
| Task decomposition | Yes | No |
| Parallel execution | Yes | No |
| Output | Multiple files | Single file |
| Multi-turn conversation | Not supported | Supported (session-based) |
| Clarifying questions | Not supported | Supported (`<clarify>` tag) |
| Resume strategy | Per-task | Per-job (full re-run) |

## Target Resolution

The Planner Job's output target is determined by `resolvedAction.target`. There is no hardcoded `prd.md` path.

### Explicit (Actions panel)

The UI sets `actionMetadata.target`. Resolve does not infer it.

| Pattern | When target is set | Example |
|------|-----------------|------|
| `mirrorRefs` (rev-plan) | When refs are selected | `['plan/api-spec.md']` |
| `dir + expectedFiles` (gen-plan) | When the intent is selected | `['plan/prd.md']` |

rev-plan allows single selection only via `refsSingleSelect: true`.

In Explicit mode, a missing target (excluding codebase/emptyHint) is treated as a system error. No inference fallback.

### Infer (chat)

Resolve infers the target using `workspaceState.sourceFileNames`.

| Condition | targets |
|------|---------|
| `prd.md` exists | `['plan/prd.md']` |
| No `prd.md`, other files exist | All source files (LLM clarify) |
| No files | `['plan/prd.md']` (gen-plan default) |

## Modes

| Mode | Condition | Behavior |
|------|------|------|
| `generate` | No existing target document, or explicit gen-plan | Outputs the whole document directly into `plan/` via a `<file path="{targetPath}">` tag |
| `refine` | Existing target document + LLM detects revision intent | Targeted editing via the `edit_file(path="{targetPath}")` tool |
| `explain` | Existing document + LLM detects analysis/query intent | Read-only chat response |

## Document Content Injection

There is no `existingDocument` state field. Document content is loaded into `resolvedAction.documents` using the same pattern as the architect, and rendered by the `action-context.md` partial.

| Role | Source | Render location | Meaning (3-axis model) |
|------|------|-------------|----------------|
| `ref` | `actionMetadata.refs` | `action-context.md` — `## Provided Documents` / `### [ref] ...` | Original (source of truth), wins on conflict |
| `context` | `actionMetadata.context` | `action-context.md` — `## Provided Documents` / `### [context] ...` | Additional input of equal authority, subordinate only when conflicting with `ref` |

For the 3-axis meaning of role, see the SSOT at [jobs/shared/injections/role-guide.md](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/role-guide.md) — Authority (which input to follow), Edit-scope (which file to write), Task-scope (how broad the plan goes).

## Graph Node Flow

```
__start__ -> resolve -> triage -> [router]
    +-> ask -> __end__
    +-> redirect -> __end__
    +-> blocked -> __end__
    +-> proceed -> generate

generate -> [router]
    +-> tool_use -> tool -> generate (ReAct loop)
    +-> <clarify> detected -> emit ChoiceCard -> __end__
    +-> <file> detected -> save directly to plan/ -> __end__
    +-> text only -> save conversation -> __end__
```

## Clarifying Questions

When information is insufficient during PRD generation/revision, the LLM emits questions via the `<clarify>` tag.

### Processing flow

1. During LLM streaming, `XMLStreamParser` suppresses the `<clarify>` tag
2. The generate node extracts questions via `parseClarifyBlocks()`
3. A Compound Clarifying ChoiceCard is emitted
4. The conversation is saved to the session, then the job ends

## Tools

| Tool | Generate | Refine | Explain |
|------|----------|--------|---------|
| `read_workspace_file` | O | O | O |
| `list_workspace_files` | O | O | O |
| `search_web` (Tavily) | O | O | O |
| `edit_file` | X | O | X |

## File Structure

```
agents/planner/
    index.ts
    graph/
        tools.ts
        plan/
            graph.ts            (buildPlanGraph)
            runner.ts           (runPlanGraph)
            state.ts            (PlanGraphState — no existingDocument)
            nodes/
                resolve.ts      (target resolution, documents loading)
                generate.ts     (ReAct loop, saves directly to the target path)
                tool.ts         (tool execution)
```

## State Persistence

| Timing | Persisted content |
|------|----------|
| generate complete | conversation, conversationHistory, directive, mode, tokenUsage |
| tool complete | conversationHistory, tokenUsage |
| SIGTERM | Latest state from stateSnapshot + interruption |

## Prompt Structure

`planner/plan/base.md` + `planner/plan/rules.md`. It does not go through the PromptEngine 6-stage pipeline; `generate.ts` renders Handlebars directly.

- `base.md`: directive, mode, staging path, eval report, conversation context, `{{> common/injections/action-context}}`
- `rules.md`: output protocol (direct target path reference), clarify rules, per-mode behavior

## Boundaries

- Common agent patterns: [11-agent-architecture.md](11-agent-architecture.md)
- Tool system (tool catalog, registry, orchestrator): [19-tool-system.md](19-tool-system.md)
- Triage classification: [12-triage-routing.md](12-triage-routing.md)
- Chat/ChoiceCard UI: [31-chat-system.md](31-chat-system.md)
- Action Config Matrix: [01-shared-contracts.md](01-shared-contracts.md)
- Document constraint map (system design/spec/PRD): [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
