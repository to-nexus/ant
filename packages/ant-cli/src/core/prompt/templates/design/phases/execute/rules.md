## OUTPUT FORMAT

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference
════════════════════════════════════════════════════════════════════════════════

### Scenario 1: Creating New Document (First Task)

{{#unless lastSectionNumber}}
**You are in this scenario right now.**
{{/unless}}

Use `<file>` tag:

```xml
<file path="outputs/design/[FILENAME]">
# [Document Type] Document: [Project Name]

## 1. Overview
...

<!-- LAST_SECTION: 1 -->
</file>
```

**Filename determination:**
- Check your task description for file name mention
- "api-contract.md" mentioned → use `api-contract.md`
- "fe-system-design.md" mentioned → use `fe-system-design.md`
- "be-system-design.md" mentioned → use `be-system-design.md`
- No mention → use `system-design.md`

### Scenario 2: Appending Content (Continuation Task)

{{#if lastSectionNumber}}
**⚠️ You are in this scenario right now! Last section was: {{lastSectionNumber}}**
{{/if}}

**⚠️ CRITICAL: If document exists, you MUST use <append>, NOT <file>!**

Use `<append>` tag:

```xml
<append path="outputs/design/[FILENAME]">
## N. [Topic]    <!-- ⚠️ N = lastSectionNumber + 1 -->

...

<!-- LAST_SECTION: N -->
</append>
```

{{#if lastSectionNumber}}
**For this task:**
- Your first section number: {{add lastSectionNumber 1}}
- Your ending metadata: `<!-- LAST_SECTION: [YOUR_LAST_NUMBER] -->`
{{/if}}

**❌ FATAL ERROR - Using <file> on existing document:**
```xml
<file path="outputs/design/system-design.md">  ← WRONG! Will OVERWRITE!
## N. [Topic]
...
</file>
```

**✅ CORRECT - Using <append> for continuation:**
```xml
<append path="outputs/design/system-design.md">  ← CORRECT! Adds at end
## N. [Topic]
...
</append>
```

### Scenario 3: Modifying Existing Sections (Rare)

Use `<edit>` tag with `<search>` and `<replace>`:

```xml
<edit path="outputs/design/system-design.md">
<search>
## 2. Architecture

### 2.1 System Overview
...existing content...
</search>
<replace>
## 2. Architecture

### 2.1 System Overview
...updated content...
</replace>
</edit>
```

════════════════════════════════════════════════════════════════════════════════
## Path Requirements
════════════════════════════════════════════════════════════════════════════════

**CRITICAL: All paths must be in `outputs/design/` directory!**

**API Contract Document:**
- Path: `outputs/design/api-contract.md`
- Usage: Contract-First projects (dual design)
- Timing: Written BEFORE fe-system-design.md and be-system-design.md

**Frontend Design Document:**
- Path: `outputs/design/fe-system-design.md`
- Usage: Contract-First projects (dual design)
- Timing: Written AFTER api-contract.md

**Backend Design Document:**
- Path: `outputs/design/be-system-design.md`
- Usage: Contract-First projects (dual design)
- Timing: Written AFTER api-contract.md

**Unified Design Document:**
- Path: `outputs/design/system-design.md`
- Usage: Single-tier projects (frontend-only, backend-only, or tightly coupled)

════════════════════════════════════════════════════════════════════════════════
## Tag Selection Decision Tree
════════════════════════════════════════════════════════════════════════════════

```
Is lastSectionNumber provided in context?
├─ NO  → Use <file> (creating new document)
└─ YES → Use <append> (continuing existing document)
           ⚠️ Using <file> will cause FATAL ERROR!
```

**Summary:**
- ✅ `<file>` → First task only (new document)
- ✅ `<append>` → Continuation tasks (existing document)
- ✅ `<edit>` → Modifying existing content (rare)
- ❌ NEVER use `<file>` when lastSectionNumber exists

════════════════════════════════════════════════════════════════════════════════
## Content Formatting Rules
════════════════════════════════════════════════════════════════════════════════

### Inside XML Tags

**✅ DO:**
- Write markdown content directly inside tags
- Use proper markdown formatting (headers, lists, code blocks)
- Include the `<!-- LAST_SECTION: N -->` metadata comment at end

**❌ DON'T:**
- Add markdown code fences inside XML tags
- Output text outside XML tags
- Forget the LAST_SECTION metadata comment

### Multiple Operations

If you need multiple file operations, use multiple XML tags:

```xml
<append path="outputs/design/system-design.md">
## 4. Technology Stack
...
</append>

<append path="outputs/design/system-design.md">
## 5. Non-Functional Requirements
...
</append>
```

════════════════════════════════════════════════════════════════════════════════
## Common Mistakes to Avoid
════════════════════════════════════════════════════════════════════════════════

### 🚨 MISTAKE 1: Using <file> on existing document

**❌ WRONG:**
```xml
<!-- When lastSectionNumber=2 -->
<file path="outputs/design/system-design.md">  ← FATAL ERROR!
## 3. New Chapter
...
</file>
```
**Error**: "Attempted to use <file> tag on EXISTING file"

**✅ CORRECT:**
```xml
<!-- When lastSectionNumber=2 -->
<append path="outputs/design/system-design.md">
## 3. New Chapter
...
<!-- LAST_SECTION: 3 -->
</append>
```

### ❌ MISTAKE 2: Text outside XML tags

**❌ WRONG:**
```
Here's the document:  ← This text will be ignored!
<file path="...">...</file>
```

**✅ CORRECT:**
```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...
</file>
```

### ❌ MISTAKE 3: Markdown code fences inside XML

**❌ WRONG:**
```xml
<file path="...">
```markdown  ← Don't do this!
# Title
```
</file>
```

**✅ CORRECT:**
```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...
</file>
```

### ❌ MISTAKE 4: Wrong path

**❌ WRONG:**
```xml
<file path="design.md">  ← Missing outputs/design/
<file path="system-design.md">  ← Missing outputs/design/
```

**✅ CORRECT:**
```xml
<file path="outputs/design/system-design.md">
```

### ❌ MISTAKE 5: Missing LAST_SECTION metadata

**❌ WRONG:**
```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...
## 2. Architecture
...
</file>  ← Missing metadata!
```

**✅ CORRECT:**
```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...
## 2. Architecture
...

<!-- LAST_SECTION: 2 -->
</file>
```

════════════════════════════════════════════════════════════════════════════════
## Pre-Output Checklist
════════════════════════════════════════════════════════════════════════════════

Before generating output, verify:

**XML Tag Selection:**
- ✅ Used `<file>` only if this is first task (no lastSectionNumber)?
- ✅ Used `<append>` if continuing document (lastSectionNumber exists)?
- ✅ NO text outside XML tags?

**Path Correctness:**
- ✅ Path starts with `outputs/design/`?
- ✅ Filename matches document type from task description?
  - API Contract → `api-contract.md`
  - Frontend → `fe-system-design.md`
  - Backend → `be-system-design.md`
  - Unified → `system-design.md`

**Content Format:**
- ✅ Valid markdown inside XML tags?
- ✅ NO markdown code fences wrapping the content?
- ✅ Section numbering correct?
{{#if lastSectionNumber}}
  - First section: ## {{add lastSectionNumber 1}}
  - Last section: ## [YOUR_LAST_NUMBER]
{{else}}
  - First section: ## 1
{{/if}}

**Metadata:**
- ✅ Added `<!-- LAST_SECTION: N -->` at end?
{{#if lastSectionNumber}}
- ✅ Removed old metadata line (was `<!-- LAST_SECTION: {{lastSectionNumber}} -->`)?
{{/if}}

**If YES to all → Output. If NO → Fix first!**
