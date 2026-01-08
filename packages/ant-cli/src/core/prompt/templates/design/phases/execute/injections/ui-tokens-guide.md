## ui-tokens.md Generation Guide

### Purpose
Extract and document all design tokens from reference screenshots to establish a single source of truth for visual properties.

### Core Principles

#### 1. Single Source of Truth
- Every visual value used in the design should be captured as a token
- Subsequent documents (ui-assets.md, ui-spec.md) MUST reference these tokens
- No visual value should be "invented" later - capture everything now

#### 2. Semantic Naming
- Names should describe **purpose**, not **appearance**
- Names should be technology-agnostic (no framework-specific conventions)
- Names should follow a consistent hierarchical pattern

#### 3. Exhaustive Extraction
Analyze screenshots systematically to capture ALL instances of:
- Colors (backgrounds, text, borders, accents, states)
- Typography (font families, sizes, weights, line heights)
- Spacing (margins, paddings, gaps - identify the rhythm)
- Visual effects (shadows, radii, borders, opacity levels)

### Token Categories

#### Colors
- **Semantic structure**: `color.[category].[variant]`
- Categories: `bg`, `text`, `border`, `accent`, `state`
- Capture the complete palette, including subtle variations

#### Typography
- **Semantic structure**: `font.[category].[variant]`
- Include: family, size, weight, line-height, letter-spacing
- Group by usage context (heading, body, label, etc.)

#### Spacing
- **Semantic structure**: `spacing.[size]`
- Identify the base unit and multipliers
- Document the spacing rhythm/scale

#### Effects
- **Semantic structure**: `[effect-type].[variant]`
- Shadows, radii, borders, opacity levels
- Document transition/animation timing tokens if visible

### Naming Convention

| Pattern | Meaning |
|---------|---------|
| `color.bg.base` | Base background color |
| `color.text.primary` | Primary text color |
| `font.heading.lg` | Large heading typography |
| `spacing.md` | Medium spacing unit |
| `radius.card` | Card border radius |
| `shadow.elevated` | Elevated element shadow |

### Output Format

Use tables for easy scanning:

| token | value | usage |
|-------|-------|-------|
| (semantic name) | (exact value) | (usage context) |

### Example Structure

```markdown
# ui-tokens.md (Design Tokens)

> Color, typography, spacing, and size definitions

## Colors
| token | value | usage |
|---|---|---|
| color.bg.base | #ffffff | Default background |
| color.bg.dark | #0b0f14 | Dark section background |

## Typography
| token | font | size | weight | usage |
|---|---|---|---|---|
| font.heading.xl | Pretendard | 48px | 700 | Main title |

## Spacing
| token | value | usage |
|---|---|---|
| spacing.xs | 4px | Icon-text gap |
| spacing.sm | 8px | Inline element gap |

## Radius
| token | value | usage |
|---|---|---|
| radius.sm | 4px | Button, input |
| radius.lg | 16px | Card |
```

### Quality Criteria

1. **Complete**: All unique visual values captured
2. **Precise**: Exact values extracted (no approximations)
3. **Semantic**: Names describe purpose, not appearance
4. **Documented**: Each token has clear usage context
5. **Referenceable**: Other documents can cite by token name

### Workflow

1. `list_reference_images` → Discover all available screenshots
2. `read_reference_image` → Load key screens with diverse UI elements
3. Extract tokens systematically by category
4. Generate `ui-tokens.md` with comprehensive token tables
