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

