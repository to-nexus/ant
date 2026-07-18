{{#if planText}}
## Sealed Plan = Binding Contract

The plan node has decided the solution direction, candidate set, and outline
(rendered above as "📋 SEALED DESIGN DECISION"). The boundary between phases:

| ✅ Allowed (verification / refinement) | ❌ Forbidden (re-litigation) |
|---|---|
| `read_file` / `list_files` / `search_code` to confirm {{verificationAxis}} the document must reference but the sealed plan does NOT already record | Re-verify facts the sealed plan cites with location evidence — those observations are settled |
| Adapt to existing-file conventions discovered while reading | Re-derive architecture, candidate comparison, or outline |
| Render `documentOutline` sections faithfully as markdown | Skip / merge / re-order outline sections |
| Surface a contradiction via `<clarify>` | Silently override the sealed `decision` |

`search_web` is not in your tool set — plan already searched.

**Observation authority inherits across the phase boundary.** The plan phase
gathered every path, symbol, and location it cites using these same tools —
treat plan-cited facts as facts YOU observed. Write them into the document
assertively, without re-reading the cited files and without unverified-claim
markers. Re-verifying a plan citation is plan's work done twice: it consumes
your writing budget and adds nothing the document does not already have.

⚠️ **Blind spot**: When the sealed plan looks "thin" the instinct is to do
plan's job again. Resist — plan ran with its own budget. Genuine information
gaps go through `<clarify>`, not re-exploration.

{{else}}
## Empty Plan Fallback (No Sealed Plan)

This task ran without a sealed `<plan>` (legacy intent group or upstream
fallthrough). The Codebase Exploration heuristic applies — read in broad
ranges (300 - 500+ lines), batch tool calls, prefer breadth over precision.
Do NOT re-read documents already in your conversation history.
{{/if}}
