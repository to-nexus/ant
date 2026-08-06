# Output Tag Matrix — SSOT for LLM Response Tag Handling

## Overview

The handling policy for every canonical `<tag>` an LLM emits is fixed by a 4-axis MECE matrix. This document is the single source of truth (SSOT) — every registered tag maps to exactly 1 cell, and the code-side [`OutputTagRegistry`](../../packages/ant-cli/src/core/streaming/OutputTagRegistry.ts) encodes this table 1:1.

**Core principles**:
- When adding a new tag, touch exactly two places: (a) add a row to this matrix, (b) add an entry to `OutputTagRegistry`.
- No new scattered parsers (`extractPlanText`-style). Use only the registry's `extract` hook.
- Chat rendering / stream parsing / persistence / disk writes are separate responsibilities — they only read the registry's hooks.

## 4-Axis MECE Classification

A tag's semantics map to exactly 1 cell across 4 orthogonal axes. Two tags in the same cell means a semantic conflict — registration is rejected.

### Axis A · Intent (what the LLM is expressing)

| Value | Meaning |
|---|---|
| `artifact` | A deliverable headed for disk or sealed state |
| `narrative` | An answer/summary/suggestion responding to the user directive |
| `control` | Graph flow control (work-blocking or completion signal) |
| `decision` | A one-shot classification decision used for downstream routing |
| `metadata` | Side information going only to UI cards / internal state |

### Axis B · Processing (handling in the stream pipe)

| Value | Meaning |
|---|---|
| `stream-action` | [`XMLStreamParser`](../../packages/ant-cli/src/core/streaming/parsers/XMLStreamParser.ts) branches it into an action mid-stream |
| `consumed-formatted` | [`SpecialTagTransformer`](../../packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts) converts it to chat text, then consumes it |
| `consumed-suppressed` | SpecialTagTransformer silently consumes it (zero UI surface) |
| `post-stream` | After the stream ends, a dedicated extractor cuts the body out into state |

### Axis C · Persistence (persistence surface)

| Value | Meaning |
|---|---|
| `disk-file` | The filesystem (`FileRenderer` / `FileRegistry`) |
| `sealed-state` | A LangGraph state.* channel |
| `chat-line` | A line in `chat.jsonl` (`type` + `kind` combination) |
| `kanban` | The task queue UI |
| `card-only` | A live card (progressive, like placeholder, plan_generating) — no `chat.jsonl` persistence |
| `none` | Zero persistence (silent state mutation only) |

### Axis D · Blocking (effect on graph flow)

| Value | Meaning |
|---|---|
| `blocking` | Halts node progress and waits for user input |
| `terminal` | Signals completion of the current task |
| `non-blocking` | Runs alongside ongoing work |

## The Matrix (All Registered Tags)

| Tag | A · Intent | B · Processing | C · Persistence | D · Blocking | Emitting nodes (representative) |
|---|---|---|---|---|---|
| `<plan>` | artifact | stream-action + post-stream | sealed-state + card-only | non-blocking | plan |
| `<reply>` | narrative | consumed-formatted (`kind=directive_reply`) | chat-line | non-blocking | execute / execute / direct / generate / ask |
| `<done>` | control | consumed-formatted | chat-line (terminal notice) | terminal | execute / execute / direct |
| `<clarify>` | control | post-stream + card-only | chat-line + card | blocking | execute / generate |
| `<executionTier>` | decision | consumed-formatted + post-stream | sealed-state + chat-line | non-blocking | decompose |
| `<domain>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<gameArtTier>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<techTier>` | decision | consumed-suppressed + post-stream | sealed-state | non-blocking | detect / decompose |
| `<tasks>` | metadata | stream-action (`task_added`) | kanban | non-blocking | decompose |
| `<references>` | metadata | consumed-formatted | chat-line | non-blocking | decompose / learn |
| `<detect>` | metadata | consumed-formatted | chat-line | non-blocking | detect / decompose-final |
| `<learn_command>` | metadata | consumed-formatted | chat-line | non-blocking | learn |
| `<thinking>` | metadata | stream-action (`thinking`) | chat-line (`assistant_thinking`) | non-blocking | every LLM node |
| `<boundary>` | metadata | consumed-suppressed | sealed-state | non-blocking | inside detect |
| `<directHints>` | metadata | consumed-suppressed | sealed-state | non-blocking | inside detect |
| `<specClarify>` | metadata | consumed-suppressed | sealed-state | non-blocking | inside detect |
| `<triage>` | metadata | stream-action (wrapper) | sealed-state | non-blocking | triage |
| `<direct>` | metadata | post-stream + consumed-suppressed | sealed-state | non-blocking | visual direct |
| `<eval>` | metadata | consumed-suppressed | sealed-state | non-blocking | ask (end of evaluation report) |

**Free text outside tags** has no registered cell. `XMLStreamParser` handles it via the unhandled-text-policy:
- Phase 1 (current): persisted as `chat-line` with `kind=legacy` (observation)
- Phase 2 (target): silent drop or demotion to thinking

## File Mutation Is Tool-Call-Only

**Invariant**: file creation / extension / modification / deletion is carried EXCLUSIVELY by the tool channel (`create_file` / `append_file` / `edit_file` / `delete_file`). The historical `<file>` / `<append>` streaming tags (and the never-implemented `<edit>` / `<delete>` entries) were retired in the tool-protocol cutover — a file body placed in text output is not saved. Live rendering rides `tool_use_delta` argument fragments (`ToolFileStreamer` → the same `card_output` surface `FileRenderer` used to drive).

## Text-Channel Discipline

**Invariant**: in the TEXT channel there is no "outside any tag" lane — free text between tags is discarded. If narrative is needed, write it inside `<reply>` from the start. The two-channel contract (tools = actions, tags = signals) is injected always-on into every LLM node by the [`output-tag-policy.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/output-tag-policy.md) partial.

## Cross-Axis Nesting Prohibition

**Invariant**: tags of a different intent axis cannot be nested.

- No narrative / control / decision / metadata inside artifact
- No artifact / control / decision / metadata inside narrative
- Likewise for control / decision / metadata

Only same-axis nesting is explicitly allowed by the registry — currently the sole case: `<tasks>` ⊃ `<task>`.

When `XMLStreamParser` encounters cross-axis nesting, it treats the inner content as literal text within the outer tag's body (silent linearization instead of parse failure) + a dev-mode console.warn (a prompt-drift signal).

## Code SSOT — Policy in 1 Place, N Consumers

This matrix is encoded 1:1 in the single file `OutputTagRegistry.ts`. Consumers only read the hooks.

| Responsibility | Location | Relationship to the registry |
|---|---|---|
| Tag registration (name/pattern/4 axes/contract/extract/transform/chatLineKind) | `OutputTagRegistry.ts` | **SSOT** |
| Chat rendering routing | `SpecialTagTransformer.ts` | registry walk → calls `transform` |
| Stream parsing (incremental) | `XMLStreamParser.ts` | reads the stream-action enum and the unhandled-text-policy from the registry |
| Chat persistence (SSE / Redis / chat.jsonl) | `LLMResponseService.ts` / `ChatService` | reads `chatLineKind` from the registry |
| Disk writes | tool handlers (`createFile.ts` / `appendFile.ts` / `editFile.ts`) | tool channel — not registry-driven; live cards via `ToolFileStreamer.ts` |
| LangGraph state mutation | Each node | uses the result of calling the registry's `extract` |

**No scattered functions**: do not create a new post-stream extractor in a separate file. Put it inside the registry entry's `extract` hook.

## Per-Emitting-Node Contracts

Each emitting node's prompt rules depend on the `output-tag-policy.md` partial, and variants carry **node-specific reinforcement only** (SBS principle — specific only along the gate axis).

| Node | Available tags (representative) | Variant reinforcement contract |
|---|---|---|
| design plan | `<plan>` `<thinking>` | "`<plan>` is sealed JSON. The plan node terminates immediately after `</plan>` — no trailing narrative. Approach strategy is expressed in the subsequent execute's `<reply>`." |
| design execute (spec) | `<reply>` `<done>` `<clarify>` `<thinking>` + write tools | "Spec bodies are written via create_file / append_file. Decision summary in a single `<reply>`." |
| design execute (system / ui-design / game-art-design) | Same as above | Only per-variant body format reinforcement |
| code execute | `<reply>` `<done>` `<thinking>` + write tools | Per-task-type reinforcement |
| code direct | `<reply>` `<done>` `<thinking>` (Tier 0/1) | "A Tier 0 answer is a single `<reply>`." |
| code decompose | `<tasks>` `<task>` `<executionTier>` `<techTier>` `<boundary>` `<directHints>` `<thinking>` | decompose-specific |
| code detect | `<detect>` `<domain>` `<gameArtTier>` `<techTier>` | detect-specific |
| design detect | `<detect>` `<domain>` `<gameArtTier>` `<techTier>` `<specClarify>` | detect-specific |
| design decompose | `<tasks>` `<task>` `<executionTier>` `<techTier>` | decompose-specific |
| planner generate | `<reply>` `<clarify>` `<done>` `<thinking>` + write tools | explain mode uses `<reply>` only |
| ask / inline-ask | `<reply>` `<eval>` `<done>` `<thinking>` | "Answers go inside `<reply>`. `<eval type=\"...\" />` at the end of an evaluation report." |
| triage | `<triage>` `<thinking>` | — |
| learn | `<learn_command>` `<references>` | — |
| visual direct | `<direct>` `<thinking>` | — |

## Addition/Change Procedure

1. **Add a row to this matrix** — decide the 4 axes (verify it occupies only one cell).
2. **Add an entry to `OutputTagRegistry`** — `name` / `pattern` / `axis` / `transform?` / `extract?` / `chatLineKind?` / `promptContract`.
3. **Pass the regression test** — `tests/output-tag-matrix.test.ts` enforces 1:1 equivalence between the matrix and the registry, zero missing promptContracts, zero axis conflicts.
4. **(If needed) the emitting node's variant rules.md** — node-specific reinforcement only. No restating the universal contract.

**Prohibited patterns**:
- Creating new scattered parser functions (`extractFooTag.ts`-style) — put them inside the registry entry's `extract`.
- Registering the same tag in two modules — the registry is the only place.
- Restating a tag-usage contract in a node prompt — absorb it into the partial.
- Anti-patterns like "pre-tag prose is visible to the user" in `code/nodes/plan/rules.md` — a direct violation of first-token discipline.

## Boundaries

- Prompt system / auto-injection: [`13-prompt-system.md`](13-prompt-system.md)
- Document constraints → prompt matrix: [`36-prompt-document-constraint-map.md`](36-prompt-document-constraint-map.md)
- Chat / SSE system: [`31-chat-system.md`](31-chat-system.md)
- Unified conversation state (CONV_KEYS): [`34-conversations.md`](34-conversations.md)
- Node graph layout: [`NODE_GRAPH_LAYOUT.md`](NODE_GRAPH_LAYOUT.md)
