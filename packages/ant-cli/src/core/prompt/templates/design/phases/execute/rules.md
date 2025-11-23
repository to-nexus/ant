## OUTPUT FORMAT

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference
════════════════════════════════════════════════════════════════════════════════

### Scenario 1: Creating New Document (First Task)

Use `<file>` tag:

```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...

## 2. Architecture
...
</file>
```

### Scenario 2: Appending Content (Continuation Task)

Use `<append>` tag:

```xml
<append path="outputs/design/system-design.md">
## 3. Component Design

### 3.1 TaskManager
- Purpose: CRUD operations for tasks
- Interface: { getTasks(), addTask(), deleteTask() }
- Dependencies: Database, ValidationService
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
- ✅ Path MUST be: `outputs/design/system-design.md`
- ✅ All tasks write to the SAME file
- ❌ DO NOT create multiple design documents

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

❌ **MISTAKE 1: Outputting text outside XML tags**
```
Here's the design document:

<file path="...">
...
</file>
```

✅ **CORRECT: Only XML tags**
```
<file path="...">
...
</file>
```

❌ **MISTAKE 2: Using markdown code fences inside XML**
```xml
<file path="...">
```markdown
# Title
```
</file>
```

✅ **CORRECT: Direct markdown inside XML**
```xml
<file path="...">
# Title
</file>
```

❌ **MISTAKE 3: Wrong path**
```xml
<file path="design.md">
```

✅ **CORRECT: Standard path**
```xml
<file path="outputs/design/system-design.md">
```

════════════════════════════════════════════════════════════════════════════════
## Final Checklist
════════════════════════════════════════════════════════════════════════════════

Before outputting, verify:
- ✅ Used correct XML tag (`<file>`, `<append>`, or `<edit>`)?
- ✅ Path is `outputs/design/system-design.md`?
- ✅ NO text outside XML tags?
- ✅ NO markdown code fences inside XML?
- ✅ Content is valid markdown?
- ✅ Used `<append>` if continuing existing document?

**If YES to all → Output. If NO → Fix first!**

