## ui-tokens.json Generation Guide

### Purpose
Extract and document all design tokens from reference screenshots as a JSON structure for programmatic consumption.

### PRD Integration
**When to reference PRD**:
- **Brand identity**: Extract brand colors, typography, logos from PRD if specified
- **Accessibility requirements**: Confirm contrast ratios, minimum font sizes
- **Platform constraints**: Check if PRD specifies mobile-first, responsive breakpoints, dark mode
- **Theming requirements**: Identify if PRD mentions themes, color schemes, variants

**Principles**:
- **Visual-first**: Extract what you SEE in screenshots
- **PRD as context**: Use PRD to understand intent behind visual choices
- **No invention**: Do not create tokens not visible in screenshots, even if PRD suggests them

### Core Principles

#### 1. Single Source of Truth
- Every visual value used in the design should be captured as a token
- Subsequent documents (ui-assets.json, ui-spec.json) MUST reference these tokens
- No visual value should be "invented" later - capture everything now

#### 2. Semantic Naming
- Names should describe **purpose**, not **appearance**
- Use nested JSON structure for organization
- Names should be technology-agnostic

#### 3. Exhaustive Extraction (WITHIN YOUR SCOPE)
For the categories specified in YOUR task description, capture ALL instances visible in screenshots.

**⚠️ DO NOT extract categories outside your task scope - other tasks will handle them.**

### ⚠️ CRITICAL: SCOPE ENFORCEMENT

**🚨 READ YOUR TASK DESCRIPTION AND GENERATE ONLY THOSE CATEGORIES! 🚨**

1. **Check your task description** - it specifies exactly which categories to generate
2. **Generate ONLY those categories** - not more, not less
3. **Other tasks handle other categories** - trust the task decomposition
4. **Update `_meta.lastSection`** - increment by the number of categories YOU added

### JSON Structure

**Available categories** (generate only what YOUR task specifies):
- `colors` - color palette, backgrounds, gradients, overlays
- `typography` - font families, sizes, weights, line heights
- `spacing` - margins, paddings, gaps
- `effects` - radius, shadows, blur, transitions

```json
{
  "_meta": {
    "lastSection": N,
    "sectionPattern": "top-level"
  },
  // Include ONLY categories specified in YOUR task description
}
```

**Note**: `_meta.lastSection` = cumulative count of top-level data categories in the document.

### Output Format

{{#if lastSectionNumber}}
**Continuation chapter**: Append additional categories to existing JSON structure.
Use `<append>` tag to merge new keys into the existing JSON.
{{else}}
**First chapter**: Create complete JSON structure.
Use `<file>` tag to create the initial JSON file.
{{/if}}

### Example Output

{{#if lastSectionNumber}}
**Continuation task** - use `<append>` to add YOUR categories:

```xml
<append path="outputs/design/ui-tokens.json">
{
  "_meta": { "lastSection": {{add lastSectionNumber 1}} },
  "YOUR_CATEGORY": { /* tokens extracted from screenshots */ }
}
</append>
```
{{else}}
**First task** - use `<file>` to create the document:

```xml
<file path="outputs/design/ui-tokens.json">
{
  "_meta": { "lastSection": 1, "sectionPattern": "top-level" },
  "YOUR_CATEGORY": { /* tokens extracted from screenshots */ }
}
</file>
```
{{/if}}

**Note**: Replace `YOUR_CATEGORY` with the actual category from your task description (e.g., `colors`, `typography`, `spacing`, `effects`). The system automatically merges new categories into existing JSON.

### Quality Criteria

1. **Complete**: All unique visual values captured
2. **Precise**: Exact values extracted (no approximations)
3. **Semantic**: Keys describe purpose, not appearance
4. **Valid JSON**: Proper JSON syntax (no trailing commas, proper quotes)
5. **Referenceable**: Other documents can cite by dot notation (e.g., `colors.primary.green`)
6. **Overlay transparency**: Overlays/gradients over background images must use rgba (not opaque hex)

### Workflow

1. `list_reference_images` → Discover all available screenshots
2. `read_reference_image` → Load key images with diverse UI elements
3. Extract tokens systematically by category
4. Generate `ui-tokens.json` with comprehensive token structure
