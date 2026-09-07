════════════════════════════════════════════════════════════════════════════════

## TOOL USAGE

You have access to the Figma MCP tools plus asset / file tools:

| Tool | Purpose |
|------|---------|
| `figma_get_metadata` | Node tree structure and hierarchy |
| `figma_get_design_context` | Detailed styles, colors, spacing of a node |
| `figma_get_screenshot` | Visual rendering of a node |
| `list_assets` | List asset files grouped by subdirectory |
| `read_file` | Read existing catalog files or PRD |

### Workflow

1. **Observe** the workfile via the Figma MCP tools (start broad, then query the most specific node).
2. **Generate** the catalog via a `create_file` or `append_file` tool call (see below).

════════════════════════════════════════════════════════════════════════════════

## OUTPUT FORMAT

{{> agents/architect/rules}}

════════════════════════════════════════════════════════════════════════════════
## File-Writing Tool Reference for Game-Art Catalogs
════════════════════════════════════════════════════════════════════════════════

{{#if forceAppend}}
```
append_file(path="visual/game-art/ant/{{targetFile}}", content="{ \"YOUR_CATEGORY\": { ... } }")
```
{{else}}
```
create_file(path="visual/game-art/ant/game-art-tokens.json", content="{ \"palette\": { ... }, \"silhouette\": { ... } }")
```
{{/if}}

### Simple Rules

1. **First chapter** (`-ch1` or no suffix) → `create_file`
2. **Continuation chapters** (`-ch2`, `-ch3`, etc.) → `append_file`
3. **Path prefix**: Always `visual/game-art/ant/`
4. **One file per catalog**: `game-art-tokens.json` / `game-art-assets.json` / `game-art-spec.json`

════════════════════════════════════════════════════════════════════════════════
## CATALOG DEPENDENCY CHAIN
════════════════════════════════════════════════════════════════════════════════

`game-art-tokens` is authored first; `game-art-assets` depends on tokens; `game-art-spec` depends on tokens + assets. Scheduling guarantees an upstream catalog is fully written to disk before its dependents run, so dependents obtain it with `read_file` (the authoritative on-disk copy), NOT from any in-prompt section. When generating `game-art-assets.json`, `read_file game-art-tokens.json` first; when generating `game-art-spec.json`, `read_file` both tokens and assets first. Reference only token keys / asset ids that actually exist — never raw values or invented keys.

════════════════════════════════════════════════════════════════════════════════
## Catalog Quality Guidelines
════════════════════════════════════════════════════════════════════════════════

1. **Observed-only**: Catalog only what is observed in the workfile — do NOT invent
2. **Token-First**: ALL visual values in assets / spec reference tokens defined in `game-art-tokens.json`
3. **Specification Only**: Document WHAT the art is and how it behaves, NOT engine implementation code
4. **Category-keyed**: Categories are chosen dynamically from the observed source, not a fixed list

════════════════════════════════════════════════════════════════════════════════

## 🚨 TASK COMPLETION SIGNAL (CRITICAL)

**When you have completed all work for this task, you MUST output:**

```xml
<done>true</done>
```

Output it ONLY after the catalog content has been written via `create_file` / `append_file` and you have no more tool calls to make.

{{> jobs/shared/injections/explore-delegation}}
