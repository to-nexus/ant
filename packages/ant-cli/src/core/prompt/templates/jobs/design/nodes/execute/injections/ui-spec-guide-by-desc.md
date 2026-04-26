## ui-spec.json Generation Guide (Description-driven)

### Purpose
Define **what** to build (visual & behavioral requirements) in structured JSON, not **how** to implement it. The directive plus PRD is the design authority — there are no screenshots or Figma data in this mode.

**Include design intent**: For key layout decisions, add `"intent"` field explaining WHY this design choice was made. This helps Code Job understand the purpose, not just the structure.

---

## 🚨 SCOPE ENFORCEMENT

**Generate ONLY the elements specified in your task description.**
- Check your task → Generate those elements only (sections, components, or overlays)
- Other tasks handle other elements
- Skip elements already documented

---

## Source Priority Principle

**Authority order (highest first):**

1. **Directive** — explicit, specific instructions and overrides
2. **PRD / source documents** — product context, content structure, feature scope
3. **visualTier (visualLanguage / surfaceSystem / spatialSystem)** — when present, anchors aesthetic and layout defaults
4. **Reasonable defaults** — only for properties the inputs do not constrain; mark them as inferred in `intent`

**"Explicit" indicators:**
- Specific technical properties are stated
- Exact numeric values are provided
- Direct contradiction markers are present (e.g., "MUST be ...")

When the directive overrides a default, document the resolution in the `"intent"` field.

---

## PRD Integration

| Source | Use For | Priority |
|--------|---------|----------|
| **Directive** | Explicit constraints, technical overrides, must-have invariants | **Highest** |
| **PRD** | Pages, content, feature requirements, interactions | Default |
| **visualTier** | Aesthetic anchor (when present) | Default for visual properties |

---

## JSON Structure

### Top-Level Keys

```json
{
  "meta": {
    "title": "UI Specification",
    "breakpoints": {
      "mobile": { "max": 767 },
      "tablet": { "min": 768, "max": 1279 },
      "desktop": { "min": 1280 }
    }
  },
  "layout": {
    "container": { "maxWidth": "1440px" },
    "spacing": { "sectionGap": "spacing.5xl" }
  },
  "sections": { /* page blocks */ },
  "components": { /* reusable patterns */ },
  "overlays": { /* floating elements */ }
}
```

> ⚠️ **This is minimum structure, not exhaustive.** Document ALL properties the project needs (border-radius, shadows, gradients, animations, etc.) when the directive / PRD calls for them.

### Element Classification

| If element... | Document in |
|---------------|-------------|
| Occupies fixed page position | `sections` |
| Reusable across multiple places | `components` |
| Floats above page (z-index) | `overlays` |

### Element Format (Common Structure)

```json
{
  "<element-id>": {
    "intent": "<why this design choice>",
    "layout": "<intent-derived>",
    "background": "colors.bg.<token>",
    "container": {
      "display": "flex | grid",
      "flexDirection": "row | column",
      "alignItems": "<intent-derived>",
      "justifyContent": "<intent-derived>"
    },
    "content": { /* directive / PRD-derived structure */ },
    "states": { /* hover, active, focus, disabled */ },
    "responsive": { /* breakpoint differences */ }
  }
}
```

**⚠️ Responsive field**: Every top-level section, component, and overlay MUST include a `"responsive"` key at its root level. Nested children inherit the parent's responsive context — do NOT repeat `"responsive"` in every child node. If no breakpoint difference is required, use empty object `{}`.

**Intent examples:**
- `"intent": "logo left, menu right for clear navigation hierarchy"`
- `"intent": "3-column grid to showcase ecosystem pillars with equal weight"`
- `"intent": "staggered layout to create visual rhythm"`

> ⚠️ **Add ALL properties the project requires.** The format above shows common fields; include `borderRadius`, `shadow`, `gap`, `padding`, `opacity`, `animation`, etc. when they belong to the design intent.

Apply this format to `sections`, `components`, and `overlays`.

### Key Naming Convention

JSON keys fall into exactly two categories:

| Category | Rule | Applies to | Example |
|----------|------|-----------|---------|
| **Identifier key** | kebab-case | Object keys under `sections`, `components`, `overlays` | `"global-navigation"`, `"hero-section"` |
| **Schema property** | camelCase | Structural fields describing layout/content/state | `flexDirection`, `contentOrder`, `alignItems` |

**CONSTRAINT**: Do NOT mix categories.
- Identifier keys name WHAT a UI element is
- Schema properties describe HOW it is structured

**FORBIDDEN** for identifier keys:
- camelCase (`"heroSection"`) — schema property pattern
- Dot notation (`"6.4"`) — not a valid identifier
- Bare numbers (`"10"`) — not descriptive

### 🚫 CRITICAL RULES

1. **`sections`, `components`, `overlays` must be OBJECT, not array**
2. **No framework names** (React, Vue, Next.js, Tailwind)
3. **No file paths** (app/, components/, *.tsx)
4. **No raw values** — use tokens (colors.*, spacing.*, typography.*)

---

## Authoring Protocol

> **Follow procedurally. Do not skip steps.**

### Step 1: Container Structure (Primary)

For each section/component derived from the directive / PRD:

**1. Determine Primary Direction** based on intent
- Side-by-side child elements → `flexDirection: "row"`
- Stacked vertically → `flexDirection: "column"`

**2. Identify Nested Structure**
- Containers within containers? Repeat Step 1 for each nested container

**General Principle:**
```
Author outer → inner (outside-in)
Determine direction independently at each level
Parent direction ≠ Child direction (independent!)
```

### Step 2: Child Arrangement

For every container with multiple children, document:

| Checkpoint | Question |
|-----------|----------|
| **Direction** | Horizontal (row) or vertical (column)? |
| **Main Axis** (justifyContent) | How are children distributed along the main direction? |
| **Cross Axis** (alignItems) | ⚠️ **REQUIRED**: Row→where vertically? Column→where horizontally? |
| **Edge Position** | With space-between, do items actually touch edges? |

**⚠️ CRITICAL: Multiple Cards/Items Arrangement**

| Intent | Correct spec | Wrong spec |
|--------|-------------|------------|
| Cards stacked vertically | `flexDirection: "column"` OR `gridTemplateColumns: "1fr"` | ❌ `gridTemplateColumns: "repeat(N, 1fr)"` for N cards |
| Cards side-by-side horizontally | `flexDirection: "row"` OR `gridTemplateColumns: "repeat(N, 1fr)"` | ❌ `flexDirection: "column"` |

**Constraint:**
- Do NOT use `gridTemplateColumns: "repeat(N, 1fr)"` just because there are N cards
- `repeat(N, 1fr)` in **columns** = N cards **horizontally** (side-by-side)
- For vertical stack: Use `1fr` (single column) or `flexDirection: "column"`

### Step 3: Element Details

Record individual element properties:
- Colors, typography, spacing → **use token references**
- Images → objectFit (cover/contain/fill)
- States → hover, active, focus
- ⚠️ **gradient/overlay check**: Only if the directive / PRD calls for them

### ⚠️ CRITICAL: Element Order in Containers

**EVERY container with 2+ child elements MUST have `contentOrder`.**

> JSON property order ≠ visual render order. You MUST specify explicitly.

Use `contentOrder` array **inside each element definition**:

```json
{
  "id": "<element-id>",
  "title": "...",
  "icon": {...},
  "flexDirection": "column",
  "contentOrder": ["<first-visual>", "<second-visual>"]  // REQUIRED!
}
```

**Constraint:**
- Code Job cannot guess visual sequence from JSON property order
- Missing `contentOrder` = rendering order undefined = BUG

---

## Guardrails

### 🚫 Do NOT Assume

**Never assume based on:**
- Element type (headers are not always column)
- Background color (dark sections ≠ centered alignment)
- Common conventions (not all cards are horizontal grids)

### 🚫 Default-to-Nothing

**If the directive / PRD does not call for it, do NOT add:**
- overlay / gradient
- shadow / border
- animation effects

```json
// ❌ WRONG - not requested but added
"background": { "asset": "bg-hero", "gradient": {...} }

// ✅ CORRECT - only what was requested
"background": { "asset": "bg-hero" }
```

---

## Consistency Rules

### 🔄 Variation Principle

If repeated elements need to differ visually, document each variation explicitly. If the directive does not specify a variation, keep them identical.

### ✅ Pattern Consistency

> **Identical pattern → Identical spec**

```
Intent: 3 sections all have [Title LEFT | Description RIGHT]

✅ All should have flexDirection: "row"
❌ 2 have row, 1 has column (inconsistent!)
```

### 🎨 Color Uncertainty

When exact color is not specified, use the visualTier or describe intent:
- `"colorDescription": "light purple"` (descriptive, when no exact value)
- `"color": "colors.bg.lightPurple"` (precise, when token is defined)

---

## Token-First

**Never write raw values:**
- ❌ `"color": "#00D9A3"`, `"padding": "32px"`

**Always use tokens:**
- ✅ `"color": "colors.primary.green"`, `"padding": "spacing.xl"`

---

## Asset References

```json
{
  "background": { "asset": "<asset-id>" },
  "logo": { "asset": "<asset-id>", "width": "<px>", "height": "<px>" },
  "image": { "asset": "<asset-id>", "objectFit": "cover | contain | fill" }
}
```

| Element | What to specify |
|---------|-----------------|
| Logo/Icon | `width`, `height` (pixels) |
| Container image | `containerSize`, `objectFit` |
| Section background | Asset ID only |

### ⚠️ Image Sizing: Relative vs Fixed

| Intent | Correct Spec |
|-------------|--------------|
| Image fills container width | `width: "100%"` |
| Image has fixed size regardless of container | `width: "600px"` (exact px) |
| Image scales with section | `width: "100%", objectFit: "cover"` |

**Constraint:** Do NOT default to fixed pixels. Ask:
- Should the image scale with viewport? → `"100%"`
- Should it stay the same size? → Fixed `"Npx"`

---

## Shared Components (Top-Level `components` Key)

**Principle**: Components that repeat across multiple pages should be defined ONCE in top-level `components`, then referenced by page sections.

**When to populate**:
- Button/Input/Select with consistent styling across pages → extract
- Card patterns reused in different page contexts → extract
- Badge/Tag with fixed variant set → extract

**Component definition format**:
```json
{
  "components": {
    "<component-id>": {
      "intent": "<purpose and design rationale>",
      "variants": {
        "<variant-name>": {
          "background": "<token>",
          "color": "<token>",
          "borderRadius": "<token>",
          "padding": "<token>"
        }
      },
      "interactionStates": {
        "default": { },
        "hover": { },
        "disabled": { }
      },
      "sizes": {
        "sm": { "height": "<token>", "fontSize": "<token>" },
        "md": { }
      }
    }
  }
}
```

**Constraint**: Do NOT duplicate full component specs in page sections. Page sections describe USAGE CONTEXT for shared components — which component, which variant, context-specific overrides.

**Constraint**: Do NOT include variant lists, interaction state tables, or size definitions in page sections for shared components.

**Constraint**: Extract only truly shared patterns. A component used in exactly one place belongs in that page's section, not in top-level `components`.

**⚠️ Blind spot**: `variants`, `interactionStates`, `sizes` are the most common duplication vectors between page sections and the `components` key. Page sections reference by component ID only.

**Constraint**: If your task description lists component IDs (e.g., `Components: gnb, button, ...`), use those exact IDs as JSON keys in `components`. Other chapters reference these IDs via `componentRef` — changing them breaks cross-chapter references.

---

## Quality Checklist

- [ ] Only specified elements documented
- [ ] All values use tokens
- [ ] `sections`, `components`, `overlays` are object format (not array)
- [ ] Spatial relationships explicit for every container
- [ ] Variations between similar elements clearly documented
- [ ] No invented properties (overlay, gradient, shadow)
- [ ] States (hover, active, focus) documented where applicable
- [ ] **Intent provided** for key layout decisions (sections, complex containers)

---

## Layered Elements

### Fixed Header + Full-Viewport Section

Document explicitly:
- Is section BEHIND or BELOW header?
- Header background: transparent or opaque?

```json
{
  "header": { "layout": "fixed", "background": "transparent | opaque" },
  "hero-section": { "startPosition": "viewport-top | below-header" }
}
```

### Positioned Elements

For each positioned element, document:
- Which corner/edge it is anchored to
- Whether it is inside a container or floating on the page

---

## Workflow

1. **Read inputs**: `read_file` PRD if you need to refresh requirements; consult `directive` and `visualTier`
2. **Plan**: Identify which sections/components belong to your task
3. **Document**: Write the JSON, anchored on directive + PRD intent
4. **Verify**: Run the quality checklist
