## ui-tokens.md Generation Guide

### Purpose
Extract and document all design tokens from reference screenshots to establish a single source of truth for visual properties.

### PRD Integration
**When to reference PRD**:
- **Brand identity**: Extract brand colors, typography, logos from PRD if specified
- **Accessibility requirements**: Confirm contrast ratios, minimum font sizes
- **Platform constraints**: Check if PRD specifies mobile-first, responsive breakpoints, dark mode
- **Theming requirements**: Identify if PRD mentions themes, color schemes, variants

**Principles**:
- **Visual-first**: Extract what you SEE in screenshots
- **PRD as context**: Use PRD to understand intent behind visual choices (e.g., "primary color" in PRD + blue in screenshot = `color.primary.blue`)
- **No invention**: Do not create tokens not visible in screenshots, even if PRD suggests them

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

**Section Numbering Rules**:
{{#if lastSectionNumber}}
- **Your first section MUST be**: `## {{add lastSectionNumber 1}}. [Section Title]`
- Continue sequential numbering from there ({{add lastSectionNumber 1}}, {{add lastSectionNumber 2}}, {{add lastSectionNumber 3}}...)
- **DO NOT write** "(Chapter N)" in section titles - use **numbered sections only**
{{else}}
- **Start with**: `## 1. Colors` (or first category)
- Continue sequential numbering (1, 2, 3...)
- **DO NOT write** "(Chapter N)" in section titles - use **numbered sections only**
{{/if}}
- Each category gets its own section number (e.g., `## 1. Colors`, `## 2. Typography`, `## 3. Spacing`)
- End document with `<!-- LAST_SECTION: N -->` where N = your last section number

### Example Structure

**For first chapter (task: ui-tokens or ui-tokens-ch1)**:

```markdown
<file path="outputs/design/ui-tokens.md">
# ui-tokens.md (Design Tokens)

> Color, typography, spacing, and size definitions

---

## 1. Colors
| token | value | usage |
|---|---|---|
| color.bg.base | #ffffff | Default background |
| color.bg.dark | #0b0f14 | Dark section background |

---

## 2. Typography
| token | font | size | weight | usage |
|---|---|---|---|---|
| font.heading.xl | Pretendard | 48px | 700 | Main title |

---

<!-- LAST_SECTION: 2 -->
</file>
```

**For continuation chapter (task: ui-tokens-ch2)**:

```markdown
<append path="outputs/design/ui-tokens.md">

---

## 3. Spacing
| token | value | usage |
|---|---|---|
| spacing.xs | 4px | Icon-text gap |
| spacing.sm | 8px | Inline element gap |

---

## 4. Border Radius
| token | value | usage |
|---|---|---|
| radius.sm | 4px | Button, input |
| radius.lg | 16px | Card |

---

<!-- LAST_SECTION: 4 -->
</append>
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
