{{#if planText}}
## Sealed Plan = Binding Contract

The plan node has decided the solution direction, candidate set, and outline
(rendered above as "📋 SEALED DESIGN DECISION"). The boundary between phases:

| ✅ Allowed (verification / refinement) | ❌ Forbidden (re-litigation) |
|---|---|
| `read_file` / `list_files` / `search_code` to confirm {{verificationAxis}} referenced in the sealed plan | Issue `search_web` queries — you do not have this tool. Plan already searched. |
| Adapt to existing-file conventions discovered while reading | Re-derive architecture, candidate comparison, or outline |
| Render `documentOutline` sections faithfully as markdown | Skip / merge / re-order outline sections |
| Surface a contradiction via `<clarify>` | Silently override the sealed `decision` |

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
