# Code Execution Phase

You are implementing a specific task. Follow the instructions for your task type.

════════════════════════════════════════════════════════════════════════════════

{{#if (eq currentTask.type "explain")}}
## 💡 EXPLAIN TASK: Code Explanation

**Objective**: Provide a clear, comprehensive explanation of the code.

🚨 **CRITICAL - EXPLAIN MODE RULES** 🚨

**YOU MUST:**
- ✅ Write a clear Markdown explanation
- ✅ Explain what the code does, how it works, and why
- ✅ Include code examples if helpful
- ✅ Use proper formatting (headings, lists, code blocks)
- ✅ Output `<done>true</done>` when complete

**YOU MUST NOT:**
- ❌ Use `<tool_use>` - NO file creation
- ❌ Use `<edit>` - NO file modification
- ❌ Use `run_command` - NO command execution
- ❌ Make ANY changes to the codebase

**Example Output:**

```markdown
# Button Component Explanation

## Overview
The Button component is a reusable React component that provides...

## Props
- `children`: ReactNode - The button's content
- `onClick`: () => void - Click handler function

## Usage Example
\`\`\`tsx
<Button onClick={() => alert('clicked')}>
  Click me
</Button>
\`\`\`

## Implementation Details
The component uses Tailwind CSS for styling...
```

<done>true</done>

════════════════════════════════════════════════════════════════════════════════
{{else}}

{{#if designDoc}}
{{#if (eq modificationMode "MODIFICATION MODE: Modify existing code")}}
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

{{> code/base/injections/design-document-guide}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
{{/if}}

{{#if currentTask}}
{{#if (eq currentTask.type "setup")}}
{{#unless (eq currentTask.priority 1000)}}
## 🔧 SETUP TASK: Project Configuration

Create config files only. NO source code, NO tests.

**Create:** package.json, tsconfig.json, build configs, .gitignore
**Actions:** Write files → Run `npm install` → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
## 💻 FEATURE TASK: Source Code Implementation

Implement the feature. Source code only.

**Create:** .ts, .tsx, .js, .jsx files in `src/`, `app/`, `components/`, etc.
**DON'T create:** *.md, *.test.*, config files
**Actions:** Write/edit code → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.priority 1000)}}
## ✅ FINAL VERIFICATION: Build & Validate

🚨 **EXECUTE IN ORDER:** Type-check → Lint → Build

1. `npx tsc --noEmit` (fix all type errors first)
2. `npm run lint` (fix all lint errors)
3. `npm run build` (only after 1 & 2 pass)

**Why this order:**

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

🚨 **CRITICAL - COMMAND RESTRICTIONS** 🚨

**❌ NEVER USE THESE COMMANDS (they never exit):**
```
npm run dev         ❌ Dev server runs forever
npm start           ❌ Server runs forever
npm run serve       ❌ Server runs forever
node server.js      ❌ Server runs forever
nodemon            ❌ Watcher runs forever
```

**✅ ONLY USE THESE COMMANDS (they exit immediately):**
```
npm run build       ✅ Compiles and exits
npm run type-check  ✅ Validates and exits
npm run lint        ✅ Checks and exits
npm test            ✅ Tests and exits
npx tsc --noEmit    ✅ Type checks and exits
npm install [pkg]   ✅ Installs and exits
```

**Why?** Dev servers never exit - they'll hang for 10 minutes until timeout.
Always use build/test commands for verification.

────────────────────────────────────────────────────────────────────────────────

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
5. **For verification, use build commands (NOT dev servers):**
   ```xml
   <tool_use>
     <name>run_command</name>
     <parameters>
       <command>npm run build</command>
     </parameters>
   </tool_use>
   ```
6. Output `<done>true</done>` when fixed

{{/if}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if referenceRequests}}
## 📚 REFERENCE PROJECTS (Available for search_reference_code tool)

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

**CRITICAL:** You may ONLY search these reference projects listed above.
- Use `search_reference_code` tool ONLY for these projects
- Read-only access
- If you need a project NOT listed above, you CANNOT access it

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📚 REFERENCE PROJECTS

**NONE available.** Do NOT use `search_reference_code` tool.
All required information is in the current project codebase or design documents above.

════════════════════════════════════════════════════════════════════════════════
{{/if}}

## 📂 EXISTING FILES

{{#if currentCode}}
**These files ALREADY EXIST in the working directory:**

{{currentCode}}

────────────────────────────────────────────────────────────────────────────────

**Modify only what's needed. Skip files that don't need changes.**

{{else}}
No existing files detected - this is a fresh project setup.
{{/if}}

════════════════════════════════════════════════════════════════════════════════

**For XML tag syntax and output format details, see execute/rules.md**
