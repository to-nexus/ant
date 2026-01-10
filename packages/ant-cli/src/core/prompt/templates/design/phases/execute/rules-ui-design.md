## ⚠️ CRITICAL: ONE TOOL CALL PER TURN

**SYSTEM CONSTRAINT**: The system drops all tool calls after the first one.

### Why This Exists
- System architecture: Only first tool call is executed
- Better UX: Shows step-by-step progress
- Error handling: Can adjust after each result

### ❌ WRONG
```
// All in one turn - ONLY FIRST will execute!
[tool_call: list_reference_images()]
[tool_call: list_assets()]           ← DROPPED
[tool_call: read_reference_image()]  ← DROPPED
```

### ✅ CORRECT
```
Turn 1: list_reference_images() → Wait for result
Turn 2: read_reference_image("screen1.png") → Wait for result
Turn 3: read_reference_image("screen2.png") → Wait for result
Turn 4: Generate document with <file> tag
```

**Rule**: One tool call per turn. No exceptions.

════════════════════════════════════════════════════════════════════════════════

## TOOL USAGE

You have access to tools for exploring reference images and assets:

| Tool | Purpose |
|------|---------|
| `list_reference_images` | Discover available screenshots (screens/, components/) |
| `read_reference_image` | Load specific image for visual analysis |
| `list_assets` | List asset files (logos, icons, backgrounds, fonts) |
| `read_file` | Read existing documents or PRD |

### Workflow

1. **First**: Use `list_reference_images` or `list_assets` to discover available resources
2. **Then**: Use `read_reference_image` to load and analyze specific images (ONE PER TURN)
3. **Finally**: Generate the document using `<file>` or `<append>` XML tag (see below)

### Image Loading Strategy

- **ui-tokens.md**: Load 2-3 key screenshots with diverse UI elements
- **ui-assets.md**: Use `list_assets` primarily, images optional for context
- **ui-spec.md**: Load screens systematically (desktop → tablet → mobile)

> ⚠️ **IMPORTANT**: Images are NOT preloaded. You MUST use `read_reference_image` tool to see screenshot content.

════════════════════════════════════════════════════════════════════════════════

## OUTPUT FORMAT

{{> common/rules}}

════════════════════════════════════════════════════════════════════════════════

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference for UI Design Documents
════════════════════════════════════════════════════════════════════════════════

### Scenario 1: New Document (First Chapter)

**Detection**: Task ID is `ui-tokens`, `ui-assets`, `ui-spec`, or ends with `-ch1`
**OR**: `lastSectionNumber` is NOT provided (starting fresh)

{{#unless lastSectionNumber}}
**You are in this scenario right now.**
{{/unless}}

Use `<file>` tag:

```xml
<file path="outputs/design/[FILENAME]">
# Document Title

> Brief description of document purpose

---

## 1. First Section
...

<!-- SECTION_PATTERN: top-level -->
<!-- LAST_SECTION: 1 -->
</file>
```

{{#if isLastTaskForDocument}}
**⚠️ EXCEPTION: Since this is the LAST task for this document, OMIT the metadata lines above!**
{{/if}}

**Filename determination:**
- Task ID starts with `ui-tokens` → use `ui-tokens.md`
- Task ID starts with `ui-assets` → use `ui-assets.md`
- Task ID starts with `ui-spec` → use `ui-spec.md`

---

### Scenario 2: Appending to Existing Document (Continuation Chapter)

**Detection**: Task ID contains `-ch2`, `-ch3`, `-ch4`, etc.
**OR**: `lastSectionNumber` is provided in the prompt context

{{#if lastSectionNumber}}
**⚠️ You are in this scenario right now! Last section was: {{lastSectionNumber}}**
{{/if}}

**⚠️ CRITICAL: If continuing a document, you MUST use `<append>`, NOT `<file>`!**

Use `<append>` tag:

```xml
<append path="outputs/design/[FILENAME]">

## N. [Topic]    <!-- N = lastSectionNumber + 1 -->
...

<!-- LAST_SECTION: N -->
</append>
```

{{#if lastSectionNumber}}
**Your first section: ## {{add lastSectionNumber 1}}**
{{/if}}
{{#if isLastTaskForDocument}}
**⚠️ EXCEPTION: Since this is the LAST task, OMIT `<!-- LAST_SECTION -->` line!**
{{/if}}

{{#if lastSectionNumber}}
**For this task:**
- Your first section number: {{add lastSectionNumber 1}}
- Your ending metadata: `<!-- LAST_SECTION: [YOUR_LAST_NUMBER] -->`
{{/if}}

**Examples**:
- `ui-tokens-ch1` or `ui-tokens` → Use `<file path="outputs/design/ui-tokens.md">` with `<!-- LAST_SECTION: N -->`
- `ui-tokens-ch2` → Use `<append path="outputs/design/ui-tokens.md">` with updated `<!-- LAST_SECTION: N -->` ✅
- `ui-assets-ch2` → Use `<append path="outputs/design/ui-assets.md">` with updated `<!-- LAST_SECTION: N -->` ✅
- `ui-spec-ch3` → Use `<append path="outputs/design/ui-spec.md">` with updated `<!-- LAST_SECTION: N -->` ✅

---

### Simple Rules

1. **First chapter** (`-ch1` or no suffix) → `<file>` tag with metadata at end
2. **Continuation chapters** (`-ch2`, `-ch3`, etc.) → `<append>` tag with metadata at end
3. **Path prefix**: Always `outputs/design/`
4. **One file per category**: All ui-tokens chapters → `ui-tokens.md`

### Metadata Rules

{{#if isLastTaskForDocument}}
**⚠️ THIS IS THE LAST TASK FOR THIS DOCUMENT.**

**YOU MUST STILL GENERATE CONTENT** using `<file>` or `<append>` tags as normal!
Only difference: Do NOT add `<!-- LAST_SECTION -->` or `<!-- SECTION_PATTERN -->` at the end.
Your output should end with actual content (text, tables, code blocks), not metadata comments.
{{else}}
**Required Metadata (at document end):**

**First chapter MUST output both:**
```
<!-- SECTION_PATTERN: top-level -->
<!-- LAST_SECTION: N -->
```

**Continuation chapters output only:**
```
<!-- LAST_SECTION: N -->
```

- `SECTION_PATTERN`: `top-level` (each topic = `## N.`) or `nested` (topics under container = `### N.M`)
- `LAST_SECTION`: Your last section number
{{/if}}

### ❌ DO NOT

```xml
<!-- WRONG: Using <file> for chapter 2 -->
<file path="outputs/design/ui-tokens.md">  ← Will OVERWRITE existing content!

<!-- WRONG: Wrong path -->
<file path="inputs/sources/ui-tokens.md">

<!-- WRONG: Creating separate files per chapter -->
<file path="outputs/design/ui-tokens-ch2.md">  ← All chapters go to same file!
```

### ✅ CORRECT

```xml
<!-- Task: ui-tokens-ch1 (FIRST) -->
<file path="outputs/design/ui-tokens.md">
# ui-tokens.md (Design Tokens)

> Color, typography, spacing, and visual effect definitions extracted from reference screenshots

---

## 1. Colors
- `color.primary.blue`: #1E40AF

<!-- LAST_SECTION: 1 -->
</file>
```

```xml
<!-- Task: ui-tokens-ch2 (CONTINUATION) -->
<append path="outputs/design/ui-tokens.md">

---

## 2. Typography
- `font.family.heading`: "Inter", sans-serif

<!-- LAST_SECTION: 2 -->
</append>
```

```xml
<!-- Task: ui-tokens-ch3 (CONTINUATION) -->
<append path="outputs/design/ui-tokens.md">

---

## 3. Spacing
- `spacing.md`: 16px

<!-- LAST_SECTION: 3 -->
</append>
```

════════════════════════════════════════════════════════════════════════════════
## 🚫 STRICT SCOPE BOUNDARIES (CRITICAL!)
════════════════════════════════════════════════════════════════════════════════

### ⚠️ FIRST CHAPTER (ui-spec-ch1) RESPONSIBILITIES

**If your task ID ends with `-ch1` or has no `-ch` suffix for ui-spec:**

**✅ ch1 MUST:**
1. **Establish document outline** - Define the complete section structure that ALL subsequent chapters will follow
2. **Document-level metadata** - Purpose, scope, global breakpoints, container widths
3. **Define section skeleton** - List future section titles without detailed content

**❌ ch1 MUST NOT:**
- Write detailed component specifications
- Include per-section layouts, colors, or behaviors
- Generate content that belongs to ch2+

**Why?** ch1 defines the **structural contract** that all subsequent chapters MUST honor.

---

### ⚠️ STRUCTURAL CONSISTENCY (ch2+)

**Subsequent chapters MUST:**
1. **Follow ch1's structure** - Use the same section hierarchy established in ch1
2. **Match section level** - If ch1 defined `## N. Section`, continue with `## N+1. Section` (not subsections)
3. **Never create new structural patterns** - The document outline is frozen after ch1

**Violation Example:**
- ch1 defines: `## 1. Overview`, `## 2. Layout`
- ch2 WRONG: Creates `## 3. Components` then puts specs as `### 3.1`, `### 3.2`
- ch3 WRONG: Suddenly creates `## 4. About`, `## 5. Ecosystem` as top-level

**Correct Approach:**
- If ch1 established top-level sections per topic → ALL chapters use top-level sections
- If ch1 established container + subsections → ALL chapters use same pattern

---

### How Section Numbers Work

1. **First chapter**: Start from `## 1.`
2. **Continuation chapters**: Start from `## (lastSectionNumber + 1).`
3. You determine how many sections based on content, NOT predefined ranges

### ⚠️ DUPLICATE PREVENTION RULES

**Before generating ANY section, check FORBIDDEN SECTIONS in your prompt:**

1. **Topic Match**: If topic appears in FORBIDDEN → **SKIP entirely**
2. **Partial Match**: If FORBIDDEN has subsections of your topic → **SKIP entire topic**
3. **When in doubt**: If unsure whether documented → **SKIP it**

### Decision Flow

For each topic in your task description:
1. Search FORBIDDEN SECTIONS for matching topic name
2. If found → SKIP
3. If not found → Generate as next section number

### Key Principles

**Task description = suggested scope, FORBIDDEN SECTIONS = absolute truth**

**FORBIDDEN SECTIONS wins over task description. Generate only undocumented topics.**

════════════════════════════════════════════════════════════════════════════════
## ⚠️ DOCUMENT DEPENDENCY CHAIN
════════════════════════════════════════════════════════════════════════════════

Documents are generated in order. Previous documents are **automatically injected** as REFERENCE sections.

```
ui-tokens.md (FIRST - no dependencies)
     ↓
ui-assets.md (SECOND - receives ui-tokens.md as REFERENCE)
     ↓
ui-spec.md (LAST - receives both previous documents as REFERENCE)
```

### How to Use the REFERENCE Sections

For dependent tasks, you will find REFERENCE sections in this prompt containing previously generated content:

```
# REFERENCE: ui-tokens.md (generated in previous task)
```

**When generating ui-assets.md:**
- Find and read the `# REFERENCE: ui-tokens.md` section in this prompt
- Use token names when describing asset usage context

**When generating ui-spec.md:**
- Find and read both `# REFERENCE: ui-tokens.md` and `# REFERENCE: ui-assets.md` sections
- ALL visual values must use token references (e.g., `token(color.bg.base)`)
- ALL assets must use identifiers from the asset mapping

════════════════════════════════════════════════════════════════════════════════
## Document Quality Guidelines
════════════════════════════════════════════════════════════════════════════════

**CRITICAL WRITING RULES (Apply to ALL documents)**:

1. **Token-First**: ALL visual values MUST reference tokens (e.g., `token(color.primary)`, NOT `#1E40AF`)
2. **Specification Only**: Document WHAT to build, NOT HOW (no framework names, no implementation code)
3. **Complete Coverage**: Capture ALL visual elements and interactions visible in screenshots
4. **Use REFERENCE Sections**: For dependent tasks, find and use `# REFERENCE:` sections in this prompt

---

### ui-tokens.md Format

**Structure**:
- Organize by category: Colors, Typography, Spacing, Effects
- Use **Markdown tables** for easy reference:

```markdown
| Token | Value | Usage |
|-------|-------|-------|
| color.primary.blue | #1E40AF | Primary action buttons, links |
| color.bg.dark | #1A1A1A | Hero section background |
```

**Content Requirements**:
- Extract **exact values** from screenshots (no approximations)
- Include **usage context** for each token

---

### ui-assets.md Format

**Structure**:
- Categorize by type: Logos, Icons, Backgrounds, Images
- Use **tables** with source → destination mapping:

```markdown
| Asset ID | Source Path | Type | Usage Context |
|----------|-------------|------|---------------|
| hero-bg | backgrounds/hero.webp | Background | Hero section backdrop (behind content) |
| logo-main | logos/logo.svg | Logo | Header navigation (left-aligned) |
```

**Content Requirements**:
- Reference **token names** from ui-tokens.md (e.g., "overlaid with `token(color.overlay.dark)`")
- Distinguish **background images** (decorative) vs **content images** (structural)

---

### ui-spec.md Format

**CRITICAL: Specification, Not Implementation**

ui-spec.md documents **WHAT** to build, not **HOW** to build it.

| ✅ INCLUDE | ❌ EXCLUDE |
|-----------|-----------|
| Layout structure | Framework-specific code (React, Vue, Next.js) |
| Component states and props | CSS/styling syntax (className, Tailwind) |
| Interaction behaviors | Implementation details (useState, onClick) |
| Responsive rules | Raw values (use tokens!) |
| Token references | File paths (app/, components/) |

**Token Reference Requirement**:
- ALL colors → `token(color.*)` from ui-tokens.md
- ALL spacing → `token(spacing.*)` from ui-tokens.md
- ALL typography → `token(font.*)` from ui-tokens.md
- NO raw hex codes, pixel values, or framework classes

**Asset Reference Requirement**:
- ALL assets → Use Asset IDs from ui-assets.md
- Example: "Background: `[hero-bg]` from ui-assets.md"

════════════════════════════════════════════════════════════════════════════════
## Final Checklist
════════════════════════════════════════════════════════════════════════════════

Before outputting, verify:

**XML Tag Selection**:
{{#if lastSectionNumber}}
- [ ] Used `<append>` (NOT `<file>`) because lastSectionNumber exists ({{lastSectionNumber}})
{{else}}
- [ ] Used `<file>` for first chapter (task ID has no `-ch` suffix or ends with `-ch1`)
{{/if}}
- [ ] Used `<append>` for continuation chapters (task ID ends with `-ch2`, `-ch3`, etc.)
- [ ] Path starts with `outputs/design/`
- [ ] Filename matches category (`ui-tokens.md`, `ui-assets.md`, or `ui-spec.md`)

**Section Numbering**:
{{#if lastSectionNumber}}
- [ ] First section is `## {{add lastSectionNumber 1}}.` (NOT `## 1.`)
- [ ] Section numbers are sequential from {{add lastSectionNumber 1}}
{{else}}
- [ ] First section is `## 1.` (new document)
- [ ] Section numbers are sequential (1, 2, 3...)
{{/if}}

**Metadata**:
- [ ] Added `<!-- LAST_SECTION: N -->` at the end (N = your last section number)
{{#if lastSectionNumber}}
- [ ] Did NOT duplicate old metadata line (removed `<!-- LAST_SECTION: {{lastSectionNumber}} -->`)
{{/if}}

**Content Quality**:
- [ ] Content is in **Markdown table format** where appropriate
- [ ] **Exact values** extracted from screenshots (no approximations)
- [ ] **ALL visual values** use token references (e.g., `token(color.primary)`)
- [ ] **NO raw values** (hex codes, pixel values, framework classes)
- [ ] Document section is **complete and self-contained**
