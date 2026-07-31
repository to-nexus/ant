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

#### Copy File
```
copy_file(
  source="assets/game/models/model.glb",
  destination="codebase/public/models/model.glb"
)
```
**Use when**: A file must be PLACED rather than authored — moving an existing asset out of the workspace pool into where the running application loads it, or replacing an asset already in the app  
**Requirements**:
- The source must already exist; this tool copies bytes, it never authors them
- Keep each path's own prefix — pool sources stay `assets/...`, app destinations take `codebase/...`
- Overwrites the destination and creates parent directories; both sides are integrity-checked

#### List Files
```
list_files(directory="codebase/src", pattern="*.tsx")
```
**Use when**: Discovering what exists, or confirming a specific file is present  
**Requirements**: `pattern` is optional — a glob (`*.tsx`) if it contains `*` / `?` / `[`, otherwise a plain substring. Omit it to see everything, which is what you want when checking existence.

---

### Decision Rules

| Action | Use |
|--------|-----|
| Create new file | `<file>` |
| Add to end | `<append>` |
| Modify existing | `edit_file` tool |
| See content not in context | `read_file` tool |
| Remove file | `delete_file` tool |
| Place / replace a file whose bytes already exist (assets: models, audio, images, fonts) | `copy_file` tool |

**CRITICAL**: Never use `<file>` on existing files - it overwrites everything!

**CRITICAL**: Never author or edit a binary file as text. `<file>`, `create_file` and
`edit_file` write utf-8 and will refuse a binary target; forcing bytes through a text
round-trip destroys the file irreversibly. Placing an existing binary is `copy_file`'s job.


