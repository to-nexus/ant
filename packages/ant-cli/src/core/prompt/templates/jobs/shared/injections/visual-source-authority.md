## Visual Source Authority

### Source selection (hard-exclusive)

A code job consumes exactly one `UiSource` at a time. Which source is active is determined by the RAC slot selection and surfaced in the prompt as the `uiSource` variable:

| `uiSource` | Primary visual source | How it is read |
|------------|----------------------|----------------|
| `ant`      | `outputs/design/ui/ant/{ui-tokens, ui-assets, ui-spec}.json` | Direct JSON read (schema-based) |
| `figma`    | Figma workfile (URL only in `figma.json`) | MCP tools at execute time |
| `handoff`  | `outputs/design/ui/handoff/**` files | Observation of the bundle |
| *(none)*   | VisualTier policy or framework defaults | See fallback rules |

The three sources NEVER coexist — RAC resolution rejects mixed selections. The prompts therefore receive exactly one interpretation partial via `ui-source-dispatch`.

### Authority rules (per source)

- **ant** — JSON contents are authoritative. `ui-spec` wins over `system-design` for layout, `ui-tokens` wins for design values, `ui-assets` wins for source→destination mappings.
- **figma** — The MCP response is authoritative. `figma.json` itself is only a workfile pointer; do not infer tokens or layout from it. Use `figma_get_variable_defs` for tokens when present, `figma_get_design_context` for layout, `figma_get_screenshot` for visual verification.
- **handoff** — Observable content is authoritative; schema is never assumed. Pick the most explicit representation per property; ignore conflicting evidence from the same bundle.

### Cross-source rules (always apply)

- **PRD / system-design** wins for component behaviour and responsibility (WHAT it does); the active UI source wins for HOW it looks.
- **If a visual detail is not specified by the active source** — apply VisualTier policy if available, otherwise framework best practices and WCAG 2.1 AA accessibility defaults.

### Fallback hierarchy when no UI source is selected

1. VisualTier policy (if `visualTierActive`)
2. Framework best practices for the active stack
3. Nothing else — do NOT invent values.

### Constraints

- **If not observed in the active source, do NOT add.** Do not invent visual properties.
- **Each container decides layout independently.** Do not assume parent layout affects child alignment.
- **Cross-axis alignment is REQUIRED** — observe actual position, do not default to center.
