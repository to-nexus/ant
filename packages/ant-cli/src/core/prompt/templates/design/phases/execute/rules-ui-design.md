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

- **ui-tokens.json**: Load 2-3 key screenshots with diverse UI elements
- **ui-assets.json**: Use `list_assets` primarily, images optional for context
- **ui-spec.json**: Load screens systematically (desktop → tablet → mobile)

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

**For JSON files (ui-tokens.json, ui-assets.json):**
```xml
<file path="outputs/design/ui-tokens.json">
{
  "_meta": {
    "lastSection": 1,
    "sectionPattern": "top-level"
  },
  "colors": { ... },
  "typography": { ... }
}
</file>
```

**For ui-spec.json:**
```xml
<file path="outputs/design/ui-spec.json">
{
  "_meta": {
    "lastSection": 1,
    "sectionPattern": "top-level"
  },
  "layout": { ... },
  "sections": {
    "hero": { ... }
  }
}
</file>
```

{{#if isLastTaskForDocument}}
**⚠️ EXCEPTION: Since this is the LAST task for this document, OMIT the `_meta` block!**
{{/if}}

**Filename determination:**
- Task ID starts with `ui-tokens` → use `ui-tokens.json`
- Task ID starts with `ui-assets` → use `ui-assets.json`
- Task ID starts with `ui-spec` → use `ui-spec.json`

---

### Scenario 2: Appending to Existing Document (Continuation Chapter)

**Detection**: Task ID contains `-ch2`, `-ch3`, `-ch4`, etc.
**OR**: `lastSectionNumber` is provided in the prompt context

{{#if lastSectionNumber}}
**⚠️ You are in this scenario right now! Last section was: {{lastSectionNumber}}**
{{/if}}

**⚠️ CRITICAL: If continuing a document, you MUST use `<append>`, NOT `<file>`!**

Use `<append>` tag:

**For JSON files (ui-tokens.json, ui-assets.json):**
```xml
<append path="outputs/design/ui-tokens.json">
{
  "_meta": {
    "lastSection": {{add lastSectionNumber 1}}
  },
  "newCategory": { ... }
}
</append>
```
The system will automatically merge this into the existing JSON.

**For ui-spec.json:**
```xml
<append path="outputs/design/ui-spec.json">
{
  "_meta": {
    "lastSection": {{add lastSectionNumber 1}}
  },
  "sections": {
    "newSection": { ... }
  }
}
</append>
```

{{#if lastSectionNumber}}
**Your continuation starts after section: {{lastSectionNumber}}**
{{/if}}
{{#if isLastTaskForDocument}}
**⚠️ EXCEPTION: Since this is the LAST task, OMIT the `_meta` block!**
{{/if}}

{{#if lastSectionNumber}}
**For this task:**
- Previous section count: {{lastSectionNumber}}
- Your `_meta.lastSection`: Update to reflect total after your additions
{{/if}}

**Examples**:
- `ui-tokens-ch1` or `ui-tokens` → Use `<file path="outputs/design/ui-tokens.json">` (JSON format)
- `ui-tokens-ch2` → Use `<append path="outputs/design/ui-tokens.json">` (merge into existing JSON)
- `ui-assets-ch2` → Use `<append path="outputs/design/ui-assets.json">` (merge into existing JSON)
- `ui-spec-ch3` → Use `<append path="outputs/design/ui-spec.json">` (merge into existing JSON)

---

### Simple Rules

1. **First chapter** (`-ch1` or no suffix) → `<file>` tag
2. **Continuation chapters** (`-ch2`, `-ch3`, etc.) → `<append>` tag
3. **Path prefix**: Always `outputs/design/`
4. **One file per category**: All ui-tokens chapters → `ui-tokens.json`

### Metadata Rules (`_meta` field)

{{#if isLastTaskForDocument}}
**⚠️ THIS IS THE LAST TASK FOR THIS DOCUMENT.**

**YOU MUST STILL GENERATE CONTENT** using `<file>` or `<append>` tags as normal!
Only difference: Do NOT include the `_meta` block in your output.
{{else}}
**Required `_meta` field (all documents are JSON):**
```json
{
  "_meta": {
    "lastSection": N,
    "sectionPattern": "top-level"
  },
  ...actual data...
}
```

- `lastSection`: Total number of sections/categories after this chapter
- `sectionPattern`: `top-level` or `nested` (first chapter only)
{{/if}}

### ❌ DO NOT

```xml
<!-- WRONG: Using <file> for chapter 2 -->
<file path="outputs/design/ui-tokens.json">  ← Will OVERWRITE existing content!

<!-- WRONG: Wrong path -->
<file path="inputs/sources/ui-tokens.json">

<!-- WRONG: Creating separate files per chapter -->
<file path="outputs/design/ui-tokens-ch2.json">  ← All chapters go to same file!
```

### ✅ CORRECT

```xml
<!-- Task: ui-tokens-ch1 (FIRST) -->
<file path="outputs/design/ui-tokens.json">
{
  "colors": {
    "primary": { "blue": "#1E40AF" },
    "bg": { "dark": "#1A1A1A", "white": "#FFFFFF" }
  }
}
</file>
```

```xml
<!-- Task: ui-tokens-ch2 (CONTINUATION) - merge into existing JSON -->
<append path="outputs/design/ui-tokens.json">
{
  "typography": {
    "heading": { "family": "Inter, sans-serif", "xl": { "size": "48px", "weight": 700 } }
  }
}
</append>
```

```xml
<!-- Task: ui-tokens-ch3 (CONTINUATION) -->
<append path="outputs/design/ui-tokens.json">
{
  "spacing": { "sm": "8px", "md": "16px", "lg": "24px" }
}
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
ui-tokens.json (FIRST - no dependencies)
     ↓
ui-assets.json (SECOND - receives ui-tokens.json as REFERENCE)
     ↓
ui-spec.json (LAST - receives both previous documents as REFERENCE)
```

### How to Use the REFERENCE Sections

For dependent tasks, you will find REFERENCE sections in this prompt containing previously generated content:

```
# REFERENCE: ui-tokens.json (generated in previous task)
```

**When generating ui-assets.json:**
- Find and read the `# REFERENCE: ui-tokens.json` section in this prompt
- Use token names when describing asset usage context

**When generating ui-spec.json:**
- Find and read both `# REFERENCE: ui-tokens.json` and `# REFERENCE: ui-assets.json` sections
- ALL visual values must use token references (e.g., `colors.primary.green`)
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

### ui-tokens.json Format

**Structure**: JSON object with semantic keys

```json
{
  "colors": {
    "primary": { "blue": "#1E40AF", "green": "#00D9A3" },
    "bg": { "dark": "#1A1A1A", "white": "#FFFFFF" },
    "text": { "primary": "#000000", "muted": "rgba(255,255,255,0.8)" }
  },
  "typography": {
    "heading": { "hero": { "size": "72px", "weight": 700, "lineHeight": 1.1 } },
    "body": { "md": { "size": "16px", "weight": 400 } }
  },
  "spacing": { "sm": "8px", "md": "16px", "lg": "24px", "xl": "32px" },
  "effects": {
    "shadow": { "md": "0 4px 6px rgba(0,0,0,0.1)" },
    "radius": { "lg": "16px", "xl": "24px" }
  }
}
```

**Content Requirements**:
- Extract **exact values** from screenshots (no approximations)
- Use semantic keys that describe **purpose**, not appearance

---

### ui-assets.json Format

**Structure**: JSON object with asset mappings

```json
{
  "logos": {
    "logo-header": { "src": "logos/header-logo.svg", "dest": "public/logos/header.svg" }
  },
  "icons": {
    "icon-telegram": { "src": "icons/telegram.svg", "dest": "public/icons/telegram.svg" }
  },
  "backgrounds": {
    "bg-hero": { "src": "bg/hero-main.png", "dest": "public/backgrounds/hero.png" }
  }
}
```

**Content Requirements**:
- Reference **token names** from ui-tokens.json (e.g., `"overlay": "colors.overlay.dark"`)
- Distinguish **background images** (decorative) vs **content images** (structural)

---

### ui-spec.json Format

**CRITICAL: Specification, Not Implementation**

ui-spec.json documents **WHAT** to build, not **HOW** to build it.

| ✅ INCLUDE | ❌ EXCLUDE |
|-----------|-----------|
| Layout structure | Framework-specific code (React, Vue, Next.js) |
| Component states and props | CSS/styling syntax (className, Tailwind) |
| Interaction behaviors | Implementation details (useState, onClick) |
| Responsive rules | Raw values (use tokens!) |
| Token references | File paths (app/, components/) |

**Token Reference Requirement**:
- ALL colors → reference `colors.*` from ui-tokens.json
- ALL spacing → reference `spacing.*` from ui-tokens.json
- ALL typography → reference `typography.*` from ui-tokens.json
- NO raw hex codes, pixel values, or framework classes

**Asset Reference Requirement**:
- ALL assets → Use Asset IDs from ui-assets.json
- Example: `background: bg-hero` (references ui-assets.json)

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
- [ ] Filename matches category (`ui-tokens.json`, `ui-assets.json`, or `ui-spec.json`)

**Section Numbering**:
{{#if lastSectionNumber}}
- [ ] First section is `## {{add lastSectionNumber 1}}.` (NOT `## 1.`)
- [ ] Section numbers are sequential from {{add lastSectionNumber 1}}
{{else}}
- [ ] First section is `## 1.` (new document)
- [ ] Section numbers are sequential (1, 2, 3...)
{{/if}}

**Metadata (`_meta` field)**:
{{#unless isLastTaskForDocument}}
- [ ] Included `_meta` field with `lastSection` value
- [ ] Format: `"_meta": { "lastSection": N }` at top level of JSON object
{{else}}
- [ ] OMITTED `_meta` block (this is the last task)
{{/unless}}

**Content Quality**:
- [ ] Content is in **Markdown table format** where appropriate
- [ ] **Exact values** extracted from screenshots (no approximations)
- [ ] **ALL visual values** use token references (e.g., `token(color.primary)`)
- [ ] **NO raw values** (hex codes, pixel values, framework classes)
- [ ] Document section is **complete and self-contained**
