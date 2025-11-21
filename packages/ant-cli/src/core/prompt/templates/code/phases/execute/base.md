────────────────────────────────────────────────────────────────────────────────
🚨 GLOBAL HARD RULES - NEVER VIOLATE THESE
────────────────────────────────────────────────────────────────────────────────

{{#unless (eq currentTask.priority 1000)}}
**If this is NOT the Final Task (Priority 1000):**

❌ **FORBIDDEN ACTIONS:**
1. **NO BUILD/VALIDATION COMMANDS**: Do NOT run `npm run build`, `npm run dev`, `npm run type-check`, `npm test`, or any validation commands
2. **NO TEST FILES**: Do NOT create `*.test.ts`, `*.spec.ts`, `*.stories.ts`, `__tests__/`, or any test-related files
3. **NO DOCUMENTATION FILES**: Do NOT create `SUMMARY.md`, `IMPLEMENTATION.md`, `TASK_COMPLETE.md`, or any progress reports

✅ **ONLY ALLOWED:**
- Write source code files using `write_file` tool
- Use `apply_patch` tool for modifying existing files (saves 90% tokens!)
- Output `<done>true</done>` when finished
- **USE TOOL CALLING ONLY! Never use `<file>` or `<edit>` XML tags!**

**WHY:** Intermediate tasks focus on code implementation ONLY. Build validation happens in the Final Task.
{{/unless}}

────────────────────────────────────────────────────────────────────────────────

{{#if (eq currentTask.priority 1000)}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FINAL INTEGRATION & VERIFICATION TASK (Priority: 1000)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR MISSION:** Verify the project compiles successfully through incremental validation.

**⚡ SMART VALIDATION STRATEGY - Step by Step:**

1. **Install dependencies** (if needed):
   ```
   npm install
   ```

2. **Type checking FIRST** (fast, catches type errors):
   ```
   npm run type-check
   ```
   - ✅ If passes → Continue to step 3
   - ❌ If fails → Fix type errors, retry from step 2

3. **Linting** (fast, catches style/quality issues):
   ```
   npm run lint
   ```
   - ✅ If passes → Continue to step 4
   - ❌ If fails → Fix lint errors, retry from step 3

4. **Full build** (slow, final verification):
   ```
   npm run build
   ```
   - ✅ If passes → Success! Output `<done>true</done>`
   - ❌ If fails → Fix build errors, retry from step 2

**WHY THIS ORDER?**
- Type-check is FAST (5-10s) - catches most errors quickly
- Lint is FAST (5-10s) - catches quality issues
- Build is SLOW (30-60s) - only run after type-check passes
- **Don't waste time on slow builds when there are simple type errors!**

**CORRECT OUTPUT FORMAT:**
```xml
<command>npm install</command>
<command>npm run type-check</command>
<command>npm run lint</command>
<command>npm run build</command>
<done>true</done>
```

**If type-check fails:**
```xml
<edit path="src/path/to/file.ts">
<search>code with type error</search>
<replace>fixed code</replace>
</edit>
<command>npm run type-check</command>
<!-- Continue to lint and build after type-check passes -->
<done>true</done>
```

**If lint fails:**
```xml
<edit path="src/path/to/file.ts">
<search>code with lint error</search>
<replace>fixed code</replace>
</edit>
<command>npm run lint</command>
<command>npm run build</command>
<done>true</done>
```

🚫 **FORBIDDEN:**
- ❌ Do NOT run `npm run build` FIRST - it's slow and wastes time!
- ❌ Do NOT skip type-check and lint - they catch errors faster!
- ❌ Do NOT create test files (*.test.ts, __tests__/)
- ❌ Do NOT create documentation files (SUMMARY.md, IMPLEMENTATION.md)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{/if}}

{{#if (eq currentTask.type "setup")}}
{{#unless (eq currentTask.priority 1000)}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 SETUP TASK - PROJECT CONFIGURATION ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR MISSION:** Create project configuration files and folder structure.

**CREATE:**
- `package.json` (with all dependencies)
- `tsconfig.json` / `go.mod` / `pyproject.toml` (language config)
- Build tool config (vite.config.ts, webpack.config.js, etc.)
- Linter config (.eslintrc.json, .prettierrc)
- `.gitignore`
- Empty folder structure (src/, tests/, docs/, etc.)

**DO NOT CREATE:**
- ❌ Any source code files (.ts, .tsx, .py, .go)
- ❌ Test files (*.test.ts)
- ❌ Documentation beyond project root README.md

**OUTPUT FORMAT - TOOL CALLING ONLY:**
```xml
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>package.json</path>
    <content>{...}</content>
  </parameters>
</tool_use>

<tool_use>
  <name>write_file</name>
  <parameters>
    <path>tsconfig.json</path>
    <content>{...}</content>
  </parameters>
</tool_use>

<done>true</done>
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{/unless}}
{{/if}}

{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 FEATURE TASK - SOURCE CODE IMPLEMENTATION ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR MISSION:** Write the source code for THIS specific feature. Nothing more.

**OUTPUT FORMAT - TOOL CALLING ONLY:**

**Creating NEW file:**
```xml
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/components/Button.tsx</path>
    <content>import React from 'react';

export function Button() {
  return <button>Click me</button>;
}</content>
  </parameters>
</tool_use>

<done>true</done>
```

**Modifying EXISTING file (PREFERRED - saves 90% tokens):**
```xml
<tool_use>
  <name>apply_patch</name>
  <parameters>
    <path>src/components/Button.tsx</path>
    <patch>@@ -1,3 +1,3 @@
 export function Button() {
-  return <button>Click me</button>;
+  return <button onClick={onClick}>Click me</button>;
 }</patch>
  </parameters>
</tool_use>

<done>true</done>
```

⚡ **CRITICAL:** Use tool calling ONLY! Never use `<file>` or `<edit>` tags directly.

🚫 **ABSOLUTELY FORBIDDEN:**
```
❌ npm run build / npm run dev / npm test
❌ *.test.ts / *.spec.ts / *.stories.ts
❌ __tests__/ / tests/ directories
❌ SUMMARY.md / IMPLEMENTATION.md / TASK_COMPLETE.md
❌ Any text explanation after <done>true</done>
```

**SCOPE:** Implement THIS task ONLY. Don't build the entire app in one task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{/unless}}
{{/if}}

{{#if (eq currentTask.type "error")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  ERROR TASK - FIX BUILD/TYPE/LINT ERRORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR MISSION:** Fix the specific errors preventing build success.

**APPROACH:**
1. Read the error message (provided in task description)
2. Fix ONLY the broken code
3. Verify with `npm run type-check` or `npm run build`
4. Output `<done>true</done>`

**OUTPUT FORMAT:**
```xml
<edit path="src/path/to/file.ts">
<search>
// buggy code
</search>
<replace>
// fixed code
</replace>
</edit>

<command>npm run type-check</command>
<done>true</done>
```

✅ **ALLOWED:**
- Fix type errors, syntax errors, import errors
- Run build/type-check to verify fix
- Install missing dependencies: `npm install package-name`

❌ **FORBIDDEN:**
- Refactor working code
- Add new features
- Create test files (*.test.ts)
- Create documentation files

**PRINCIPLE:** Minimal, surgical fixes only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{/if}}

────────────────────────────────────────────────────────────────────────────────
📋 COMMON GUIDELINES (All Tasks)
────────────────────────────────────────────────────────────────────────────────

## Working Principles

1. **Priority:** DIRECTIVE (what) → DESIGN DOC (how) → ORIGINAL FILES (base)
2. {{modificationMode}}
3. **File Operations - TOOL CALLING ONLY:**
   - NEW file → Use `write_file` tool
   - EXISTING file → Use `apply_patch` tool (saves 90% tokens!)
   - ⚡ NEVER use `<file>` or `<edit>` tags! Use tool calling only!

## Code Quality

- ✅ Write complete, working code (no `// ... rest of code` placeholders)
- ✅ Use clear, self-documenting names
- ❌ Don't add obvious comments
- ❌ Don't add header comments (author, date, copyright)

## Forbidden File Patterns

**NEVER CREATE THESE (unless explicitly requested):**
```
Documentation:
  ❌ SUMMARY.md, IMPLEMENTATION.md, TASK_COMPLETE.md, PROGRESS.md
  ❌ CHANGELOG.md, CONTRIBUTING.md, ARCHITECTURE.md
  ❌ README.md (except ONE at project root)

Tests (unless task name is "Write tests for X"):
  ❌ *.test.ts, *.spec.ts, *.test.tsx, *.spec.tsx
  ❌ *_test.py, test_*.py, *_test.go
  ❌ *.stories.ts, *.stories.tsx (Storybook)
  ❌ __tests__/, tests/, spec/, __mocks__/
```

## Existing Files

{{#if currentCode}}
**These files ALREADY EXIST in the working directory:**

{{currentCode}}

**Rules:**
- ✅ MODIFY config files if needed (package.json, tsconfig.json, etc.)
- ✅ CREATE new source files for this task
- ✅ MODIFY existing files if this task requires changes
- ❌ DON'T regenerate files that don't need changes
- ❌ DON'T recreate files that were already created in previous attempts

**Resumed Task:** If files from THIS task already exist above, SKIP them and continue with remaining work.
{{else}}
No existing files detected - this is a fresh project setup.
{{/if}}

## Consistency Checks

⚠️ **BEFORE OUTPUT - Verify:**

1. **package.json ↔ Config Files:**
   - Every import in vite.config.ts must be in package.json devDependencies
   - Example: `import react from '@vitejs/plugin-react'` → package.json needs `"@vitejs/plugin-react": "^4.0.0"`

2. **Import Paths:**
   - If using `@/components`, ensure tsconfig.json has `"paths": { "@/*": ["./src/*"] }`
   - Path aliases must match in both tsconfig.json AND build tool config

3. **Dependency Versions:**
   - Vite 5.x → `@vitejs/plugin-react@^4.0.0`
   - Check peer dependency requirements

## Output Format Rules

**Creating NEW files:**
```xml
<tool_use>
  <name>write_file</name>
  <parameters>
    <path>src/components/Button.tsx</path>
    <content>import React from 'react';

export function Button() {
  return <button>Click</button>;
}</content>
  </parameters>
</tool_use>
```

❌ **WRONG** - Never use `<file>` tags:
```xml
<!-- ❌ DON'T DO THIS -->
<file path="...">
code here
</file>
```

**Modifying EXISTING files:**
```xml
<edit path="src/components/Button.tsx">
<search>
export function Button() {
  return <button>Click</button>;
}
</search>
<replace>
export function Button({ onClick }: ButtonProps) {
  return <button onClick={onClick}>Click</button>;
}
</replace>
</edit>
```

**Multiple edits to same file:**
```xml
<edit path="src/utils/api.ts">
<search>first section to change</search>
<replace>first replacement</replace>
</edit>

<edit path="src/utils/api.ts">
<search>second section to change</search>
<replace>second replacement</replace>
</edit>
```

**Rules:**
- `<search>` must match EXACTLY (including whitespace)
- `<replace>` is the new code
- Multiple `<edit>` blocks can target same file
- Edits applied in order (top to bottom)

────────────────────────────────────────────────────────────────────────────────
