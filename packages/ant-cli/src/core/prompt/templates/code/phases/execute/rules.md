# Output Format Rules

{{> code/base/injections/text-format-compact}}

════════════════════════════════════════════════════════════════════════════════
## 🎯 TWO WAYS TO INTERACT
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: `<file>`, `<edit>`, `<append>` are NOT tools! They are XML streaming tags.**

### 📝 XML STREAMING - For Content Generation (LLM → User)

Use XML tags **directly** to create or modify file content:

```xml
<!-- Create NEW file -->
<file path="src/components/Button.tsx">
import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button className="btn">{children}</button>;
}
</file>

<!-- Edit EXISTING file -->
<edit path="src/App.tsx">
<search>exact code to find</search>
<replace>new code</replace>
</edit>

<!-- Append to EXISTING file -->
<append path="src/utils.ts">
export function newFunction() {
  return true;
}
</append>
```

**🚨 CRITICAL FILE MODIFICATION RULES:**

1. **ONE EDIT PER FILE PER RESPONSE**
   
   **Why this rule exists:**
   - Once you output `<edit>`, the file is IMMEDIATELY modified on disk
   - Your second `<edit>` will use outdated search block (won't match modified content)
   - You cannot "see" the result of your first edit during the same response
   - This is a fundamental limitation of streaming generation
   
   **How to follow this rule:**
   - **THINK COMPLETELY** about all changes needed for a file BEFORE outputting any `<edit>`
   - Only output `<edit>` when your thinking about that file is **FULLY COMPLETE**
   - If you realize you need more changes mid-response, it's TOO LATE
   - Better: Plan all changes → Output ONE comprehensive `<edit>`
   
   **Examples:**
   
   ❌ **WRONG - Incremental thinking while outputting:**
   ```
   [Thinking] "I should change the type here..."
   <edit>Change type A → B</edit>
   
   [Thinking] "Oh wait, I also need to update the function signature..."
   <edit>Update function signature</edit>  ← WILL FAIL! File already changed
   ```
   
   ✅ **RIGHT - Complete thinking first, then output:**
   ```
   [Thinking] "Let me analyze this file completely..."
   [Thinking] "I need to: 1) Change type A → B, 2) Update function signature, 3) Fix imports"
   [Thinking] "All changes identified. Now I'll make ONE comprehensive edit."
   
   <edit>
     <search>Large block covering all areas to change</search>
     <replace>All changes applied together</replace>
   </edit>
   ```

2. **When You Need Multiple Changes in One File**
   
   **Option A: Comprehensive edit block**
   - Identify ALL changes needed
   - Create a large `<search>` block that includes all areas
   - Apply all changes in the `<replace>` block at once
   
   **Option B: Read first, then edit**
   - Use `read_file` tool to get current content
   - Analyze and plan ALL changes needed
   - Output ONE `<edit>` with all changes combined

### 🔧 TOOL CALLING - For Information & Commands (System → LLM)

Use **system tools** for **reading**, **searching**, **commands** (NEVER for file creation/modification):

**Available Tools** (provided by the system):

- `read_file(path)`: Read file contents
- `search_code(pattern, file_pattern?)`: Search codebase
- `run_command(command)`: Execute shell command
- `delete_file(path)`: Delete a file
- `list_files(directory?, pattern?)`: List files
- `mkdir(path)`: Create directory

**How to use tools**: Call them using the system's native interface - NO XML tags, NO text descriptions. Just invoke the tool directly.

────────────────────────────────────────────────────────────────────────────────

## 📋 COMPLETE REFERENCE

### XML Streaming Tags (Content Generation)

| Tag | Purpose | When to Use |
|-----|---------|-------------|
| `<file path="...">` | Create NEW file | File doesn't exist yet |
| `<edit path="...">` | Modify EXISTING file | Change specific parts |
| `<append path="...">` | Add to EXISTING file | Add content at end |

### Available Tools (Information & Commands)

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `read_file` | Read file content | Need context from existing file |
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

## ⚠️ CRITICAL: `<edit>` TAG RULES

**🚨 MOST CRITICAL: Edit each file ONLY ONCE per response!**

After you edit a file, its content has changed. A second edit will FAIL because the search block won't match.

**The `<search>` block must match EXACTLY:**
- Whitespace (spaces, tabs, newlines)
- Indentation
- Comments
- Every character

**How to get it right:**
1. Copy EXACTLY from ORIGINAL FILES section or `read_file` result
2. Include enough context to make search unique (3-5 lines)
2. If pattern might repeat → add more context

**Examples:**

```xml
<!-- ❌ FAILS - Missing indentation -->
<edit path="src/App.tsx">
<search>
export function Button() {
return <button>Click</button>;
}
</search>
<replace>
export function Button() {
  return <button className="btn">Click</button>;
}
</replace>
</edit>

<!-- ✅ CORRECT - Exact match with proper indentation -->
<edit path="src/App.tsx">
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
<replace>
export function Button() {
  return <button className="btn">Click</button>;
}
</replace>
</edit>
```

────────────────────────────────────────────────────────────────────────────────

## 🚨 CRITICAL: XML TAG SAFETY

**⚠️ NEVER NEST FILE TAGS!**

`<file>`, `<edit>`, `<append>` are independent operations. Do NOT nest them:

```xml
<!-- ❌ WRONG -->
<file path="App.tsx">
<edit path="...">  ← Parser will treat this as literal text!
</file>

<!-- ✅ CORRECT -->
<file path="App.tsx">...</file>
<edit path="App.tsx">...</edit>
```

**⚠️ DO NOT include closing tags in code strings/comments!**

Parser looks for FIRST occurrence of `</file>`, `</edit>`, `</append>`. Use string concatenation if needed: `"</" + "file>"`

**❌ FORBIDDEN - These will break parsing:**

```typescript
// Bad: comment with closing tag
// TODO: </replace> this later
const tag = "</file>";              // String literal
const html = "</append>";           // Will break parser!
console.log("</edit>");             // Parser stops here!
```

**✅ SAFE ALTERNATIVES:**

```typescript
// Good: use different wording
// TODO: close-replace this later
// TODO: finish this replacement
const tag = "<" + "/file>";         // Split the tag
const html = "</" + "append>";      // Use concatenation
console.log("close-edit");          // Use different words
```

**This applies to ALL XML tags:** `</file>`, `</edit>`, `</append>`, `</search>`, `</replace>`

────────────────────────────────────────────────────────────────────────────────

## 💡 DECISION TREE

**Working with files?**
1. **File exists?** → Read it first with `read_file` tool
2. **Modifying existing file?** → ALWAYS use `<edit>` tag
2. **Creating NEW file?** → Use `<file>` tag
3. **Appending to existing file?** → Use `<append>` tag

**Need to GET information?** → Use tools (`read_file`, `search_code`, `list_files`)

**Need to EXECUTE command?** → Use tools (`run_command` for complex ops, `delete_file` for single file, `mkdir` for dirs)

**Examples:**
- Modify existing file: `<edit path="src/App.tsx">` (NEVER `<file>` for existing files!)
- Create new file: `<file path="src/NewComponent.tsx">`
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
2. If new constant needed → ADD to constants file first

**When creating new files:**
1. Check if `constants.ts` or similar exists in the project
2. Import and use constants from there
2. DO NOT create duplicate constants in multiple files

────────────────────────────────────────────────────────────────────────────────

## 🚫 COMMON MISTAKES

| Mistake | Wrong | Correct |
|---------|-------|---------|
| **CRITICAL: Using `<edit>` as a tool** | Wrapping edit in tool syntax | Use XML tag directly: `<edit path="...">` (standalone, no wrapper) |
| **CRITICAL: Using `<file>` as a tool** | Wrapping file in tool syntax | Use XML tag directly: `<file path="...">` (standalone, no wrapper) |
| **CRITICAL: Modifying existing file with `<file>`** | `<file path="src/App.tsx">` when file exists | **ALWAYS** use `<edit path="src/App.tsx">` |
| **CRITICAL: Editing same file multiple times** | Two `<edit path="src/App.tsx">` in one response | Edit each file ONLY ONCE (combine all changes into one edit) |
| **CRITICAL: Hardcoding values instead of using constants** | `const speed = 300;` when `PADDLE_SPEED` exists | `import { PADDLE_SPEED } from './constants'; const speed = PADDLE_SPEED;` |
| Creating new file with `<edit>` | `<edit path="src/NewComponent.tsx">` when file doesn't exist | Use `<file path="src/NewComponent.tsx">` |
| Reading with tool as text | Writing tool call as text/XML in response | Use system's native tool interface (automatic) |
| Deleting directory with single file tool | Using `delete_file` on `dist/` directory | Use `run_command` tool: `rm -rf dist/` |
| Deleting multiple files individually | Multiple `delete_file` calls | Use `run_command` tool: `rm *.log` |
| Duplicating constants in multiple files | `const API_URL = "..."` in 3 files | Create `config.ts` with single source of truth |
| Markdown in content | ` ```typescript\ncode\n``` ` | Raw code only |
| Placeholder paths | `path/to/file.tsx` | `src/components/Button.tsx` |
| Code placeholders | `// ... logic ...` | Complete implementation |
| Whitespace in search | Missing indentation | Exact match required |

────────────────────────────────────────────────────────────────────────────────

## ✅ COMPLETION

```xml
<done>true</done>
```

Output when task is complete. For feature tasks: code + `<done>true</done>` only, NO summary.

════════════════════════════════════════════════════════════════════════════════

**Follow these rules for successful code application.**
