# Output Format Rules

{{> code/base/injections/text-format-compact}}

════════════════════════════════════════════════════════════════════════════════
## 🎯 TWO WAYS TO INTERACT
════════════════════════════════════════════════════════════════════════════════

### 📝 XML STREAMING - For Content Generation (LLM → User)

Use XML tags to **create** or **modify** file content:

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

### 🔧 TOOL CALLING - For Information & Commands (System → LLM)

Use `<tool_use>` for **reading files**, **searching**, **executing commands**:

```xml
<!-- Read file to get context -->
<tool_use>
  <name>read_file</name>
  <parameters>
    <path>src/App.tsx</path>
  </parameters>
</tool_use>

<!-- Search codebase -->
<tool_use>
  <name>search_code</name>
  <parameters>
    <pattern>useState</pattern>
  </parameters>
</tool_use>

<!-- Execute command (npm install, delete file, etc) -->
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npm install react</command>
  </parameters>
</tool_use>

<!-- Delete file (system command) -->
<tool_use>
  <name>delete_file</name>
  <parameters>
    <path>src/old.tsx</path>
  </parameters>
</tool_use>
```

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

**The `<search>` block must match EXACTLY:**
- Whitespace (spaces, tabs, newlines)
- Indentation
- Comments
- Every character

**How to get it right:**
1. Copy EXACTLY from ORIGINAL FILES section or `read_file` result
2. Include enough context to make search unique (3-5 lines)
3. If pattern might repeat → add more context

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

## 💡 DECISION TREE

**Working with files?**
1. **File exists?** → Read it first with `read_file` tool
2. **Modifying existing file?** → ALWAYS use `<edit>` tag
3. **Creating NEW file?** → Use `<file>` tag
4. **Appending to existing file?** → Use `<append>` tag

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

## 🚫 COMMON MISTAKES

| Mistake | Wrong | Correct |
|---------|-------|---------|
| **CRITICAL: Modifying existing file with `<file>`** | `<file path="src/App.tsx">` when file exists | **ALWAYS** use `<edit path="src/App.tsx">` |
| Creating new file with `<edit>` | `<edit path="src/NewComponent.tsx">` when file doesn't exist | Use `<file path="src/NewComponent.tsx">` |
| Reading with XML tag | `<read path="...">` (no such tag) | `<tool_use><name>read_file</name>` |
| Deleting directory with single file tool | `delete_file` on `dist/` directory | `<tool_use><name>run_command</name><parameters><command>rm -rf dist/</command>` |
| Deleting multiple files individually | Multiple `delete_file` calls | `<tool_use><name>run_command</name><parameters><command>rm *.log</command>` |
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
