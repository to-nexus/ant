# Code Execution Phase

You are implementing a specific task. Follow the instructions for your task type.

════════════════════════════════════════════════════════════════════════════════
{{#if designDoc}}
{{#if (eq modificationMode "MODIFICATION MODE: Copy original, then modify")}}
## 📋 DESIGN DOCUMENT (Architecture Reference)

**⚠️ CRITICAL: This design document is for REFERENCE ONLY!**

**YOU MUST:**
- ✅ Modify the EXISTING code below (see "EXISTING FILES" section)
- ✅ Keep the same architecture/patterns as existing code
- ✅ Use design document to understand the intended architecture
- ❌ DO NOT regenerate files from scratch
- ❌ DO NOT ignore existing code structure

**The design document explains the intended architecture. Your job is to MODIFY existing code to match the task, NOT recreate everything.**

────────────────────────────────────────────────────────────────────────────────

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────

**Remember: The code ALREADY EXISTS below. Your job is to MODIFY it, not rewrite it.**

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📋 DESIGN DOCUMENT (Implementation Guide)

**Follow this design document to create the project:**

{{designDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
{{/if}}

{{#if currentTask}}
{{#if (eq currentTask.type "setup")}}
{{#unless (eq currentTask.priority 1000)}}
## 🔧 SETUP TASK: Project Configuration

**Objective**: Create configuration files and install dependencies.

**What to create:**
- Configuration files: package.json, tsconfig.json, build tool configs
- Linter configs: .eslintrc, .prettierrc (if specified)
- `.gitignore` file
- Empty folder structure if needed (e.g., `src/`)

**What NOT to create:**
- ❌ Source code files (.ts, .tsx, .py, .go, etc.)
- ❌ Test files (*.test.*, *.spec.*)
- ❌ Test configuration (jest.config.js, vitest.config.ts, jest.setup.js)
- ❌ Test infrastructure files (setupTests.ts, test-utils.ts)
- ❌ Documentation beyond README.md
- ❌ Component/page/service files

**Important**: If task description mentions "testing libraries":
- ✅ Add them to package.json devDependencies
- ❌ DO NOT create jest.config.js, vitest.config.ts, or any test setup files
- Testing setup will be handled separately if needed

**Required Actions:**
1. Use `write_file` tool for each config file
2. Run dependency installation: `npm install` (or `pnpm install`, `yarn install`)
3. Output `<done>true</done>` when complete

**Mental Checks Before Output:**
- [ ] All dependencies in package.json are needed for the project
- [ ] tsconfig.json paths match the project structure
- [ ] Build tool config imports match package.json devDependencies
- [ ] No test config files (jest.config.js, vitest.config.ts) created

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
## 💻 FEATURE TASK: Source Code Implementation

**Objective**: Implement the feature described in the task. Code only, no validation.

🚨🚨🚨 **CRITICAL - READ THIS FIRST** 🚨🚨🚨

**YOU CANNOT:**
- ❌ Run `npm run build` (will fail - happens in final task)
- ❌ Run `npm run type-check` (will fail - happens in final task)
- ❌ Run `npm run lint` (will fail - happens in final task)
- ❌ Run `npm test` (will fail - happens in final task)
- ❌ Run any validation commands

**DO NOT try to verify your code works. Just implement and finish.**

────────────────────────────────────────────────────────────────────────────────

**What to create:**
- ✅ Application source code files ONLY
- ✅ Common locations: `src/`, `app/`, `pages/`, `lib/`, `components/`, `utils/`
- ✅ Monorepo: `packages/*/src/`, `apps/*/src/`
- ✅ File types: .ts, .tsx, .js, .jsx, .py, .go, .java, etc.

**What NOT to create:**
- ❌ `*.md` files (README, SUMMARY, IMPLEMENTATION, TASK_COMPLETE, docs/)
- ❌ `*.test.ts`, `*.spec.ts`, `*.stories.ts` files
- ❌ `__tests__/`, `tests/` directories
- ❌ `examples.ts`, `demo.ts` files
- ❌ Configuration files (package.json, tsconfig.json, vite.config.ts, etc.)
- ❌ `.eslintrc`, `.prettierrc`, `.gitignore`

**Actions:**
1. Create/modify source code files using `write_file` or `apply_patch` tools
2. Output `<done>true</done>` immediately when done
3. **NO summary, NO explanation** - system tracks everything automatically

────────────────────────────────────────────────────────────────────────────────

**Example Output (CORRECT):**
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

<done>true</done>
```

**That's it! No summary needed!**

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.priority 1000)}}
## ✅ FINAL VERIFICATION TASK: Build & Validate

**Objective**: Verify the entire project compiles successfully.

🚨🚨🚨 **CRITICAL - VALIDATION ORDER IS MANDATORY** 🚨🚨🚨

**YOU MUST EXECUTE IN THIS EXACT ORDER:**

**Step 1: Type-check FIRST** (fast, ~5-10s)
```xml
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npx tsc --noEmit</command>
  </parameters>
</tool_use>
```
❌ **FORBIDDEN**: Running build/lint before type-check passes
✅ **REQUIRED**: Fix all type errors before proceeding to Step 2

**Step 2: Lint SECOND** (fast, ~5-10s)
```xml
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npm run lint</command>
  </parameters>
</tool_use>
```
❌ **FORBIDDEN**: Running build before lint passes
✅ **REQUIRED**: Fix all lint errors before proceeding to Step 3

**Step 3: Build LAST** (slow, ~30-60s)
```xml
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npm run build</command>
  </parameters>
</tool_use>
```
✅ **ONLY run build after type-check AND lint both pass**

────────────────────────────────────────────────────────────────────────────────

**Why this order is MANDATORY:**

1. **Type errors** (tsc) catch 80% of issues in 5-10 seconds
2. **Lint errors** catch style/quality issues in 5-10 seconds  
3. **Build** is expensive (30-60s) - only run when type-check + lint are clean

❌ **Running build first wastes time**:
- Build takes 30-60s to fail
- Type-check would catch the same error in 5s
- You'll fix the error and waste another 30-60s rebuilding

────────────────────────────────────────────────────────────────────────────────

**When errors occur:**

```xml
<!-- Fix the error first -->
<edit path="src/path/to/file.ts">
<search>code with error</search>
<replace>fixed code</replace>
</edit>

<!-- Then re-run validation FROM THE FAILED STEP -->
<tool_use>
  <name>run_command</name>
  <parameters>
    <command>npx tsc --noEmit</command>
  </parameters>
</tool_use>
```

**Repeat until all validations pass**, then output `<done>true</done>`.

────────────────────────────────────────────────────────────────────────────────

**CHECKLIST - Before EVERY command:**

Before running `npm run build`:
- [ ] Did `npx tsc --noEmit` pass? (If not, run it first!)
- [ ] Did `npm run lint` pass? (If not, run it first!)
- [ ] Both passed? → NOW you can run build

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "error")}}
## 🔧 ERROR TASK: Fix Specific Issues

**Objective**: Fix the errors described in the task description.

**Actions:**
1. Read error messages in task description carefully
2. Fix ONLY the broken code - don't refactor or add features
3. For missing dependencies:
   ```xml
   <tool_use>
     <name>run_command</name>
     <parameters>
       <command>npm install package-name</command>
     </parameters>
   </tool_use>
   ```
4. For code errors:
   ```xml
   <edit path="src/path/to/file.ts">
   <search>buggy code</search>
   <replace>fixed code</replace>
   </edit>
   ```
5. You CAN run validation commands in error tasks:
   ```xml
   <tool_use>
     <name>run_command</name>
     <parameters>
       <command>npm run type-check</command>
     </parameters>
   </tool_use>
   ```
6. Output `<done>true</done>` when fixed

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

## 📂 EXISTING FILES

{{#if currentCode}}
**These files ALREADY EXIST in the working directory:**

{{currentCode}}

────────────────────────────────────────────────────────────────────────────────

{{#if currentTask}}
{{#if (or (eq currentTask.type "setup") (eq currentTask.type "error") (eq currentTask.priority 1000))}}
**Modification Rules:**
- ✅ MODIFY config files if needed (package.json, tsconfig.json, etc.)
- ✅ CREATE new source files for this task
- ✅ MODIFY existing files if this task requires changes
- ❌ DON'T regenerate files that don't need changes

{{else}}
**Feature Task Rules:**
- ✅ CREATE application code files (src/, app/, pages/, lib/, components/)
- ✅ MODIFY existing application code if needed
- ⚠️ Config files (package.json, tsconfig.json, etc.):
  - **Preferred:** Setup task handles config files
  - **BUT:** You CAN modify if absolutely necessary for this feature
  - **When allowed:** Adding missing dependencies, adding required plugins
  - **Keep minimal:** Only add what's strictly needed for this feature
- ❌ DON'T regenerate files that don't need changes

{{/if}}
{{/if}}

**Resumed Task**: If files from THIS task already exist above, SKIP them and continue with remaining work.

{{else}}
No existing files detected - this is a fresh project setup.
{{/if}}

════════════════════════════════════════════════════════════════════════════════

## 🔍 CONSISTENCY CHECKS (Mental Verification)

Before outputting, mentally verify these consistency requirements:

### 1. package.json ↔ Config Files
- Every import in vite.config.ts must be in package.json devDependencies
- Example: `import react from '@vitejs/plugin-react'` → needs `"@vitejs/plugin-react": "^4.0.0"`

### 2. Import Paths ↔ tsconfig.json
- If using `@/components`, ensure tsconfig.json has:
  ```json
  "paths": { "@/*": ["./src/*"] }
  ```
- Path aliases must match in tsconfig.json AND build tool config

### 3. Dependency Versions
- Vite 5.x → `@vitejs/plugin-react@^4.0.0`
- Next.js 14.x → `react@^18.0.0`
- Check peer dependency requirements

**DO NOT run commands to verify! Just mentally check before outputting.**

════════════════════════════════════════════════════════════════════════════════

**For XML tag syntax and output format details, see execute/rules.md**
