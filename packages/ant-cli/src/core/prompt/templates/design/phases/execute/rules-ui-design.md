## ⚠️ CRITICAL: ONE TOOL CALL PER TURN

**SYSTEM CONSTRAINT**: The system drops all tool calls after the first one.

### Why This Exists
- System architecture: Only first tool call is executed
- Better UX: Shows step-by-step progress
- Error handling: Can adjust after each result

### ❌ WRONG
```
// All in one turn - ONLY FIRST will execute!
[tool_call: list_reference_images()]
[tool_call: list_assets()]           ← DROPPED
[tool_call: read_reference_image()]  ← DROPPED
```

### ✅ CORRECT
```
Turn 1: list_reference_images() → Wait for result
Turn 2: read_reference_image("screen1.png") → Wait for result
Turn 3: read_reference_image("screen2.png") → Wait for result
Turn 4: Generate document with <file> tag
```

**Rule**: One tool call per turn. No exceptions.

════════════════════════════════════════════════════════════════════════════════

## TOOL USAGE

You have access to tools for exploring reference images and assets:

| Tool | Purpose |
|------|---------|
| `list_reference_images` | Discover available screenshots (screens/, components/) |
| `read_reference_image` | Load specific image for visual analysis |
| `list_assets` | List asset files (logos, icons, backgrounds, fonts) |
| `read_file` | Read existing documents or PRD |

### Workflow

1. **First**: Use `list_reference_images` or `list_assets` to discover available resources
2. **Then**: Use `read_reference_image` to load and analyze specific images (ONE PER TURN)
3. **Finally**: Generate the document using `<file>` XML tag

### Image Loading Strategy

- **tokens.md**: Load 2-3 key screenshots with diverse UI elements
- **ui-assets.md**: Use `list_assets` primarily, images optional for context
- **ui-spec.md**: Load screens systematically (desktop → tablet → mobile)

> ⚠️ **IMPORTANT**: Images are NOT preloaded. You MUST use `read_reference_image` tool to see screenshot content.

════════════════════════════════════════════════════════════════════════════════

## OUTPUT FORMAT

{{> common/rules}}

════════════════════════════════════════════════════════════════════════════════

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference for UI Design Documents
════════════════════════════════════════════════════════════════════════════════

### Output Location

All UI design documents go to `inputs/sources/`:

```xml
<file path="inputs/sources/tokens.md">
# tokens.md (Design Tokens)
...
</file>
```

```xml
<file path="inputs/sources/ui-assets.md">
# ui-assets.md (Asset Mapping)
...
</file>
```

```xml
<file path="inputs/sources/ui-spec.md">
# ui-spec.md (UI Specification)
...
</file>
```

### Simple Rules

1. **Always use `<file>` tag** - UI docs are always created fresh (no append)
2. **Path prefix**: `inputs/sources/`
3. **One file per task** - Each task generates exactly one document

### ❌ DO NOT

```xml
<!-- WRONG: outputs/design/ is for system-design -->
<file path="outputs/design/tokens.md">

<!-- WRONG: No append for UI docs -->
<append path="inputs/sources/tokens.md">
```

### ✅ CORRECT

```xml
<file path="inputs/sources/tokens.md">
# tokens.md (Design Tokens)

> Color, typography, spacing, and size definitions

## Colors
| token | value | usage |
|---|---|---|
| color.bg.base | #ffffff | Default background |
...
</file>
```

════════════════════════════════════════════════════════════════════════════════
## Document Quality Guidelines
════════════════════════════════════════════════════════════════════════════════

### tokens.md
- Use **semantic token names** (color.bg.base, not color.white)
- Include **exact hex values** from screenshots
- Organize by category (Colors, Typography, Spacing, Radius, Shadows)
- Use **tables** for easy scanning

### ui-assets.md
- Map **source → destination** paths clearly
- Include **usage context** for each asset
- Categorize by type (logos, icons, backgrounds)

### ui-spec.md
- Document **layout structure** (grid, flexbox)
- Include **component props and states**
- Describe **interactions** (hover, active, focus)
- Note **responsive breakpoints**

════════════════════════════════════════════════════════════════════════════════
## Final Checklist
════════════════════════════════════════════════════════════════════════════════

Before outputting, verify:

- [ ] Using `<file path="inputs/sources/...">` tag
- [ ] Content is in **Markdown table format** where appropriate
- [ ] **Exact values** extracted from screenshots (no approximations)
- [ ] **Semantic naming** conventions followed
- [ ] Document is **complete and self-contained**
