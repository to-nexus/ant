## ui-spec.json Generation Guide

### Purpose
Define **what** to build (visual & behavioral requirements) in a structured JSON format, not **how** to implement it.

### ⚠️ CRITICAL: SCOPE ENFORCEMENT

**🚨 READ YOUR TASK DESCRIPTION AND GENERATE ONLY THOSE SECTIONS! 🚨**

1. **Check your task description** - it specifies exactly which UI sections to document
2. **Generate ONLY those sections** - not more, not less
3. **Other tasks handle other sections** - trust the task decomposition
4. **Skip sections already documented** - check existing content if continuing

### PRD Integration (CRITICAL)
**When to reference PRD**:
- **Content text**: Extract actual text content for headings, CTAs, descriptions
- **Feature requirements**: Understand what each component/section should accomplish
- **Interaction requirements**: Identify expected user actions, validation rules
- **Section purpose**: Clarify the intent behind visual elements

**Principles**:
- **Visual + PRD = Complete Spec**: Screenshots show HOW it looks, PRD shows WHAT it does
- **PRD for content, screenshots for styling**: Use PRD text verbatim, apply visual styles from screenshots
- **Platform-neutral guidance**: Specify responsive behavior, not platform code

---

## JSON Structure

ui-spec.json uses a structured JSON format that LLM can easily understand and developers can implement.

### Top-Level Keys

```json
{
  "_meta": {
    "lastSection": 5,
    "sectionPattern": "top-level"
  },
  "meta": {
    "title": "Project Name UI Specification",
    "version": "1.0",
    "breakpoints": {
      "mobile": { "min": 0, "max": 767 },
      "tablet": { "min": 768, "max": 1279 },
      "desktop": { "min": 1280, "max": 1919 },
      "large": { "min": 1920 }
    }
  },
  "layout": {
    "container": {
      "maxWidth": "1440px",
      "padding": {
        "mobile": "spacing.md",
        "desktop": "spacing.2xl"
      }
    },
    "spacing": {
      "sectionGap": "spacing.5xl",
      "componentGap": "spacing.xl"
    }
  },
  "sections": {
    // Each section specification goes here
  }
}
```

**Note**: `_meta.lastSection` counts the total number of UI sections defined in the spec.

### Section Specification Format

**Document what you OBSERVE in the screenshot. Use token references for all values.**

```json
{
  "sections": {
    "<section-id>": {
      "layout": "full-width | constrained",
      "background": "colors.bg.<observed-color>",
      "padding": { "vertical": "spacing.<observed>" },
      "header": {
        "container": {
          "display": "flex | block",
          "flexDirection": "row | column",
          "alignItems": "flex-start | center",
          "justifyContent": "space-between | center",
          "textAlign": "left | center"
        },
        "title": {
          "text": "<observed text from screenshot>",
          "typography": "typography.heading.<size>"
        },
        "description": {
          "text": "<observed text from screenshot>",
          "typography": "typography.body.<size>"
        }
      },
      "content": {
        "<element-name>": {
          "layout": "grid | flex",
          "columns": { "mobile": 1, "tablet": 2, "desktop": 3 },
          "gap": "spacing.<observed>"
        }
      },
      "responsive": {
        "mobile": { /* observed mobile differences */ },
        "tablet": { /* observed tablet differences */ }
      }
    }
  }
}
```

**Key principle**: Replace `<placeholders>` with what you OBSERVE in the screenshot.

---

## 🚨 MANDATORY OUTPUT STRUCTURE

**CRITICAL**: Your ui-spec.json MUST contain these top-level keys:

```json
{
  "_meta": {
    "lastSection": 0,
    "sectionPattern": "top-level"
  },
  "meta": { /* Document metadata, breakpoints */ },
  "layout": { /* Global layout settings */ },
  "sections": { /* Section-by-section specifications */ },
  "components": { /* Reusable component patterns (optional) */ },
  "accessibility": { /* Keyboard navigation, ARIA requirements */ }
}
```

**Note**: `_meta` is required for chapter tracking (unless last task for document).

### 🚫 `sections` MUST be OBJECT format, NOT array!

```json
// ✅ CORRECT - Object format with section ID as key:
{
  "sections": {
    "gnb": { "layout": "fixed" },
    "hero": { "layout": "full-width" }
  }
}

// ❌ WRONG - Array format (will break merge):
{
  "sections": [
    { "id": "gnb", "layout": "fixed" },
    { "id": "hero", "layout": "full-width" }
  ]
}
```

### Specifically PROHIBITED Content

These are **ABSOLUTELY FORBIDDEN**:
- ❌ Implementation code (React, Vue, CSS classes)
- ❌ File paths (app/, components/, *.tsx)
- ❌ Framework names (Next.js, Tailwind, etc.)
- ❌ Testing checklists
- ❌ Build configurations
- ❌ Raw hex codes or pixel values (use token references!)
- ❌ **Array format for `sections`** (use object with section ID as key!)

---

## Core Principles

### 1. Describe What You SEE (MOST IMPORTANT)

**Critical Rule**:
> "If you didn't see it in the reference image, don't write it."
> "Document the EXACT layout you observe, not what you assume."

**The screenshot is the source of truth. Describe what you SEE, not what you think should be there.**

**🚨 SPATIAL RELATIONSHIP OBSERVATION (FUNDAMENTAL PRINCIPLE):**

For EVERY container with multiple child elements, you MUST explicitly observe and document:

| Observation Point | Question to Answer |
|-------------------|-------------------|
| **Axis** | Are children arranged along horizontal axis (row) or vertical axis (column)? |
| **Alignment** | How are children aligned? (start, center, end, stretch, baseline) |
| **Distribution** | How is space distributed? (start, center, end, space-between, space-around) |
| **Wrapping** | Do elements wrap to next line, or stay in single line? |

**How to Observe:**
1. Look at the **actual pixel positions** of elements in the screenshot
2. If Element A and Element B are **side-by-side horizontally** → They are in a **row**
3. If Element A is **above** Element B → They are in a **column**
4. Check where the **empty space** is distributed

**Do NOT assume based on:**
- Element type (headers don't always stack vertically)
- Background color (dark sections aren't different from light sections)
- Common conventions (every design is unique)

**🔄 PATTERN CONSISTENCY PRINCIPLE:**

> **"Visually identical structures MUST have identical specifications"**

After analyzing all sections:
1. **Identify repeating visual patterns** - Group sections/components with same structure
2. **Verify specification consistency** - Same pattern → Same layout properties
3. **Flag and resolve inconsistencies** - If two visually identical sections have different specs, re-observe the screenshot

**Example:**
```
If you observe 3 sections with this visual pattern:
  [Title on LEFT] ←→ [Description on RIGHT]

Then ALL 3 sections MUST have:
  flexDirection: "row", justifyContent: "space-between"

NOT:
  Section A: row ✅
  Section B: row ✅  
  Section C: column ❌ (inconsistent!)
```

### 2. Token-First

**Rule**: Reference tokens from ui-tokens.json, not raw values.

**Never write**:
- ❌ `"color": "#00D9A3"`
- ❌ `"padding": "32px"`

**Always write**:
- ✅ `"color": "colors.primary.green"`
- ✅ `"padding": "spacing.xl"`

### 3. Asset References

**Rule**: Reference asset IDs from ui-assets.json.

```json
{
  "background": {
    "asset": "bg-hero",
    "overlay": "colors.overlay.gradientDark"
  }
}
```

---

## Output Format

{{#if lastSectionNumber}}
**Continuation chapter**: Append additional sections to existing JSON.
{{else}}
**First chapter**: Create initial JSON structure with meta, layout, and first sections.
{{/if}}

### Example Output

{{#if lastSectionNumber}}
**Continuation task** - use `<append>` to add YOUR sections:

```xml
<append path="outputs/design/ui-spec.json">
{
  "_meta": { "lastSection": {{add lastSectionNumber 1}} },
  "sections": {
    "YOUR_SECTION_ID": {
      "layout": "...",
      "background": "colors.bg.xxx",
      "content": { /* section content */ },
      "responsive": { /* responsive rules */ }
    }
  }
}
</append>
```
{{else}}
**First task** - use `<file>` to create the document:

```xml
<file path="outputs/design/ui-spec.json">
{
  "_meta": { "lastSection": 1, "sectionPattern": "top-level" },
  "meta": {
    "title": "Project UI Specification",
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
  "sections": {
    "YOUR_SECTION_ID": {
      "layout": "...",
      "content": { /* section content */ }
    }
  }
}
</file>
```
{{/if}}

**Note**: Replace `YOUR_SECTION_ID` with the actual section from your task description (e.g., `gnb`, `hero`, `footer`). Use OBJECT format for `sections` (NOT array). The system automatically merges new sections.

---

## Quality Checklist

Before finalizing, verify:

- [ ] **Zero framework names** (no React, Vue, Next.js, Tailwind)
- [ ] **Zero file paths** (no app/, components/, *.tsx)
- [ ] **All values use tokens** (colors.*, spacing.*, typography.*)
- [ ] **Valid JSON syntax** (proper braces, commas, quotes)
- [ ] **Asset references valid** (match ui-assets.json IDs)
- [ ] **Describes observations** (not assumptions)
- [ ] **Element arrangement documented** (for each container: are children in row or column?)

**🚨 PATTERN CONSISTENCY VERIFICATION (MANDATORY):**
- [ ] **Spatial relationships observed**: For every container, explicitly determined axis (row/column), alignment, and distribution from screenshot
- [ ] **Repeating patterns identified**: Grouped components/sections with identical visual structure
- [ ] **Specification consistency verified**: Same visual pattern → Same layout properties throughout the document

---

## Workflow

1. **Load References**: Use `list_reference_images` and `read_reference_image`
2. **Analyze Visually**: Study layout, spacing, colors, typography
3. **Consult Context**: Review `ui-tokens.json` and `ui-assets.json` in prompt
4. **Document Observations**: Write WHAT you see in JSON structure
5. **Verify**: Run through quality checklist

**Critical**: After discovering images, you MUST load and analyze them before writing the spec.
