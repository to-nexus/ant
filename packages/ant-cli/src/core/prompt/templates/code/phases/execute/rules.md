# Output Format Rules

{{> code/base/injections/text-format-compact}}

════════════════════════════════════════════════════════════════════════════════
## 🎯 TWO WAYS TO INTERACT
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: `<file>`, `<append>` are XML streaming tags. File editing uses tool calls.**

### 📝 XML STREAMING - For Content Generation (LLM → User)

Use XML tags **directly** to create or append file content:

```xml
<!-- Create NEW file -->
<file path="src/components/Button.tsx">
import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button className="btn">{children}</button>;
}
</file>

<!-- Append to EXISTING file -->
<append path="src/utils.ts">
export function newFunction() {
  return true;
}
</append>
```

### 🔧 TOOL CALLING - For File Operations & Commands (System → LLM)

Use **system tools** for **editing**, **reading**, **searching**, **commands**:

**Available Tools** (provided by the system):

- `read_file(path)`: Read file contents
- `edit_file(path, old_str, new_str)`: Edit existing file with search/replace
- `search_code(pattern, file_pattern?)`: Search codebase
- `run_command(command)`: Execute shell command
- `delete_file(path)`: Delete a file
- `list_files(directory?, pattern?)`: List files
- `mkdir(path)`: Create directory

**How to use tools**: Call them using the system's native interface - NO XML tags, NO text descriptions. Just invoke the tool directly.

**🎯 When to Use What:**

| Operation | Method | Example |
|-----------|--------|---------|
| Create NEW file | `<file>` tag | `<file path="src/App.tsx">content</file>` |
| Edit EXISTING file | `edit_file` tool | `edit_file(path, old_str, new_str)` |
| Append to file | `<append>` tag | `<append path="src/utils.ts">content</append>` |
| Read file | `read_file` tool | `read_file("src/App.tsx")` |

────────────────────────────────────────────────────────────────────────────────

## 📋 COMPLETE REFERENCE

### XML Streaming Tags (Content Generation)

| Tag | Purpose | When to Use |
|-----|---------|-------------|
| `<file path="...">` | Create NEW file | File doesn't exist yet |
| `<append path="...">` | Add to EXISTING file | Add content at end |

### Available Tools (File Operations & Commands)

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `read_file` | Read file content | Need context from existing file |
| `edit_file` | Edit EXISTING file | Modify specific parts of existing file |
| `search_code` | Search codebase | Find where something is used |
| `list_files` | List directory contents | Explore file structure |
| `delete_file` | Delete **single file** | Remove one specific file (safe, UI-integrated) |
| `mkdir` | Create directory | Need new folder |
| `run_command` | Execute shell command | npm install, build, **delete directory** (`rm -rf`), **delete multiple files** (`rm *.tmp`), **move/copy files** (`mv`, `cp`) |

**🎯 File Deletion Guidelines:**
- **Single file** (e.g., `src/old.tsx`) → Use `delete_file` (safer, better UI)
- **Directory** (e.g., `dist/`, `node_modules/`) → Use `run_command` with `rm -rf dirname/`
- **Multiple files/patterns** (e.g., `*.log`, `test-*.js`) → Use `run_command` with `rm pattern`
- **Complex operations** (move, copy, rename) → Use `run_command` with `mv`, `cp`, etc.

────────────────────────────────────────────────────────────────────────────────

## ⚠️ CRITICAL: `edit_file` TOOL RULES

**How to use `edit_file` correctly:**

1. **Always read the file first** if you don't have recent content
   - Call `read_file(path)` to get current content
   - Use the exact content for `old_str` parameter

2. **The `old_str` must match EXACTLY:**
   - Whitespace (spaces, tabs, newlines)
   - Indentation
   - Comments
   - Every character

3. **Include enough context (3-5 lines)** to make the search unique
   - If the pattern might repeat, add more surrounding lines
   - Copy EXACTLY from the `read_file` result

4. **If search block not found:**
   - The file content has changed since you last saw it
   - Call `read_file` again to get the latest content
   - Update your `old_str` with the new content

**Examples:**

```python
# ❌ WRONG - Might not match exact whitespace
edit_file(
  path="src/App.tsx",
  old_str="export function Button() {\nreturn <button>Click</button>;\n}",
  new_str="export function Button() {\n  return <button className='btn'>Click</button>;\n}"
)

# ✅ CORRECT - Exact match with proper indentation (copied from read_file result)
edit_file(
  path="src/App.tsx",
  old_str="export function Button() {\n  return <button>Click</button>;\n}",
  new_str="export function Button() {\n  return <button className='btn'>Click</button>;\n}"
)
```

────────────────────────────────────────────────────────────────────────────────

## 🚨 CRITICAL: XML TAG SAFETY

**⚠️ NEVER NEST FILE TAGS!**

`<file>`, `<append>` are independent operations. Do NOT nest them:

```xml
<!-- ❌ WRONG -->
<file path="App.tsx">
<append path="...">  ← Parser will treat this as literal text!
</file>

<!-- ✅ CORRECT -->
<file path="App.tsx">...</file>
<append path="utils.ts">...</append>
```

**⚠️ DO NOT include closing tags in code strings/comments!**

Parser looks for FIRST occurrence of `</file>`, `</append>`. Use string concatenation if needed: `"</" + "file>"`

**❌ FORBIDDEN - These will break parsing:**

```typescript
// Bad: comment with closing tag
// TODO: </replace> this later
const tag = "</file>";              // String literal
const html = "</append>";           // Will break parser!
console.log("</file>");             // Parser stops here!
```

**✅ SAFE ALTERNATIVES:**

```typescript
// Good: use different wording
// TODO: close-replace this later
// TODO: finish this replacement
const tag = "<" + "/file>";         // Split the tag
const html = "</" + "append>";      // Use concatenation
console.log("close-file");          // Use different words
```

**This applies to ALL XML tags:** `</file>`, `</append>`

────────────────────────────────────────────────────────────────────────────────

## 💡 DECISION TREE

**Working with files?**
1. **Creating NEW file?** → Use `<file>` tag
2. **Modifying existing file?** → Use `edit_file` tool (after `read_file` if needed)
3. **Appending to existing file?** → Use `<append>` tag

**Need to GET information?** → Use tools (`read_file`, `search_code`, `list_files`)

**Need to EXECUTE command?** → Use tools (`run_command` for complex ops, `delete_file` for single file, `mkdir` for dirs)

**Examples:**
- Create new file: `<file path="src/NewComponent.tsx">`
- Edit existing file: `edit_file("src/App.tsx", old_str, new_str)` 
- Append to file: `<append path="src/utils.ts">`
- Delete single file: `delete_file` tool
- Delete directory: `run_command` with `rm -rf dirname/`
- Delete multiple files: `run_command` with `rm *.log`
- Move/copy files: `run_command` with `mv` or `cp`

────────────────────────────────────────────────────────────────────────────────

## 🎯 CODE QUALITY RULES

### 1. Use Existing Constants (DRY Principle)

**⚠️ CRITICAL: Always check for and use existing constants/config files**

**Before hardcoding any value, check if it exists in**:
- `constants.ts` / `config.ts` / `settings.ts`
- Configuration files in the codebase
- Environment variables

**Examples:**

```typescript
// ❌ BAD - Hardcoded values
function updatePaddle() {
  const speed = 300;              // Magic number!
  const fieldWidth = 800;         // Duplicated!
  const paddleHeight = 100;       // Should be constant!
}

// ✅ GOOD - Use existing constants
import { PADDLE_SPEED, DEFAULT_FIELD, DEFAULT_PADDLE_HEIGHT } from './constants';

function updatePaddle() {
  const speed = PADDLE_SPEED;
  const fieldWidth = DEFAULT_FIELD.width;
  const paddleHeight = DEFAULT_PADDLE_HEIGHT;
}
```

**When editing existing files:**
1. Check if the file already imports from a constants file
2. If constants exist → USE THEM (don't duplicate values)
3. If new constant needed → ADD to constants file first

**When creating new files:**
1. Check if `constants.ts` or similar exists in the project
2. Import and use constants from there
3. DO NOT create duplicate constants in multiple files

────────────────────────────────────────────────────────────────────────────────

## 🚫 COMMON MISTAKES

| Mistake | Wrong | Correct |
|---------|-------|---------|
| **CRITICAL: Using `<file>` for existing file** | `<file path="src/App.tsx">` when file exists | Use `edit_file` tool |
| **CRITICAL: Editing without reading first** | `edit_file` with outdated old_str | `read_file` first, then `edit_file` |
| **CRITICAL: Hardcoding values instead of using constants** | `const speed = 300;` when `PADDLE_SPEED` exists | `import { PADDLE_SPEED } from './constants'; const speed = PADDLE_SPEED;` |
| Creating new file without `<file>` | Using tool syntax | Use `<file path="...">` tag |
| Reading with tool as text | Writing tool call as text/XML in response | Use system's native tool interface (automatic) |
| Deleting directory with single file tool | Using `delete_file` on `dist/` directory | Use `run_command` tool: `rm -rf dist/` |
| Deleting multiple files individually | Multiple `delete_file` calls | Use `run_command` tool: `rm *.log` |
| Duplicating constants in multiple files | `const API_URL = "..."` in 3 files | Create `config.ts` with single source of truth |
| Markdown in content | ` ```typescript\ncode\n``` ` | Raw code only |
| Placeholder paths | `path/to/file.tsx` | `src/components/Button.tsx` |
| Code placeholders | `// ... logic ...` | Complete implementation |
| Whitespace in edit_file old_str | Missing indentation | Exact match required |

────────────────────────────────────────────────────────────────────────────────

## ✅ COMPLETION

```xml
<done>true</done>
```

Output when task is complete. For feature tasks: code + `<done>true</done>` only, NO summary.

════════════════════════════════════════════════════════════════════════════════

**Follow these rules for successful code application.**
