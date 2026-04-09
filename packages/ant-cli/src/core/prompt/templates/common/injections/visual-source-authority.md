## Visual Source Authority

### Source Roles

| Source | Role | When Available |
|--------|------|----------------|
| **ui-tokens.json** | Single source of truth for design values (colors, spacing, typography) | Design Job completed |
| **ui-assets.json** | Single source of truth for asset mappings (source → destination) | Design Job completed |
| **ui-spec.json** | Primary reference for layout structure and visual behaviors | Design Job completed |
| **Figma MCP** | Supplementary — verifies and fills gaps the spec did not capture | Figma Desktop connected |

### Authority Rules

When multiple sources describe the same visual property:

1. **ui-spec** is authoritative for layout properties. If ui-spec and system-design conflict on visuals, ui-spec wins.
2. **ui-tokens** is authoritative for design values. If ui-spec references a token, use the token value.
3. **Figma MCP** supplements — it never overrides ui-spec or ui-tokens. Use it only to fill gaps or verify ambiguous details.
4. **PRD / system-design** wins for component behavior and responsibility (WHAT it does). ui-spec wins for HOW it looks.
5. **If a visual detail is not specified by any source** — apply framework best practices and WCAG 2.1 AA accessibility defaults.

### Source Availability Scenarios

| Scenario | UI Docs | Figma MCP | Strategy |
|----------|---------|-----------|----------|
| A | ✅ | ✅ | UI docs are primary. Figma supplements gaps. |
| B | ✅ | ❌ | UI docs only. |
| C | ❌ | ✅ | Figma is primary visual source. Extract tokens via `figma_get_variable_defs`. |
| D | ❌ | ❌ | Plan hints + framework best practices. |

### On-demand Access Paths

UI design documents reside at these paths (relative to feature root):
- `outputs/design/ui/ui-tokens.json` — design tokens
- `outputs/design/ui/ui-assets.json` — asset inventory
- `outputs/design/ui/ui-spec.json` — component specs and layout

Use `read_file` to inspect only the sections relevant to your current task.

### Constraints

- **If not observed in any source, do NOT add.** Do not invent visual properties.
- **Each container decides layout independently.** Do not assume parent layout affects child alignment.
- **Cross-axis alignment is REQUIRED** — observe actual position, do not default to center.
