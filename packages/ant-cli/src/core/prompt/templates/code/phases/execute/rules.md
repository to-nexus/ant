# Output Format Rules

{{> code/base/injections/text-format-compact}}

════════════════════════════════════════════════════════════════════════════════
## 🎯 XML TAG REFERENCE
════════════════════════════════════════════════════════════════════════════════

### Creating Files & Running Commands

**write_file** - Create a new file (NOT for existing files!)
```xml
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/components/Button.tsx</path>
    <content>import React from 'react';

export function Button({ children }: { children: React.ReactNode }) {
  return <button className="btn">{children}</button>;
}</content>
  </parameters>
</tool_use>
```

**run_command** - Execute shell command
```xml
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npm install react</command>
  </parameters>
</tool_use>
```

────────────────────────────────────────────────────────────────────────────────

### Modifying Existing Files

**ALWAYS use `<edit>` for existing files** - shows only changes, more efficient.

**Basic Syntax:**
```xml
<edit path="src/components/Button.tsx">
<search>exact code to find</search>
<replace>new code</replace>
</edit>
```

**Multiple edits to same file:**
```xml
<edit path="src/App.tsx">
<search>import { Header } from './Header';</search>
<replace>
import { Header } from './Header';
import { Footer } from './Footer';
</replace>
</edit>

<edit path="src/App.tsx">
<search>
      <Header />
    </div>
  );
}
</search>
<replace>
      <Header />
      <Footer />
    </div>
  );
}
</replace>
</edit>
```

────────────────────────────────────────────────────────────────────────────────

### Completion Signal

```xml
<done>true</done>
```

Output when task is complete. For feature tasks: code + `<done>true</done>` only, NO summary.

════════════════════════════════════════════════════════════════════════════════
## ⚠️ CRITICAL: `<search>` BLOCK RULES
════════════════════════════════════════════════════════════════════════════════

**The `<search>` block must match EXACTLY:**
- Whitespace (spaces, tabs, newlines)
- Indentation
- Comments
- Every character

**How to get it right:**
1. Copy EXACTLY from ORIGINAL FILES section
2. Include enough context to make search unique (3-5 lines)
3. If pattern might repeat → add more context

**Common mistakes:**
```xml
<!-- ❌ FAILS - Missing indentation -->
<search>
export function Button() {
return <button>Click</button>;
}
</search>

<!-- ❌ FAILS - Missing space before { -->
<search>
export function Button(){
  return <button>Click</button>;
}
</search>

<!-- ✅ CORRECT - Exact match -->
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
```

════════════════════════════════════════════════════════════════════════════════
## 💡 ESSENTIAL RULES
════════════════════════════════════════════════════════════════════════════════

### 1. File Operations
- ✅ **`<edit>`** for existing files (modify specific parts)
- ✅ **`write_file`** for NEW files only
- ❌ NEVER use `write_file` to modify existing files

### 2. Code Completeness
- ✅ All code must be complete (no placeholders)
- ❌ No `// ... other imports ...` or `// ... component logic ...`
- ❌ No markdown code fences in `<content>` (```typescript```)

### 3. Path Handling
- ✅ Use exact absolute paths: `src/components/Button.tsx`
- ❌ No placeholders: `path/to/your/file.tsx`
- Path aliases (`@/components`) require tsconfig.json configuration

### 4. Edit Strategy
- Only put CHANGED code in `<replace>` block
- Include 3-5 lines of context for uniqueness
- Multiple edits execute top-to-bottom

### 5. XML Syntax
- All tags must be properly closed
- No extra whitespace in tag names
- Content goes directly inside tags (no markdown wrapping)

════════════════════════════════════════════════════════════════════════════════
## 🚫 COMMON MISTAKES (Quick Reference)
════════════════════════════════════════════════════════════════════════════════

| Mistake | Wrong | Correct |
|---------|-------|---------|
| Modifying existing file | `write_file` on existing | `<edit>` |
| Markdown in content | ` ```typescript\ncode\n``` ` | Raw code only |
| Placeholder paths | `path/to/file.tsx` | `src/components/Button.tsx` |
| Code placeholders | `// ... logic ...` | Complete implementation |
| Unclosed tags | Missing `</tool_use>` | All tags closed |
| Whitespace in search | Missing indentation | Exact match required |

════════════════════════════════════════════════════════════════════════════════

**Follow these rules for successful code application.**
