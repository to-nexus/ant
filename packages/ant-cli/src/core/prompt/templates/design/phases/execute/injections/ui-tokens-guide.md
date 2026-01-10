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

#### 3. Exhaustive Extraction
Analyze screenshots systematically to capture ALL instances of:
- Colors (backgrounds, text, borders, accents, states)
- Typography (font families, sizes, weights, line heights)
- Spacing (margins, paddings, gaps - identify the rhythm)
- Visual effects (shadows, radii, borders, opacity levels)

### JSON Structure

```json
{
  "_meta": {
    "lastSection": 4,
    "sectionPattern": "top-level"
  },
  "colors": {
    "bg": {
      "white": "#FFFFFF",
      "dark": "#1A1A1A",
      "lightBlue": "#E8EEF3"
    },
    "primary": {
      "green": "#00D9A3",
      "greenGlow": "#00FFB8"
    },
    "text": {
      "black": "#000000",
      "white": "#FFFFFF",
      "muted": "rgba(255, 255, 255, 0.8)"
    },
    "border": {
      "light": "rgba(0, 0, 0, 0.1)"
    }
  },
  "typography": {
    "family": {
      "primary": "Inter, -apple-system, sans-serif",
      "brand": "Eurostile Extended, Inter, sans-serif"
    },
    "heading": {
      "hero": { "size": "72px", "weight": 700, "lineHeight": 1.1 },
      "xl": { "size": "48px", "weight": 700, "lineHeight": 1.2 },
      "lg": { "size": "36px", "weight": 700, "lineHeight": 1.3 }
    },
    "body": {
      "lg": { "size": "18px", "weight": 400, "lineHeight": 1.6 },
      "md": { "size": "16px", "weight": 400, "lineHeight": 1.6 }
    }
  },
  "spacing": {
    "xs": "4px",
    "sm": "8px",
    "md": "16px",
    "lg": "24px",
    "xl": "32px",
    "2xl": "48px",
    "3xl": "64px"
  },
  "effects": {
    "radius": {
      "sm": "4px",
      "md": "8px",
      "lg": "16px",
      "xl": "24px",
      "full": "9999px"
    },
    "shadow": {
      "sm": "0 1px 2px rgba(0,0,0,0.05)",
      "md": "0 4px 6px -1px rgba(0,0,0,0.1)",
      "lg": "0 10px 15px -3px rgba(0,0,0,0.1)",
      "glow": { "green": "0 0 40px rgba(0,217,163,0.4)" }
    },
    "transition": {
      "fast": "200ms",
      "normal": "300ms",
      "slow": "500ms"
    }
  }
}
```

**Note**: `_meta.lastSection` counts top-level data categories (colors, typography, spacing, effects = 4).

### Output Format

{{#if lastSectionNumber}}
**Continuation chapter**: Append additional categories to existing JSON structure.
Use `<append>` tag to merge new keys into the existing JSON.
{{else}}
**First chapter**: Create complete JSON structure.
Use `<file>` tag to create the initial JSON file.
{{/if}}

### Example Output

**For first chapter (task: ui-tokens or ui-tokens-ch1)**:

```xml
<file path="outputs/design/ui-tokens.json">
{
  "_meta": {
    "lastSection": 1,
    "sectionPattern": "top-level"
  },
  "colors": {
    "bg": { "white": "#FFFFFF", "dark": "#1A1A1A" },
    "primary": { "green": "#00D9A3" },
    "text": { "black": "#000000", "white": "#FFFFFF" }
  }
}
</file>
```

**For continuation chapter (task: ui-tokens-ch2)**:

```xml
<append path="outputs/design/ui-tokens.json">
{
  "_meta": {
    "lastSection": 3
  },
  "typography": {
    "heading": { "hero": { "size": "72px", "weight": 700 } },
    "body": { "md": { "size": "16px", "weight": 400 } }
  },
  "spacing": { "sm": "8px", "md": "16px", "lg": "24px" }
}
</append>
```

**Note**: The system automatically merges new categories into existing JSON.

### Quality Criteria

1. **Complete**: All unique visual values captured
2. **Precise**: Exact values extracted (no approximations)
3. **Semantic**: Keys describe purpose, not appearance
4. **Valid JSON**: Proper JSON syntax (no trailing commas, proper quotes)
5. **Referenceable**: Other documents can cite by dot notation (e.g., `colors.primary.green`)

### Workflow

1. `list_reference_images` → Discover all available screenshots
2. `read_reference_image` → Load key screens with diverse UI elements
3. Extract tokens systematically by category
4. Generate `ui-tokens.json` with comprehensive token structure
