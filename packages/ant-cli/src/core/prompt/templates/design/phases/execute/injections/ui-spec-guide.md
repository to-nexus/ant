## ui-spec.md Generation Guide

### Purpose
Define **what** to build (visual & behavioral requirements), not **how** to implement it.

### PRD Integration
**When to reference PRD (CRITICAL)**:
- **Content text**: Extract actual text content for headings, CTAs, descriptions (e.g., "Open Ownership / Open World" from PRD)
- **Feature requirements**: Understand what each component/section should accomplish
- **Interaction requirements**: Identify expected user actions, validation rules, data fields
- **Section purpose**: Clarify the intent behind visual elements (e.g., "Token Section explains utility" from PRD)
- **Missing visual details**: Use PRD to infer structure when screenshots lack specific states (error, loading, empty)

**Principles**:
- **Visual + PRD = Complete Spec**: Screenshots show HOW it looks, PRD shows WHAT it does and WHY
- **PRD for content, screenshots for styling**: Use PRD text verbatim, apply visual styles from screenshots
- **Resolve ambiguity with PRD**: When layout is unclear, defer to PRD's described user journey or feature priority
- **Platform-neutral guidance**: If PRD mentions "mobile app", specify responsive behavior, not platform code

**Example Integration**:
- Screenshot shows: Blue button, rounded corners, white text
- PRD says: "Learn More button navigates to documentation"
- ui-spec.md writes: "Button with `token(color.primary.blue)` background, `token(radius.md)` corners, white text. Label: 'Learn More'. Action: Navigate to documentation."

---

## 🚨 MANDATORY OUTPUT STRUCTURE

**CRITICAL**: Your ui-spec.md MUST contain ONLY these sections (in this exact order):

```markdown
# ui-spec.md

> Complete UI specification for [Project Name]

## Overview
[Document purpose, key principles, scope]

## Layout Structure
[Page hierarchy, sections, spacing system, breakpoints]

## Component Specifications
[For each component: Structure, Specifications (visual properties, states), Interactions]

## Responsive Behavior
[Breakpoint transformations, mobile-first vs desktop-first]

## Accessibility Requirements
[Semantic structure, ARIA, keyboard navigation, focus management]

---
END OF DOCUMENT
```

**ANY OTHER SECTION IS FORBIDDEN AND WILL CAUSE THE TASK TO FAIL.**

### Specifically PROHIBITED Sections

These sections are **ABSOLUTELY FORBIDDEN**:
- ❌ "Implementation Notes" / "Technical Implementation Notes"
- ❌ "Testing Checklist" / "QA Guidelines" / "Performance Testing"
- ❌ "Browser Support" (unless directly related to accessibility requirements)
- ❌ "Tech Stack" / "Technology Stack"
- ❌ "File Structure" / "Project Structure"
- ❌ "Build Configuration"
- ❌ "State Management" / "Third-Party Libraries"
- ❌ Any section containing framework names, code blocks, or file paths

**If you find yourself about to write "## Implementation" or "## Testing" → STOP. DELETE IT. You are violating the specification mandate.**

---

## Core Principles

### 1. Describe What You SEE

**Critical Rule**:
> "If you didn't see it in the reference image, don't write it."

**Process**:
1. Look at the reference image
2. Describe EXACTLY what you observe
3. Don't "improve", "standardize", or "assume" the design

**Examples**:
- ❌ "Footer with centered logo" (assumption about "typical" footer)
- ✅ "Footer with copyright at left, logo below at left, button at right" (what you actually see)
- ❌ "Hero section with background" (generic)
- ✅ "Hero section with full-coverage background image, dark overlay, centered white text" (specific observation)

**Why This Matters**:
Designers make intentional choices. Your job is to capture those choices, not optimize them.

---

### 2. Specification, Not Implementation

⚠️ **CRITICAL MANDATE**

ui-spec.md MUST contain ONLY visual and behavioral specifications.

**You are ABSOLUTELY FORBIDDEN from including**:
- ❌ Implementation guidance → **TASK FAILURE**
- ❌ Testing checklists → **TASK FAILURE**
- ❌ Code examples → **TASK FAILURE**
- ❌ Framework names → **TASK FAILURE**
- ❌ File paths → **TASK FAILURE**
- ❌ Build configurations → **TASK FAILURE**

**What This Means**:
- Document visual and behavioral requirements
- Describe WHAT the interface should do
- Do NOT prescribe HOW to implement it

**Forbidden**:
- ❌ Framework names (React, Vue, Next.js, Tailwind, Angular)
- ❌ File structures (`app/layout.tsx`, `components/Button.tsx`)
- ❌ Code syntax (`className="..."`, `const Component = ...`, `module.exports`)
- ❌ Build configs (webpack, tailwind.config.js, vite.config.js)
- ❌ Package names (@radix-ui, framer-motion, zustand)
- ❌ CSS framework classes (Tailwind utilities, Bootstrap classes)

**Allowed**:
- ✅ Semantic HTML (`<header>`, `<nav>`, `<section>`)
- ✅ Visual descriptions ("Fixed header with shadow on scroll")
- ✅ Behavioral requirements ("Smooth scroll on menu click")
- ✅ UI patterns ("Card grid", "Modal overlay")

**Boundary Test**:
> "Can this be implemented in React, Vue, Angular, vanilla JS, iOS, or Android without modification?"

If NO → Remove tech-specific details.

**ANY violation of these rules will result in TASK FAILURE.**

---

### 3. Specification vs Verification

**Critical Distinction**:
- **Specification** = What exists ("Button with accent color")
- **Verification** = How to test it ("Click button, verify color is #00D9A3")

**ui-spec.md is SPECIFICATION ONLY**

**Forbidden**:
- ❌ Testing checklists ("[ ] All links work")
- ❌ Performance benchmarks ("LCP < 2.5s")
- ❌ QA procedures ("Test on Chrome, Firefox, Safari")
- ❌ Validation steps ("Verify responsive at 768px")

**Why**: Testing belongs in separate QA/test plans.

**If you see "## Testing" section in your output → DELETE IT**

---

### 4. Token-First

**Rule**: If a value exists in `ui-tokens.md`, use `token(name)`.

**Never write**:
- ❌ `#00D9A3`, `rgba(0, 0, 0, 0.5)`
- ❌ `32px`, `1.5rem`
- ❌ `font-size: 16px`, `margin: 24px`

**Always write**:
- ✅ `token(color.accent.primary)`
- ✅ `token(spacing.xl)`
- ✅ `token(font.size.base)`

**Why**: Tokens enable theme changes and maintain consistency.

---

### 5. Platform-Agnostic

**Use interface-level terms**, not implementation terms.

**Allowed**: Semantic HTML, UI patterns, behaviors
**Forbidden**: Framework names, file paths, code syntax, CSS classes

**Test**: Would a designer understand this without knowing React/Vue/Next.js?

---

## Layout Analysis

### Primary Axis Determination

For sections with multiple items, determine the PRIMARY flow direction:

**Step 1: Measure Spacing**
- Compare vertical gap vs horizontal gap between adjacent items
- Smaller gap = primary flow direction

**Step 2: Identify Pattern**
- If vertical gap < horizontal gap → Horizontal flow (multi-column grid)
- If horizontal gap < vertical gap → Vertical flow (single column or alternating)

**Step 3: Document**
```
Primary Flow: [Horizontal | Vertical]
Pattern: [N-column grid | Single column centered | Alternating left/right]
```

**Critical**:
- ❌ Don't infer from item count ("3 cards = 3 columns")
- ✅ Measure spacing in the actual image

**Ask Yourself**: "Did I observe this spacing, or did I assume it?"

---

## Image Role Detection

**Two Types**:

**Background Images** (decorative):
- Full-section coverage, behind content
- Removing changes atmosphere, not structure
- Specified via background properties

**Content Images** (structural):
- Between content blocks, occupy space
- Removing collapses space and changes layout
- Specified via size, position, spacing

**Test**: Does removing this image collapse space? → Content image

**Common Mistake**: Assuming `bg-*.png` files are always backgrounds. Check the visual layout.

---

## What to EXCLUDE

### 🚫 Strictly Forbidden

| Category | Examples | Why |
|----------|----------|-----|
| **Frameworks** | "Next.js", "Tailwind" | Locks spec to tech |
| **File Structure** | `app/layout.tsx` | Implementation decision |
| **Code** | `<div className="...">` | Implementation detail |
| **Testing/QA** | "Testing Checklist", "LCP < 2.5s" | Verification ≠ Specification |
| **Raw Values** | `#FFFFFF`, `24px` | Use tokens |

**Examples of Violations**:

```markdown
❌ WRONG:
- "Server-side rendering with Next.js App Router"
- ## Implementation Notes
- ## Testing Checklist
- tailwind.config.js code blocks

✅ CORRECT:
- "Single-page application with smooth scroll"
- (No implementation or testing sections)
```

---

## Quality Checklist

Before finalizing, verify:

- [ ] **Zero framework names** (grep "react|vue|next|tailwind")
- [ ] **Zero file paths** (grep "app/|components/.*tsx")
- [ ] **Zero implementation code** (grep "className=|const.*=")
- [ ] **Zero testing sections** (grep "## Testing|### Testing")
- [ ] **All values use tokens** (no `#`, `px`, `rgba`)
- [ ] **Describes observations** (not assumptions)

---

## 🔍 QUALITY VERIFICATION GUIDELINES

**Purpose**: These are quality guidelines to help you generate a high-quality ui-spec.md. Apply them as you write the document.

### Guideline 1: Target 5 Core Sections

**Recommended structure**:
1. Overview
2. Layout Structure
3. Component Specifications
4. Responsive Behavior
5. Accessibility Requirements

**If you include additional sections**: Ensure they contain specification content, not implementation or testing details.

### Guideline 2: Avoid Implementation Details

**Check your document for these**:
- Framework names: "Next.js", "React", "Vue", "Tailwind", "Angular"
- File paths: `app/`, `components/`, `.tsx`, `.jsx`, `.css`
- Code syntax: `className=`, `module.exports`, `import`, `const`
- Section headers: "## Implementation", "## Testing", "## Technical"

**If found**: Remove or rewrite in platform-agnostic terms.

### Guideline 3: Use Token References

**All visual values should use `token(...)` notation**:
- Colors: `token(color.accent.primary)` not `#00D9A3`
- Spacing: `token(spacing.xl)` not `32px`
- Typography: `token(font.size.lg)` not `18px`

**If you use raw values**: Replace them with token references from ui-tokens.md.

### Guideline 4: Platform-Agnostic Language

**Write specifications that work for any platform**:
- ✅ "Fixed header with shadow on scroll"
- ❌ "Next.js layout with Tailwind sticky class"

**Test**: Could iOS, Android, React, Vue, and Angular developers all implement this without confusion?

---

## 🚨 CRITICAL: FILE GENERATION IS MANDATORY

**You MUST generate ui-spec.md using `<file>` tag, regardless of the above guidelines.**

**If you encounter limitations** (e.g., image fails to load, information incomplete):
1. Generate the document with available information
2. Document known limitations as comments if needed
3. Use PRD and existing documents to infer missing details
4. **Partial specification is better than no specification**

**The task is NOT complete until the file is generated.**

**If guidelines are difficult to follow perfectly**: Generate the best document you can. These are quality targets, not absolute blockers.

---

## Workflow

1. **Load References**: Use `list_reference_images` and `read_reference_image`
2. **Analyze Visually**: Study layout, spacing, colors, typography
3. **Consult Context**: Review `ui-tokens.md` and `ui-assets.md` in prompt
4. **Document Observations**: Write WHAT you see, not what "should be"
5. **Verify**: Run through quality checklist

**Critical**: After discovering images, you MUST load and analyze them before writing the spec.

---

## Document Structure

### Required Sections
1. Layout structure (page hierarchy, spacing rhythm, breakpoints)
2. Component specifications (visual properties, states, interactions)
3. Responsive behavior (breakpoint transformations)
4. Accessibility requirements (semantic structure, ARIA, keyboard nav)

### Forbidden Sections
- ❌ "Implementation Notes"
- ❌ "Testing Checklist"
- ❌ "Tech Stack"
- ❌ "File Structure"

---

## Common Mistakes

| Mistake | Why Wrong | Correct |
|---------|-----------|---------|
| "3 cards → 3-column grid" | Inference without observation | Measure spacing visually |
| "Typical footer layout" | Assumption | Describe actual layout |
| "Use Next.js" | Tech-specific | Platform-agnostic description |
| "`bg-*.png` → background" | Filename assumption | Check visual role |
| "Testing Checklist" | Verification ≠ Specification | Delete section |
| Raw hex colors | Violates token-first | Use `token(color.*)` |

---

**Remember**: ui-spec.md captures design intent. Describe what you see, reference tokens, stay platform-agnostic, and separate specification from verification.
