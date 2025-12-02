## OUTPUT FORMAT

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference
════════════════════════════════════════════════════════════════════════════════

### Scenario 1: Creating New Document (First Task)

Use `<file>` tag:

```xml
<file path="outputs/design/[FILENAME]">
# [Document Type] Document: [Project Name]

## 1. Overview
...

<!-- LAST_SECTION: 1 -->
</file>
```

**Filename** based on task description:
- "api-contract.md" → `api-contract.md`
- "fe-system-design.md" → `fe-system-design.md`
- "be-system-design.md" → `be-system-design.md`
- Otherwise → `system-design.md`

### Scenario 2: Appending Content (Continuation Task)

Use `<append>` tag:

```xml
<append path="outputs/design/[FILENAME]">
## N. [Topic]    <!-- ⚠️ N = lastSectionNumber + 1 -->

...

<!-- LAST_SECTION: N -->
</append>
```

### Scenario 3: Modifying Existing Sections

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
## XML Tag Rules
════════════════════════════════════════════════════════════════════════════════

### Path Requirements

**CRITICAL: Document type determines path!**

**API Contract Document:**
- ✅ Path MUST be: `outputs/design/api-contract.md`
- ✅ Used for Contract-First projects (dual design)
- ✅ Written BEFORE fe-system-design.md and be-system-design.md

**Frontend Design Document:**
- ✅ Path MUST be: `outputs/design/fe-system-design.md`
- ✅ Used for Contract-First projects (dual design)
- ✅ Written AFTER api-contract.md

**Backend Design Document:**
- ✅ Path MUST be: `outputs/design/be-system-design.md`
- ✅ Used for Contract-First projects (dual design)
- ✅ Written AFTER api-contract.md

**Unified Design Document:**
- ✅ Path MUST be: `outputs/design/system-design.md`
- ✅ Used for single-tier projects (frontend-only, backend-only, or tightly coupled fullstack)

**How to determine which path to use:**
- Check your task description for file name mention (e.g., "Create api-contract.md")
- API Contract tasks → `api-contract.md`
- Frontend tasks → `fe-system-design.md`
- Backend tasks → `be-system-design.md`
- No mention of dual design → `system-design.md`

### Tag Selection
- ✅ Use `<file>` for first task (creating new document)
- ✅ Use `<append>` for continuation tasks (adding chapters)
- ✅ Use `<edit>` for modifying existing content
- ❌ DO NOT mix tags inappropriately

### Content Rules
- ✅ Write markdown content inside XML tags
- ❌ NO markdown code fences inside XML tags
- ❌ NEVER output content outside XML tags
- ✅ Ensure proper markdown formatting (headers, lists, code blocks)

### Multiple Operations
If you need to perform multiple operations, use multiple XML tags:

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

❌ **Text outside XML tags**
```
Here's the document:  ← BAD!
<file path="...">...</file>
```

❌ **Markdown code fences inside XML**
```xml
<file path="...">
```markdown  ← BAD!
# Title
```
</file>
```

❌ **Wrong path**
```xml
<file path="design.md">  ← BAD! Missing outputs/design/
```

✅ **CORRECT**:
```xml
<file path="outputs/design/api-contract.md">
# API Contract Document

## 1. Overview
...
</file>
```

════════════════════════════════════════════════════════════════════════════════
## Final Checklist
════════════════════════════════════════════════════════════════════════════════

Before outputting, verify:
- ✅ Used correct XML tag (`<file>`, `<append>`, or `<edit>`)?
- ✅ Path matches document type?
  - API Contract → `outputs/design/api-contract.md`
  - Frontend → `outputs/design/fe-system-design.md`
  - Backend → `outputs/design/be-system-design.md`
  - Unified → `outputs/design/system-design.md`
- ✅ File name matches task description?
- ✅ NO text outside XML tags?
- ✅ NO markdown code fences inside XML?
- ✅ Content is valid markdown?
- ✅ Used `<append>` if continuing existing document?
- ✅ Section numbering continues from last section?
- ✅ Added `<!-- LAST_SECTION: N -->` at end?

**If YES to all → Output. If NO → Fix first!**


