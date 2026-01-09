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

##### Layout Structure Analysis

**Identify Visual Layers:**

Examine whether the section has content at different visual depths. Ask:
- Are there distinct horizontal bands of content?
- Does content flow sequentially (header, then image, then grid)?
- Are some elements clearly "on top of" or "behind" others?

If yes, document each layer separately with its purpose and relationship to other layers.

**Distinguish Image Roles:**

Images serve two fundamentally different purposes. Determine which applies:

**Background Images:**
- Decorative purpose
- Sit behind other content
- Provide atmosphere or context
- Typically have overlays for text contrast

**Content Images:**
- Primary visual information
- Part of the content flow (users scroll through them)
- Positioned between other content blocks
- Not obscured by other elements

**Document image role explicitly:** Specify whether an image is "background" (decorative layer) or "content" (information layer).

**Critical Distinction - Background vs Content Images:**

⚠️ **Common Mistake:** Assuming files named "bg-*" are always backgrounds. Always verify with visual reference.

**Background Images (Decorative Layer):**
- Cover entire section as backdrop, often with overlay applied
- Don't occupy space in document flow
- Removing them only affects visual atmosphere, not layout structure
- Specified by describing background treatment and overlay properties

**Content Images (Information Layer):**
- Have explicit dimensions and occupy space in layout flow
- Positioned between other content blocks in sequence
- Create visible gap or break in content flow if removed
- Often centered or aligned as distinct visual block
- Specified by describing size, position, and spacing relationships

**Detection Questions:**
1. Is this image sandwiched between text and other elements? → Likely content
2. Does it have a defined position in content sequence? → Likely content
3. Is it a full-section backdrop with text overlaid? → Likely background
4. Do other elements flow after it in vertical layout? → Likely content
5. Does the design show it as a distinct block with margins? → Likely content

**Example Scenario:**
If a section has header text at top, then a large prominent image, then other content below, the image is CONTENT (not background) because it occupies space in the vertical flow and creates structural separation between elements.

**When in doubt, examine the reference image carefully for layout flow.**

#### Component Specifications
For each component, document:
- **Visual properties** (using token references, not raw values)
- **States** (default, hover, active, disabled, focus)
- **Props/Variants** (what configuration options exist)
- **Constraints** (min/max sizes, content limits)

##### Section Header Layout Analysis

When documenting section headers (title, description, and other elements), analyze their spatial relationships:

**Examine Horizontal Arrangement:**

Ask these questions about the header elements:
1. Are elements positioned at the same vertical level (side-by-side) or stacked vertically?
2. If side-by-side: How is horizontal space distributed? Equal widths? Proportional?
3. What is the alignment strategy? All centered? Left-aligned? Mixed alignment?
4. Are there visible gaps or separations between elements?

**Examine Vertical Arrangement:**

1. If stacked: What is the vertical spacing between elements?
2. Are all elements center-aligned, or do some align left/right?
3. Is there a clear visual hierarchy through size/weight differences?

**Document What You Observe:**

Describe the actual spatial layout:
- Element positioning (vertical stack, horizontal arrangement, or grid)
- Alignment for each element (center, left, right, or justified)
- Spacing relationships between elements
- Container structure (full-width, constrained max-width, flex, grid)

**Don't assume patterns:** Document the observed layout structure rather than fitting it into predefined categories. A header might have title centered with description in 2 columns below it, or 3 elements arranged horizontally, or any other configuration the design requires.

⚠️ **Common Mistake:** Defaulting to centered vertical stack when reference shows horizontal distribution or asymmetric alignment.

##### Grid Layout Documentation

**Analyze the design intent:**

Examine whether items are laid out with consistent columns across rows, or if different rows have intentionally different structures.

**Indicators of uniform grids:**
- Items wrap naturally to fill available space
- No visual centering or alignment that suggests intentional asymmetry
- Equal-width columns throughout

**Indicators of non-uniform grids:**
- Items in a row are visually centered with empty space on sides
- Design shows clear grouping of rows with different column counts
- Figma/reference shows separate containers for different rows
- **Total item count doesn't divide evenly by expected column count**
- **Last row has fewer items with more spacing** (visual centering)

**Critical Check for Asymmetry:**

When total items don't divide evenly by the apparent column count:
1. Examine reference image: Are items in last row visually centered?
2. Is there noticeable spacing difference in incomplete row?
3. Does design show intentional grouping of rows?

⚠️ **Common Mistake:** Forcing a uniform grid when the design shows intentional asymmetric centering. Look for visual cues that indicate the incomplete row should be centered rather than left-aligned.

**Document grid behavior based on intent:**

If uniform: Specify column count and describe natural wrapping behavior.
If non-uniform: Explicitly document each row's structure and centering behavior.
If mixed: Document each section's layout separately.

**Default to simplicity:**
When intent is unclear, document as uniform grid with auto-wrap. Non-uniform grids should only be specified when the design clearly demonstrates intentional asymmetric arrangement.

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

### Documentation Format Guidance

**Organize by visual hierarchy:**
- Start with the broadest container/section
- Move inward to nested components
- End with smallest details

**For each element, describe:**
- Positioning (relative to parent or siblings)
- Dimensions (using tokens)
- Visual properties (using tokens)
- States and variants (if applicable)

**Use token references consistently:**
- Colors: token(color.*)
- Typography: token(font.*, line.height.*, letter.spacing.*)
- Spacing: token(spacing.*)
- Sizes: token(size.*)
- Other: token(radius.*, shadow.*, transition.*)

**Asset references:**
- Reference assets by their identifier from ui-assets.md
- Don't specify file paths directly

**Describe behavior, not code:**
- "Fade in over 300ms" not "opacity: 0 → 1"
- "Lift effect on hover" not "transform: translateY(-4px)"
- "Grid with N columns" not "display: grid; grid-template-columns: repeat(N, 1fr)"

### Workflow

**Phase 1: Preparation**
1. Review the `# REFERENCE: ui-tokens.md` section in this prompt
2. Review the `# REFERENCE: ui-assets.md` section in this prompt

**Phase 2: Discovery**
3. Use `list_reference_images` tool to discover available screenshots

**Phase 3: Analysis** (CRITICAL - Do NOT skip this phase)
4. Use `read_reference_image` tool to load the main screen screenshot
5. Analyze the loaded image for:
   - Layout structure and visual hierarchy
   - Component types and arrangements
   - Color usage, typography, spacing patterns
   - Interactive elements and states

**Phase 4: Documentation**
6. Generate ui-spec.md based on your analysis
   - Reference token names from ui-tokens.md
   - Reference asset identifiers from ui-assets.md
   - Document all discovered components and patterns

⚠️ **CRITICAL**: After discovering images in Phase 2, you MUST proceed to Phase 3.
Do NOT stop after listing images. You must load and analyze them using `read_reference_image` before generating the specification document.
