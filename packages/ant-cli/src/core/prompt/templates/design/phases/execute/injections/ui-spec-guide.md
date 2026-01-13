## ui-spec.json Generation Guide

### Purpose
Define **what** to build (visual & behavioral requirements) in structured JSON, not **how** to implement it.

---

## 🚨 SCOPE ENFORCEMENT

**Generate ONLY the elements specified in your task description.**
- Check your task → Generate those elements only (sections, components, or overlays)
- Other tasks handle other elements
- Skip elements already documented

---

## PRD Integration

| Source | Use For |
|--------|---------|
| **Screenshot** | Visual styling, layout, spacing |
| **PRD** | Text content, feature requirements, interactions |

**Principle**: Screenshots show HOW it looks, PRD shows WHAT it does.

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

---

## Output Format

{{#if lastSectionNumber}}
**Continuation** — append to existing:

```xml
<append path="outputs/design/ui-spec.json">
{
  "_meta": { "lastSection": {{add lastSectionNumber 1}} },
  "sections": { /* if task specifies sections */ },
  "components": { /* if task specifies components */ },
  "overlays": { /* if task specifies overlays */ }
}
</append>
```
{{else}}
**First task** — create document:

```xml
<file path="outputs/design/ui-spec.json">
{
  "_meta": { "lastSection": 1 },
  "meta": { "title": "UI Specification", "breakpoints": { /* ... */ } },
  "layout": { "container": { "maxWidth": "1440px" } },
  "sections": { /* page blocks */ },
  "components": { /* reusable patterns */ },
  "overlays": { /* floating elements */ }
}
</file>
```
{{/if}}

Include only the categories your task specifies. Omit empty categories.

---

## Quality Checklist

- [ ] Only specified elements documented
- [ ] All values use tokens
- [ ] `sections`, `components`, `overlays` are object format (not array)
- [ ] Spatial relationships observed for every container
- [ ] Item-level variations documented
- [ ] No assumed properties (overlay, gradient, shadow)
- [ ] States (hover, active, focus) documented where applicable

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
