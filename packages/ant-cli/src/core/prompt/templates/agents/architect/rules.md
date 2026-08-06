# Core Rules

## File Operations

**Every file write is a TOOL CALL. There is no XML file tag — file content
placed in text output is NOT saved.** Content streams to the user live as
you generate the tool call's arguments.

#### Create File
```
create_file(
  path="codebase/src/App.tsx",
  content="complete file content..."
)
```
**Use when**: Creating a new file that doesn't exist
**Requirements**:
- Emit `path` first, then `content`
- Fails if the file already exists; pass `overwrite=true` ONLY for a deliberate full replacement
- For a very large file, write an opening chunk with `create_file` and continue with `append_file`

#### Append to File
```
append_file(
  path="codebase/src/utils.ts",
  content="additional content..."
)
```
**Use when**: Continuing a large file you started with `create_file`, resuming a write cut off by the output limit, or adding content that belongs at the file's physical end

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
| Create new file | `create_file` tool |
| Continue a large file / add to end | `append_file` tool |
| Modify existing | `edit_file` tool |
| See content not in context | `read_file` tool |
| Remove file | `delete_file` tool |
| Place / replace a file whose bytes already exist (assets: models, audio, images, fonts) | `copy_file` tool |

**RULE**: Output `<done>true</done>` only AFTER the write tools' results confirm success — never in the same response as a tool call.

**CRITICAL**: Never call `create_file` on an existing file without `overwrite=true` — the write conflicts to prevent silent clobber; modifying is `edit_file`'s job.

**CRITICAL**: Never author or edit a binary file as text. `create_file` and
`edit_file` write utf-8 and will refuse a binary target; forcing bytes through a text
round-trip destroys the file irreversibly. Placing an existing binary is `copy_file`'s job.
