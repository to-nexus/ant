## ui-tokens.json Generation Guide

### Purpose
Extract and document all design tokens from Figma variables and design context as a JSON structure for programmatic consumption.

### PRD Integration
**When to reference PRD**:
- **Brand identity**: Extract brand colors, typography, logos from PRD if specified
- **Accessibility requirements**: Confirm contrast ratios, minimum font sizes
- **Platform constraints**: Check if PRD specifies mobile-first, responsive breakpoints, dark mode
- **Theming requirements**: Identify if PRD mentions themes, color schemes, variants

**Principles**:
- **Data-first**: Extract what Figma variables and design context provide
- **PRD as context**: Use PRD to understand intent behind design choices
- **No invention**: Do not create tokens not present in Figma data, even if PRD suggests them

### Core Principles

#### 1. Single Source of Truth
- Every visual value used in the design should be captured as a token
- Subsequent documents (ui-assets.json, ui-spec.json) MUST reference these tokens
- No visual value should be "invented" later - capture everything now

#### 2. Semantic Naming
- Names should describe **purpose**, not **appearance**
- Use nested JSON structure for organization
- Names should be technology-agnostic

#### ⚠️ Utility Class Name Collision

CSS utility frameworks generate class names by adding a category prefix to token keys. If a token key already contains that prefix, the resulting class name will have a double prefix.

**Principle**: Token keys represent the part AFTER the framework's utility prefix. The key itself must not duplicate the prefix the framework will add.

**Example**: A framework that generates font-size classes with prefix `text-`:
- ❌ Key `text-medium-xs` → class `text-text-medium-xs` (double prefix, broken)
- ✅ Key `medium-xs` → class `text-medium-xs` (correct)

This applies to any category where the framework adds a prefix (font-size, background-color, border-color, etc.).

#### 3. Exhaustive Extraction (WITHIN YOUR SCOPE)
For the categories specified in YOUR task description, capture ALL instances visible in screenshots.

**⚠️ DO NOT extract categories outside your task scope - other tasks will handle them.**

### ⚠️ CRITICAL: SCOPE ENFORCEMENT

**🚨 READ YOUR TASK DESCRIPTION AND GENERATE ONLY THOSE CATEGORIES! 🚨**

1. **Check your task description** - it specifies exactly which categories to generate
2. **Generate ONLY those categories** - not more, not less
3. **Other tasks handle other categories** - trust the task decomposition

### JSON Structure

**Available categories** (generate only what YOUR task specifies):
- `colors` - color palette, backgrounds, gradients, overlays
- `typography` - font families, sizes, weights, line heights
- `spacing` - margins, paddings, gaps
- `effects` - radius, shadows, blur, transitions

### Mode Support

If Figma variable definitions include mode data (e.g. light/dark themes):
Preserve the mode structure as-is from Figma variables.

**Constraint**: Do NOT invent mode values. Only document modes present in `figma_get_variable_defs` output.

```json
{
  // Include ONLY categories specified in YOUR task description
}
```

### Output Format

{{#if forceAppend}}
**Parallel chapter**: Use `<append>` tag to merge your categories into the shared JSON.
The system serializes concurrent writes via mutex and deep-merges automatically.
{{else}}
**First chapter**: Create complete JSON structure.
Use `<file>` tag to create the initial JSON file.
{{/if}}

### Example Output

{{#if forceAppend}}
**Parallel chapter** - use `<append>` to add YOUR categories:

```xml
<append path="outputs/design/ui/ant/ui-tokens.json">
{
  "YOUR_CATEGORY": { /* tokens extracted from Figma */ }
}
</append>
```
{{else}}
**First task** - use `<file>` to create the document:

```xml
<file path="outputs/design/ui/ant/ui-tokens.json">
{
  "YOUR_CATEGORY": { /* tokens extracted from Figma */ }
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

1. Review nodeSummary in Available Resources → Understand page/frame structure
2. `figma_get_variable_defs` → Extract Figma variables as token candidates
3. `figma_get_design_context` → Inspect specific nodes for additional token values
4. Generate `ui-tokens.json` with comprehensive token structure
