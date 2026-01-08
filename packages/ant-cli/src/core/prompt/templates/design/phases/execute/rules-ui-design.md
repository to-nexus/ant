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

- **ui-tokens.md**: Load 2-3 key screenshots with diverse UI elements
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

All UI design documents go to `outputs/design/`:

```xml
<file path="outputs/design/ui-tokens.md">
# ui-tokens.md (Design Tokens)
...
</file>
```

```xml
<file path="outputs/design/ui-assets.md">
# ui-assets.md (Asset Mapping)
...
</file>
```

```xml
<file path="outputs/design/ui-spec.md">
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
<!-- WRONG: Don't use inputs/sources/ -->
<file path="inputs/sources/ui-tokens.md">

<!-- WRONG: No append for UI docs -->
<append path="outputs/design/ui-tokens.md">
```

### ✅ CORRECT

```xml
<file path="outputs/design/ui-tokens.md">
# ui-tokens.md (Design Tokens)

> Color, typography, spacing, and size definitions

## Colors
| token | value | usage |
|---|---|---|
| color.bg.base | #ffffff | Default background |
...
</file>
```

════════════════════════════════════════════════════════════════════════════════
## ⚠️ DOCUMENT DEPENDENCY CHAIN
════════════════════════════════════════════════════════════════════════════════

Documents are generated in order. Previous documents are **automatically injected** as REFERENCE sections.

```
ui-tokens.md (FIRST - no dependencies)
     ↓
ui-assets.md (SECOND - receives ui-tokens.md as REFERENCE)
     ↓
ui-spec.md (LAST - receives both previous documents as REFERENCE)
```

### How to Use the REFERENCE Sections

For dependent tasks, you will find REFERENCE sections in this prompt containing previously generated content:

```
# REFERENCE: ui-tokens.md (generated in previous task)
```

**When generating ui-assets.md:**
- Find and read the `# REFERENCE: ui-tokens.md` section in this prompt
- Use token names when describing asset usage context

**When generating ui-spec.md:**
- Find and read both `# REFERENCE: ui-tokens.md` and `# REFERENCE: ui-assets.md` sections
- ALL visual values must use token references (e.g., `token(color.bg.base)`)
- ALL assets must use identifiers from the asset mapping

════════════════════════════════════════════════════════════════════════════════
## Document Quality Guidelines
════════════════════════════════════════════════════════════════════════════════

### ui-tokens.md
- Use **semantic token names** (purpose-based, not appearance-based)
- Include **exact values** extracted from screenshots
- Organize by category (Colors, Typography, Spacing, Effects)
- Use **tables** for easy reference by other documents

### ui-assets.md
- **Read ui-tokens.md first** to ensure consistency
- Map **source → destination** paths clearly
- Include **usage context** for each asset
- Categorize by type (logos, icons, backgrounds)

### ui-spec.md

**CRITICAL: Specification, Not Implementation**

ui-spec.md documents **WHAT** to build, not **HOW** to build it.

| ✅ INCLUDE | ❌ EXCLUDE |
|-----------|-----------|
| Layout structure | Framework-specific code |
| Component states and props | CSS/styling syntax |
| Interaction behaviors | Implementation details |
| Responsive rules | Raw values (use tokens) |
| Token references | Programming language syntax |

**Token Reference Requirement:**
- ALL colors → `token(color.*)` from ui-tokens.md
- ALL spacing → `token(spacing.*)` from ui-tokens.md
- ALL typography → `token(font.*)` from ui-tokens.md
- NO raw hex codes, pixel values, or framework classes

════════════════════════════════════════════════════════════════════════════════
## Final Checklist
════════════════════════════════════════════════════════════════════════════════

Before outputting, verify:

- [ ] Using `<file path="inputs/sources/...">` tag
- [ ] Content is in **Markdown table format** where appropriate
- [ ] **Exact values** extracted from screenshots (no approximations)
- [ ] **Semantic naming** conventions followed
- [ ] Document is **complete and self-contained**
