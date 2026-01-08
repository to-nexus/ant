## ui-spec.md Generation Guide

### Purpose
Create a specification document that defines **what** to build, not **how** to build it.

### Core Principles

#### 1. Specification, Not Implementation
- Document **visual and behavioral requirements** only
- NO implementation code (no framework-specific syntax, no CSS classes, no component code)
- Focus on **outcomes** and **constraints**, not solutions

#### 2. Token and Asset Reference Requirement
Look for these sections elsewhere in this prompt:

- `# REFERENCE: ui-tokens.md` - contains all design tokens (colors, typography, spacing)
- `# REFERENCE: ui-assets.md` - contains asset mappings (logos, icons, backgrounds)

When writing ui-spec:
- Reference tokens by their semantic names (e.g., `token(color.text.primary)`)
- Reference assets by their identifiers from the mapping
- NEVER use raw values (hex codes, pixel values) that are already defined in tokens

### Document Structure

#### Screen Specifications
For each screen, document:
- **Layout structure** (grid system, content areas, hierarchy)
- **Component placement** (relative positions, alignment rules)
- **Responsive behavior** (breakpoint changes, adaptation rules)

#### Component Specifications
For each component, document:
- **Visual properties** (using token references, not raw values)
- **States** (default, hover, active, disabled, focus)
- **Props/Variants** (what configuration options exist)
- **Constraints** (min/max sizes, content limits)

#### Interaction Specifications
For each interaction, document:
- **Trigger** (what initiates the interaction)
- **Behavior** (what happens)
- **Feedback** (visual/audio response)
- **Constraints** (timing, conditions)

### What to INCLUDE

| Category | Include |
|----------|---------|
| Layout | Grid structure, content areas, spacing rhythm |
| Visual | Token references, state descriptions |
| Behavior | Interactions, transitions, animations |
| Responsive | Breakpoint definitions, adaptation rules |
| Constraints | Size limits, content boundaries |

### What to EXCLUDE

| Category | Exclude | Reason |
|----------|---------|--------|
| Framework syntax | `<div className=...>` | Implementation detail |
| CSS/Styling code | `.container { ... }` | Implementation detail |
| Raw color values | `#FFFFFF`, `rgba(...)` | Use tokens instead |
| Raw size values | `24px`, `1.5rem` | Use tokens instead |
| Component code | `const Button = () => ...` | Implementation detail |

### Quality Criteria

1. **Language/Platform Agnostic**: Spec should be implementable in any technology
2. **Token-First**: All visual values reference tokens from ui-tokens.md
3. **Complete but Concise**: Cover all requirements without implementation noise
4. **Actionable**: Developer can implement without guessing

### Example Structure

```markdown
# ui-spec.md (UI Specification)

> Screen, component, and interaction definitions
> All visual values reference tokens from ui-tokens.md

## 1. Global Layout

### Grid System
- Container: token(grid.container.max), center aligned
- Columns: token(grid.columns)
- Gutter: token(spacing.grid.gap)

### Breakpoints
| name | value | layout |
|---|---|---|
| mobile | token(breakpoint.sm) | single column |
| tablet | token(breakpoint.md) | two columns |
| desktop | token(breakpoint.lg) | full grid |

## 2. Screen: Hero Section

### Layout
- Height: full viewport
- Background: token(color.bg.hero) with overlay
- Content alignment: centered both axes

### Components
| component | position | style reference |
|---|---|---|
| Logo | top-left | asset(logo-header) |
| CTA Button | center | variant: primary |
| Tagline | below CTA | token(font.heading.xl) |

### Interactions
| trigger | behavior |
|---|---|
| scroll | content fade in with token(transition.slow) |
| CTA hover | scale + token(shadow.elevated) |

## 3. Component: Card

### Props
| prop | type | description |
|---|---|---|
| variant | default, featured | visual style variant |
| image | required | card image reference |

### States
| state | visual properties |
|---|---|
| default | token(color.bg.card), token(shadow.sm) |
| hover | token(shadow.lg), lift effect |
| active | token(shadow.md) |
```

### Workflow

1. Review the `# REFERENCE: ui-tokens.md` section in this prompt
2. Review the `# REFERENCE: ui-assets.md` section in this prompt
3. `list_reference_images` → Discover available screenshots
4. `read_reference_image` → Analyze screenshots (one at a time)
5. Generate ui-spec.md using token names and asset identifiers from those REFERENCE sections
