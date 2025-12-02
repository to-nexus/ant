# Output Format Rules

{{> code/base/injections/text-format-compact}}

════════════════════════════════════════════════════════════════════════════════
## 🎯 XML TAG REFERENCE
════════════════════════════════════════════════════════════════════════════════

### Tool Use: Creating New Files & Running Commands

**Syntax:**
```xml
<tool_use>
  <name>TOOL_NAME</name>
  <parameters>
    <param_name>value</param_name>
  </parameters>
</tool_use>
```

**Tool 1: write_file** - Create a new file
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

**Tool 2: run_command** - Execute shell command
```xml
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npm install</command>
  </parameters>
</tool_use>
```

**Tool 3: apply_patch** - Apply multiple edits (advanced)
```xml
<tool_use>
  <name>apply_patch</name>
  <parameters>
    <path>src/App.tsx</path>
    <patch>diff format patch content</patch>
  </parameters>
</tool_use>
```

────────────────────────────────────────────────────────────────────────────────

### Edit: Modifying Existing Files

**Syntax:**
```xml
<edit path="file/path">
<search>exact code to find</search>
<replace>new code</replace>
</edit>
```

**Example 1: Add import**
```xml
<edit path="src/pages/MainPage.tsx">
<search>
import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
</search>
<replace>
import { useState, useEffect } from 'react';
import { TabMenu } from '@/components/TabMenu';
import { Header } from '@/components/Header';
</replace>
</edit>
```

**Example 2: Modify function**
```xml
<edit path="src/components/Button.tsx">
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
<replace>
export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click</button>;
}
</replace>
</edit>
```

**Example 3: Multiple edits to same file**
```xml
<edit path="src/App.tsx">
<search>
import { Header } from './components/Header';
</search>
<replace>
import { Header } from './components/Header';
import { Footer } from './components/Footer';
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

**Output this when your task is complete.**

For feature tasks, output ONLY code + `<done>true</done>` - NO summary!

════════════════════════════════════════════════════════════════════════════════
## ⚠️ CRITICAL: `<search>` BLOCK RULES
════════════════════════════════════════════════════════════════════════════════

**The `<search>` block must match EXACTLY including:**
- ✅ Whitespace (spaces, tabs)
- ✅ Line breaks
- ✅ Comments
- ✅ All characters

**Example - This WORKS:**
```xml
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
```

**Example - This FAILS:**
```xml
<search>
export function Button() {
return <button>Click</button>;
}
</search>
```
❌ Missing indentation on `return` statement

**Example - This FAILS:**
```xml
<search>
export function Button(){
  return <button>Click</button>;
}
</search>
```
❌ Missing space before `{` in function declaration

────────────────────────────────────────────────────────────────────────────────

### How to Get `<search>` Right

1. **Copy EXACTLY from ORIGINAL FILES section** (if file exists)
2. **Include enough context** to make the search unique
3. **Test mentally**: Would this pattern appear multiple times? If yes, add more context.

**BAD - Too vague:**
```xml
<search>
return <button>Click</button>;
</search>
```
(Might match multiple buttons)

**GOOD - Specific context:**
```xml
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
```
(Unique to this function)

════════════════════════════════════════════════════════════════════════════════
## 💡 TIPS FOR SUCCESS
════════════════════════════════════════════════════════════════════════════════

### Tip 1: **ALWAYS use `<edit>` for existing files**
- `<edit>` is more efficient - shows only changes
- `<edit>` helps reviewers see what changed
- `<edit>` reduces token usage
- **Use `write_file` ONLY for completely NEW files that don't exist yet**
- ❌ **NEVER use `write_file` to modify existing files**

### Tip 2: For modifications, copy from ORIGINAL FILES
- Don't trust your memory for exact formatting
- Copy the exact code from the ORIGINAL FILES section
- Include 3-5 lines of context before and after the change

### Tip 3: Only put CHANGED code in `<replace>`
```xml
<!-- ❌ WRONG - includes unchanged code -->
<search>
function foo() {
  const x = 1;
  const y = 2;
  return x + y;
}
</search>
<replace>
function foo() {
  const x = 1;
  const y = 2;
  const z = 3;  // Added this
  return x + y + z;  // Changed this
}
</replace>

<!-- ✅ CORRECT - only changed section -->
<search>
  const y = 2;
  return x + y;
}
</search>
<replace>
  const y = 2;
  const z = 3;
  return x + y + z;
}
</replace>
```

### Tip 4: Path aliases require configuration
- `@/components` → needs tsconfig.json `"paths": { "@/*": ["./src/*"] }`
- `~/utils` → needs tsconfig.json + build tool config
- Relative imports `./Button` → always work, no config needed

### Tip 5: Multiple edits apply in order
If you have multiple `<edit>` blocks for the same file:
- They execute top-to-bottom
- Each edit sees the result of previous edits
- Plan your edits accordingly

════════════════════════════════════════════════════════════════════════════════
## 🚫 COMMON MISTAKES TO AVOID
════════════════════════════════════════════════════════════════════════════════

❌ **MISTAKE 1**: Using `write_file` to modify existing files
```xml
<!-- WRONG - File already exists, should use <edit> -->
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/App.tsx</path>
    <content>// entire file content...</content>
  </parameters>
</tool_use>

<!-- CORRECT -->
<edit path="src/App.tsx">
<search>existing code</search>
<replace>new code</replace>
</edit>
```

❌ **MISTAKE 2**: Wrapping file content in markdown
```xml
<!-- WRONG -->
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/Button.tsx</path>
    <content>```typescript
export function Button() {}
```</content>
  </parameters>
</tool_use>

<!-- CORRECT -->
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/Button.tsx</path>
    <content>export function Button() {}</content>
  </parameters>
</tool_use>
```

❌ **MISTAKE 3**: Placeholder paths
```xml
<!-- WRONG -->
<edit path="path/to/your/file.tsx">

<!-- CORRECT -->
<edit path="src/components/Button.tsx">
```

❌ **MISTAKE 4**: Using "..." or placeholders
```xml
<!-- WRONG -->
<content>
import React from 'react';
// ... other imports ...

export function App() {
  // ... component logic ...
}
</content>

<!-- CORRECT -->
<content>
import React from 'react';
import { Header } from './Header';
import { Footer } from './Footer';

export function App() {
  return (
    <div>
      <Header />
      <Footer />
    </div>
  );
}
</content>
```

❌ **MISTAKE 5**: Not closing XML tags
```xml
<!-- WRONG -->
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>file.ts</path>
    <content>code</content>
  </parameters>
<!-- Missing </tool_use> -->

<!-- CORRECT -->
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>file.ts</path>
    <content>code</content>
  </parameters>
</tool_use>
```

════════════════════════════════════════════════════════════════════════════════

**If you follow these rules, your code will be applied successfully!**
