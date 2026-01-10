## ui-spec.md Generation Guide

### Purpose
Create a specification document that defines **what** to build, not **how** to build it.

### Core Principles

#### 1. Specification, Not Implementation

**What this means**:
- Document **visual and behavioral requirements** only
- Describe **WHAT** the interface should look like and do
- Do NOT prescribe **HOW** to implement it

**Forbidden**:
- ❌ Framework names (React, Vue, Next.js, Tailwind)
- ❌ File structures (`app/layout.tsx`, `components/Button.tsx`)
- ❌ Code syntax (`<div className="...">`, `const Component = ...`)
- ❌ Build tool configs (webpack, vite, tailwind.config.js)
- ❌ Package dependencies (@radix-ui, framer-motion)

**Allowed**:
- ✅ Semantic HTML tags (`<header>`, `<nav>`, `<section>`)
- ✅ Visual descriptions ("Fixed header with shadow on scroll")
- ✅ Behavioral requirements ("Smooth scroll to section on menu click")
- ✅ Pattern names ("Card grid", "Modal overlay", "Sticky navigation")

**Test**: Can a developer using vanilla JS, React, Vue, or Angular ALL implement this spec without confusion? If NO, remove implementation details.

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

##### Layout Direction Analysis

**CRITICAL PRINCIPLE: Observation precedes inference**

For any section containing multiple items (cards, panels, blocks, etc.), the PRIMARY axis of arrangement must be determined through direct visual analysis, not deduced from item count or semantic assumptions.

────────────────────────────────────────────────────────────────────────────────
## 🚨 MANDATORY: PRIMARY AXIS DETERMINATION
────────────────────────────────────────────────────────────────────────────────

**Analysis Protocol:**

1. **Measure relative spacing between adjacent items**
   - Compare distance along vertical axis vs horizontal axis
   - The axis with SMALLER spacing indicates primary flow direction
   - If vertical gap < horizontal gap: Items flow horizontally (multi-column)
   - If horizontal gap < vertical gap: Items flow vertically (single or alternating)

2. **Identify alignment pattern**
   - Horizontal flow: Count items sharing same vertical position (= columns)
   - Vertical flow: Detect alignment variation (centered, uniform edge, alternating)
   - Mixed: Document each row/group independently

3. **Verify consistency across breakpoints**
   - Check if direction changes at different viewport widths
   - Note any responsive transformation of primary axis

**Documentation Requirement:**

Every multi-item section specification MUST include:

```
Primary Flow: [Horizontal | Vertical | Mixed]
  → If Horizontal: Column count [N], wrapping behavior
  → If Vertical: Alignment pattern [centered | edge-aligned | alternating]
  → Responsive: [Direction changes at breakpoints? Describe]
```

**Forbidden Inference Patterns:**

```
❌ Count-based assumption: "N items → N-column layout"
   Rationale: Item count does not determine spatial arrangement

❌ Semantic assumption: "Cards → Must be grid"
   Rationale: Visual components can arrange in any axis

❌ Default pattern: "Assume horizontal unless stated otherwise"
   Rationale: No layout should be assumed without visual evidence
```

**Validation Check:**

Before finalizing any layout specification, answer:
> "Did I observe the spacing in the reference image to determine this direction, or did I infer it from item count/type?"

If inferred, re-examine visual reference.

────────────────────────────────────────────────────────────────────────────────

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

────────────────────────────────────────────────────────────────────────────────
## 🚫 STRICTLY FORBIDDEN: Implementation Details
────────────────────────────────────────────────────────────────────────────────

**CRITICAL**: ui-spec.md is a SPECIFICATION document, NOT an implementation guide.

**Forbidden Content** (will cause Code Job confusion):

| Category | Examples | Why Forbidden | Correct Approach |
|----------|----------|---------------|------------------|
| **Framework/Library Names** | "Next.js", "React", "Vue", "Tailwind" | Locks spec to specific tech | Use platform-agnostic terms |
| **File Structure** | `app/layout.tsx`, `components/Button.tsx` | Implementation decision | Describe component hierarchy conceptually |
| **Code Syntax** | `<div className="...">`, `const Button = ...` | Implementation detail | Describe visual outcome |
| **Framework APIs** | "Next.js App Router", "React hooks", "Vue composables" | Tech-specific | Describe behavior requirements |
| **Build Tools** | "Webpack", "Vite", "esbuild" config | Infrastructure concern | Out of scope |
| **Package Names** | `tailwindcss`, `@radix-ui/react-dialog` | Dependency decision | Describe UI pattern needed |
| **CSS Framework Classes** | `className="flex items-center"` | Implementation choice | Describe layout intent with tokens |
| **Raw Values in Spec** | `#FFFFFF`, `24px`, `rgba(...)` | Violates token-first | Use `token(*)` references |

**Violation Examples** (from actual ui-spec.md):

```markdown
❌ WRONG: "Server-side rendering with Next.js App Router"
✅ CORRECT: "Single-page application with smooth scroll navigation"

❌ WRONG:
## Implementation Notes
### Next.js App Router Structure
app/
├── layout.tsx
├── page.tsx
├── components/
│   ├── sections/
│   │   ├── Hero.tsx

✅ CORRECT:
## Component Organization
Sections should be organized by:
- Navigation components (header, menu)
- Content sections (hero, about, ecosystem, token, technology, social)
- Structural components (footer)
- Reusable components (cards, buttons)

❌ WRONG:
```js
module.exports = {
  theme: { extend: { colors: { 'accent-primary': '#00D9A3' } } }
}
```

✅ CORRECT: (No code in ui-spec.md. Tokens are in ui-tokens.md)
```

**Acceptable Technical Terms** (interface-level only):

✅ Generic HTML: `<header>`, `<nav>`, `<section>` (semantic structure)
✅ Behavioral Terms: "Hover state", "Focus indicator", "Smooth scroll"
✅ Pattern Names: "Fixed header", "Card grid", "Modal overlay"
✅ Accessibility: "ARIA labels", "Keyboard navigation", "Screen reader support"

**Boundary Rule**:
> "If a developer using ANY framework (React, Vue, Svelte, Angular, vanilla JS) cannot implement the spec without framework-specific assumptions, the spec is TOO SPECIFIC."

────────────────────────────────────────────────────────────────────────────────

### Quality Criteria

**Before submitting ui-spec.md, verify**:

1. **Language/Platform Agnostic**: 
   - ✅ Spec uses NO framework names (React, Vue, Next.js, Tailwind, etc.)
   - ✅ Spec is implementable in ANY technology stack
   - ❌ If spec mentions "Next.js App Router", "Tailwind config", ".tsx files" → REMOVE

2. **Token-First**: 
   - ✅ All visual values reference tokens from ui-tokens.md
   - ❌ NO raw values (hex codes, pixel values, rgba)

3. **No Implementation Code**:
   - ✅ NO code blocks with actual implementation (`const Component = ...`, `className="..."`)
   - ✅ NO file structure diagrams (`app/layout.tsx`, `components/Button.tsx`)
   - ✅ NO build tool configurations (tailwind.config.js, webpack.config.js)
   - ❌ If "## Implementation Notes" section exists → DELETE ENTIRE SECTION

4. **Complete but Concise**: 
   - ✅ Cover all visual and behavioral requirements
   - ❌ Do NOT include implementation suggestions or "helpful" code examples

5. **Actionable**: 
   - ✅ Developer can understand WHAT to build
   - ❌ Developer should decide HOW to build (tech choices are theirs)

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
