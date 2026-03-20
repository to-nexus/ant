## ui-spec.json Generation Guide

### Purpose
Define **what** to build (visual & behavioral requirements) in structured JSON, not **how** to implement it.

**Include design intent**: For key layout decisions, add `"intent"` field explaining WHY this design choice was made. This helps Code Job understand the purpose, not just the structure.

---

## 🚨 SCOPE ENFORCEMENT

**Generate ONLY the elements specified in your task description.**
- Check your task → Generate those elements only (sections, components, or overlays)
- Other tasks handle other elements
- Skip elements already documented

---

## Source Priority Principle

**Default: Observe Screenshot First**

Your primary task is to observe and document what you SEE in the screenshot.

**Exception: Explicit Override**

If Directive or PRD contains **explicit, specific instructions** that contradict your observation, follow the Directive/PRD instead.

**"Explicit" indicators:**
- Specific technical properties are stated
- Exact numeric values are provided
- Direct contradiction markers are present (e.g., "MUST override", "regardless of visual")

**Not explicit (follow screenshot):**
- General guidance or preferences
- Feature descriptions without technical specifications
- Ambiguous or vague instructions

**When overriding observation:** Document the contradiction and resolution in `"intent"` field.

---

## PRD Integration

| Source | Use For | Priority |
|--------|---------|----------|
| **Screenshot** | Visual styling, layout, spacing | **Default** |
| **PRD** | Text content, feature requirements, interactions | Default |
| **Directive** | Additional constraints, explicit overrides | **Highest** (when explicit) |

**Principle**: Observe screenshot first, unless explicitly overridden by written specifications.

---

## JSON Structure

### Top-Level Keys

```json
{
  "_meta": { "lastSection": 0 },
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

> ⚠️ **This is minimum structure, not exhaustive.** Document ALL observed properties from the screenshot. If you see border-radius, shadows, gradients, animations, or any other visual property — add it.

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
    "layout": "<observed>",
    "background": "colors.bg.<token>",
    "container": {
      "display": "flex | grid",
      "flexDirection": "row | column",
      "alignItems": "<observed>",
      "justifyContent": "<observed>"
    },
    "content": { /* observed structure */ },
    "states": { /* hover, active, focus, disabled */ },
    "responsive": { /* breakpoint differences */ }
  }
}
```

**Intent examples:**
- `"intent": "logo left, menu right for clear navigation hierarchy"`
- `"intent": "3-column grid to showcase ecosystem pillars with equal weight"`
- `"intent": "staggered layout to create visual rhythm and break monotony"`

> ⚠️ **Add ALL observed properties.** The format above shows common fields, but include everything you observe: `borderRadius`, `shadow`, `gap`, `padding`, `opacity`, `animation`, etc.

Apply this format to `sections`, `components`, and `overlays`.

### 🚫 CRITICAL RULES

1. **`sections`, `components`, `overlays` must be OBJECT, not array**
2. **No framework names** (React, Vue, Next.js, Tailwind)
3. **No file paths** (app/, components/, *.tsx)
4. **No raw values** — use tokens (colors.*, spacing.*, typography.*)

---

## Observation Protocol

> **Follow procedurally. Do not skip steps.**

### Step 1: Container Structure (Primary)

For each section/component, determine **overall container structure first**:

**1. Determine Primary Direction**
- Look at child elements
- Arranged horizontally side-by-side? → `flexDirection: "row"`
- Stacked vertically? → `flexDirection: "column"`

**2. Identify Nested Structure**
- Are there containers within containers?
- If yes, **repeat Step 1 for each nested container**

**General Principle:**
```
Analyze outer → inner (outside-in)
Determine direction independently at each level
Parent direction ≠ Child direction (independent!)
```

### Step 2: Child Arrangement

Observe **actual positioning** of child elements within container:

| Checkpoint | Question |
|-----------|----------|
| **Direction** | Horizontal (row) or vertical (column)? |
| **Main Axis** (justifyContent) | How are children distributed along the main direction? |
| **Cross Axis** (alignItems) | ⚠️ **REQUIRED**: Row→where vertically? Column→where horizontally? |
| **Edge Position** | With space-between, do items actually touch edges? |

**⚠️ CRITICAL: Multiple Cards/Items Arrangement**

**Observation checkpoint:**
- Look at the **overall container** holding all cards
- Are cards placed **side-by-side** (horizontal) or **stacked on top of each other** (vertical)?

**Specification mapping:**

| What you see | Correct spec | Wrong spec |
|--------------|-------------|------------|
| Cards stacked vertically | `flexDirection: "column"` OR `gridTemplateColumns: "1fr"` (1 column) | ❌ `gridTemplateColumns: "repeat(N, 1fr)"` where N = card count |
| Cards side-by-side horizontally | `flexDirection: "row"` OR `gridTemplateColumns: "repeat(N, 1fr)"` (N columns) | ❌ `flexDirection: "column"` |

**Constraint:**
- Do NOT use `gridTemplateColumns: "repeat(N, 1fr)"` just because there are N cards
- `repeat(N, 1fr)` in **columns** = N cards **horizontally** (side-by-side)
- For vertical stack: Use `1fr` (single column) or `flexDirection: "column"`

**After determining overall arrangement:**
- If vertical stack → What's the **internal layout** of each card?
- If internal is row → Is image on left or right? Does it alternate?

### Step 3: Element Details

Record individual element properties:
- Colors, typography, spacing → **use token references**
- Images → objectFit (cover/contain/fill)
- States → hover, active, focus
- ⚠️ **gradient/overlay check**: Actually observed? If not, don't add

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

**⚠️ OBSERVE the screenshot for EVERY container:**
1. Which child appears FIRST (top or left)? → Put it first
2. Which child appears SECOND? → Put it second

**Examples (for reference - always OBSERVE actual order):**
- Container shows: Label on TOP, Icon on BOTTOM → `["title", "icon"]`
- Container shows: Icon on TOP, Label on BOTTOM → `["icon", "title"]`
- Container shows: Image on LEFT, Text on RIGHT → `["image", "content"]`

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
- Background image presence → overlay presence (❌)

### 🚫 Default-to-Nothing

**If not observed, do NOT add:**
- overlay / gradient
- shadow / border
- animation effects

```json
// ❌ WRONG - not observed but added
"background": { "asset": "bg-hero", "gradient": {...} }

// ✅ CORRECT - only what was observed
"background": { "asset": "bg-hero" }
```

---

## Consistency Rules

### 🔄 Variation Principle

If repeated elements are **visually different**, document each variation.

Test: "Can you distinguish A from B with content hidden?" → If yes, record differences
- Image position (left ↔ right)
- Background color (different tokens)
- Size ratio

### ✅ Pattern Consistency

> **Identical pattern → Identical spec**

```
Observed: 3 sections all have [Title LEFT | Description RIGHT]

✅ All should have flexDirection: "row"
❌ 2 have row, 1 has column (inconsistent!)
```

### 🎨 Color Uncertainty

When exact color is uncertain, use description:
- `"colorDescription": "light purple"` (uncertain)
- `"color": "colors.bg.lightPurple"` (certain)

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

**Observation rule:** Does the image fill its container or have fixed dimensions?

| Observation | Correct Spec |
|-------------|--------------|
| Image fills container width | `width: "100%"` |
| Image has fixed size regardless of container | `width: "600px"` (exact px) |
| Image scales with section | `width: "100%", objectFit: "cover"` |

**Constraint:** Do NOT default to fixed pixels. Ask:
- Does image scale when viewport changes? → `"100%"`
- Does image stay same size? → Fixed `"Npx"`

---

## Shared Components (Top-Level `components` Key)

**Principle**: Components that repeat across multiple pages should be defined ONCE in top-level `components`, then referenced by page sections. This prevents inconsistent specs for the same element.

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

**Constraint**: Do NOT duplicate full component specs in page sections. Page sections reference shared components by ID and add context-specific overrides only.

**Constraint**: Extract only truly shared patterns. A component used in exactly one place belongs in that page's section, not in top-level `components`.

---

## Quality Checklist

- [ ] Only specified elements documented
- [ ] All values use tokens
- [ ] `sections`, `components`, `overlays` are object format (not array)
- [ ] Spatial relationships observed for every container
- [ ] Item-level variations documented
- [ ] No assumed properties (overlay, gradient, shadow)
- [ ] States (hover, active, focus) documented where applicable
- [ ] **Intent provided** for key layout decisions (sections, complex containers)

---

## Layered Elements

### Fixed Header + Full-Viewport Section

Observe and document:
- Is section BEHIND or BELOW header?
- Header background: transparent or opaque?

```json
{
  "header": { "layout": "fixed", "background": "transparent | opaque" },
  "heroSection": { "startPosition": "viewport-top | below-header" }
}
```

### Positioned Elements

For each positioned element, observe:
- Which corner/edge is it anchored to?
- Is it inside container or floating on page?

---

## Workflow

1. **Load references**: `list_reference_images`, `read_reference_image`
2. **Observe**: Study layout, spacing, colors, typography
3. **Document**: Write what you SEE in JSON
4. **Verify**: Run quality checklist
