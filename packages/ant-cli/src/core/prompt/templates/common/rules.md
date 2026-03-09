# Core Rules

## File Operations

### XML Streaming (Real-time Output)

#### Create File
```xml
<file path="codebase/src/App.tsx">
content here...
</file>
```
**Use when**: Creating a new file that doesn't exist

#### Append to File
```xml
<append path="codebase/src/utils.ts">
additional content...
</append>
```
**Use when**: Adding content at the end of an existing file

#### 🚨 CRITICAL: XML Tag Closing Rules

**RULE 1**: `<file>` MUST be closed with `</file>`. `<append>` MUST be closed with `</append>`.

**RULE 2**: NEVER use `</parameter>` or `</invoke>` to close these tags!

```xml
<!-- ✅ CORRECT -->
<file path="codebase/src/App.tsx">
content...
</file>

<!-- ❌ WRONG - Using tool call syntax -->
<file path="codebase/src/App.tsx">
content...
</parameter>   ← WRONG! Breaks parser!
</invoke>      ← WRONG! Not a tool call!

<!-- ❌ WRONG - Missing closing tag -->
<file path="codebase/src/App.tsx">
content...
<done>true</done>  ← Missing </file>!
```

**RULE 3**: Output `<done>true</done>` AFTER closing all file tags:

```xml
<!-- ✅ CORRECT sequence -->
<file path="codebase/src/App.tsx">
content...
</file>
<done>true</done>
```

---

### Tool Actions (Request/Response)

#### Read File
```
read_file(path="codebase/src/App.tsx")
```
**Use when**: Need to see file content not already in your context

#### Edit File
```
edit_file(
  path="codebase/src/App.tsx",
  old_str="exact string to find",
  new_str="replacement string"
)
```
**Use when**: Modifying specific parts of an existing file  
**Requirements**: 
- `old_str` must match current file content EXACTLY (including whitespace)
- If edit fails with "not found", call `read_file` to refresh and retry

#### Delete File
```
delete_file(path="codebase/src/old.tsx")
```

#### List Files
```
list_files(directory="codebase/src", pattern="*.tsx")
```

---

### Decision Rules

| Action | Use |
|--------|-----|
| Create new file | `<file>` |
| Add to end | `<append>` |
| Modify existing | `edit_file` tool |
| See content not in context | `read_file` tool |
| Remove file | `delete_file` tool |

**CRITICAL**: Never use `<file>` on existing files - it overwrites everything!


