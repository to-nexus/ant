# Core Rules

## File Operations

### XML Streaming (Real-time Output)

#### Create File
```xml
<file path="src/App.tsx">
content here...
</file>
```
**Use when**: Creating a new file that doesn't exist

#### Append to File
```xml
<append path="src/utils.ts">
additional content...
</append>
```
**Use when**: Adding content at the end of an existing file

#### 🚨 CRITICAL: XML Tag Closing Rules

**RULE 1**: `<file>` MUST be closed with `</file>`. `<append>` MUST be closed with `</append>`.

**RULE 2**: NEVER use `</parameter>` or `</invoke>` to close these tags!

```xml
<!-- ✅ CORRECT -->
<file path="App.tsx">
content...
</file>

<!-- ❌ WRONG - Using tool call syntax -->
<file path="App.tsx">
content...
</parameter>   ← WRONG! Breaks parser!
</invoke>      ← WRONG! Not a tool call!

<!-- ❌ WRONG - Missing closing tag -->
<file path="App.tsx">
content...
<done>true</done>  ← Missing </file>!
```

**RULE 3**: Output `<done>true</done>` AFTER closing all file tags:

```xml
<!-- ✅ CORRECT sequence -->
<file path="App.tsx">
content...
</file>
<done>true</done>
```

---

### Tool Actions (Request/Response)

#### Read File
```
read_file(path="src/App.tsx")
```
**Use when**: Need to see current file content before editing

#### Edit File
```
edit_file(
  path="src/App.tsx",
  old_str="exact string to find",
  new_str="replacement string"
)
```
**Use when**: Modifying specific parts of an existing file  
**Requirements**: 
- `old_str` must match EXACTLY (including whitespace)
- Call `read_file` first if you don't have current content

#### Delete File
```
delete_file(path="src/old.tsx")
```

#### List Files
```
list_files(directory="src", pattern="*.tsx")
```

---

### Decision Rules

| Action | Use |
|--------|-----|
| Create new file | `<file>` |
| Add to end | `<append>` |
| Modify existing | `edit_file` tool |
| See content | `read_file` tool |
| Remove file | `delete_file` tool |

**CRITICAL**: Never use `<file>` on existing files - it overwrites everything!


