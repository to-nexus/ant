## ui-tokens.json Generation Guide (Description-driven)

### Purpose
Author the design tokens for this project as a JSON structure for programmatic consumption, derived from the directive and PRD (no screenshots, no Figma).

### Source-of-truth Priorities
**When to reference PRD / directive**:
- **Brand identity**: Brand colors, typography, logos called out in the PRD or directive
- **Accessibility requirements**: Contrast ratios, minimum font sizes, motion sensitivity
- **Platform constraints**: Mobile-first, responsive breakpoints, dark / light mode
- **Theming requirements**: Themes, color schemes, variants implied by the project intent
- **visualTier**: When `visualTier.{visualLanguage,surfaceSystem,spatialSystem}` is provided, anchor token decisions on that tier and document any overrides

**Principles**:
- **Directive-first**: Honour explicit values in the directive verbatim
- **PRD as context**: Use PRD to understand intent behind token choices
- **No invention beyond intent**: Do not introduce token categories the project does not need; clearly mark inferred defaults

### Core Principles

#### 1. Single Source of Truth
- Every visual value used in the design should be captured as a token
- Subsequent documents (ui-assets.json, ui-spec.json) MUST reference these tokens
- No visual value should be "invented" later — capture everything now

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

#### 3. Exhaustive Coverage (WITHIN YOUR SCOPE)
For the categories specified in YOUR task description, document the full set the project needs.

**⚠️ DO NOT extract categories outside your task scope — other tasks will handle them.**

### ⚠️ CRITICAL: SCOPE ENFORCEMENT

**🚨 READ YOUR TASK DESCRIPTION AND GENERATE ONLY THOSE CATEGORIES! 🚨**

1. **Check your task description** — it specifies exactly which categories to generate
2. **Generate ONLY those categories** — not more, not less
3. **Other tasks handle other categories** — trust the task decomposition

### JSON Structure

**Available categories** (generate only what YOUR task specifies):
- `colors` — color palette, backgrounds, gradients, overlays
- `typography` — font families, sizes, weights, line heights
- `spacing` — margins, paddings, gaps
- `effects` — radius, shadows, blur, transitions

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
**Parallel chapter** — use `<append>` to add YOUR categories:

```xml
<append path="outputs/design/ui/ant/ui-tokens.json">
{
  "YOUR_CATEGORY": { /* tokens derived from directive / PRD / visualTier */ }
}
</append>
```
{{else}}
**First task** — use `<file>` to create the document:

```xml
<file path="outputs/design/ui/ant/ui-tokens.json">
{
  "YOUR_CATEGORY": { /* tokens derived from directive / PRD / visualTier */ }
}
</file>
```
{{/if}}

**Note**: Replace `YOUR_CATEGORY` with the actual category from your task description (e.g., `colors`, `typography`, `spacing`, `effects`). The system automatically merges new categories into existing JSON.

### Quality Criteria

1. **Complete**: All categories needed by the project are captured
2. **Precise**: Exact values, no approximations or placeholders
3. **Semantic**: Keys describe purpose, not appearance
4. **Valid JSON**: Proper JSON syntax (no trailing commas, proper quotes)
5. **Referenceable**: Other documents can cite by dot notation (e.g., `colors.primary.green`)
6. **Overlay transparency**: Overlays/gradients on top of dynamic content must use rgba (not opaque hex)

### Workflow

1. (Optional) `read_file` on PRD if you need to refresh the requirements
2. (Optional) `list_assets` to understand asset categories that will exist
3. Author tokens systematically by category, anchored on directive + visualTier
4. Generate `ui-tokens.json` with the categories specified in your task
