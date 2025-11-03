================================================================================
PHASE 2: IMPLEMENTATION
================================================================================

PROJECT: {{project}} 

YOUR PLAN (from Phase 1):
{{plan}}

{{#if currentTask}}
🎯 YOUR SPECIFIC TASK (Focus on THIS ONLY!)
────────────────────────────────────────────────────────────────────────────────
**Task Name**: {{currentTask.name}}
**Task Type**: {{currentTask.type}}
**Description**: {{currentTask.description}}

{{#if (eq currentTask.name "Final Integration & Verification")}}
🚨 CRITICAL: THIS IS A FINAL BUILD VERIFICATION & FIX TASK!
────────────────────────────────────────────────────────────────────────────────

**YOUR ROLE**: Final verification + minimal fixes to ensure build success

**PRIMARY GOAL**: Make the build succeed with minimal necessary changes

**WHAT YOU CAN DO**:
✅ Make MINIMAL code changes to fix build errors
✅ Fill in empty/stub implementations that prevent build
✅ Fix import errors, missing exports
✅ Add minimal type definitions to resolve type errors
✅ Complete incomplete implementations (e.g., empty function bodies)

**WHAT YOU MUST NOT DO**:
❌ DO NOT write test files or test code
❌ DO NOT write documentation (README, CHANGELOG, etc.)
❌ DO NOT add features beyond what's needed for build
❌ DO NOT create verification checklists or similar docs
❌ DO NOT make major refactoring changes

**MINIMAL CHANGES PRINCIPLE**:
- Change ONLY what's necessary for build success
- Do NOT re-write working code
- Do NOT add "nice-to-have" features
- Keep changes surgical and targeted

**IF NO ERRORS FOUND**:
- Output ZERO FILES (build already works!)
- Report success in RESPONSE section

**IF ERRORS FOUND**:
- Fix ONLY the specific errors preventing build
- Output ONLY the files that need changes
- Keep changes minimal

**RESPONSE FORMAT**:
```
=== THINKING ===
(Analyze build state, identify specific errors if any)
=== END THINKING ===

=== RESPONSE ===
Build Status: [Success/Errors Found]
(If errors: List specific errors and your fix strategy)
(If success: Confirmation message)
=== END RESPONSE ===

(Files section: ONLY if fixes needed, otherwise EMPTY)
```

────────────────────────────────────────────────────────────────────────────────
{{else}}
⚠️  CRITICAL INSTRUCTIONS:
- Work on THIS SPECIFIC TASK ONLY - do not implement other features
- Do not try to implement the entire project
- Focus only on what is needed for THIS ONE TASK
- Other tasks will be handled in separate iterations

If this task is "Implement Task Input Component" → Create ONLY TaskInput component
If this task is "Implement Task Item Component" → Create ONLY TaskItem component
Do NOT create the entire application in one task!
{{/if}}
────────────────────────────────────────────────────────────────────────────────
{{/if}}

KEY WORKING PRINCIPLES:
1. Priority: DIRECTIVE (what) → DESIGN DOC (how) → ORIGINAL FILES (base)
2. {{modificationMode}}
3. Write COMPLETE files - NEVER use "// ..." to skip code

⚠️  CRITICAL: EXISTING FILES IN WORKING DIRECTORY
{{#if currentCode}}
The following files ALREADY EXIST in the working directory:

{{currentCode}}

**RULES FOR EXISTING FILES:**

**1. Configuration Files (package.json, tsconfig.json, vite.config.ts, etc.)**
- ✅ DO: MODIFY (add/update) if needed for this task
- ❌ DON'T: Regenerate the ENTIRE file from scratch
- ✅ PRESERVE: All existing content and add only what's needed
- ❌ DON'T: Remove existing dependencies/config that other tasks added

**Example - CORRECT (Modifying package.json):**
```json
{
  "dependencies": {
    "react": "^18.2.0",           // ← Existing (preserve)
    "react-dom": "^18.2.0",       // ← Existing (preserve)
    "@radix-ui/react-dialog": "^1.0.5"  // ← NEW (add for this task)
  }
}
```

**Example - WRONG (Regenerating from scratch):**
```json
{
  "dependencies": {
    "@radix-ui/react-dialog": "^1.0.5"  // ❌ Lost react, react-dom!
  }
}
```

**2. Source Files (src/*)**
- ✅ DO: Create NEW files for this task
- ✅ DO: Modify existing files if this task requires changes
- ❌ DON'T: Recreate files that already exist and don't need changes
- ✅ DO: Import from and reference existing files

**3. Documentation/Static Files (README, HTML, etc.)**

❌ **NEVER REGENERATE THESE FILES** (unless explicitly required by task):
- `README.md` - Project documentation
- `index.html` - HTML entry point
- `.gitignore` - VCS configuration
- `LICENSE` - Legal documentation

✅ **ONLY regenerate if:**
- Task name explicitly mentions updating these files (e.g., "Update README")
- These files are MISSING and this is a setup/initialization task
- Critical error in these files that blocks the project

🎯 **Why**: These files are project-wide documentation. Each feature task should NOT "improve" or "update" them with task-specific details.

**4. General Rule:**
- ✅ FOCUS: Generate ONLY the files that THIS TASK needs to create/modify
- ❌ DON'T: Output files that already exist unchanged
- ❌ DON'T: "Improve" documentation files unless that's your explicit task
{{else}}
No existing files detected - this is a fresh project setup.
{{/if}}

================================================================================
EXECUTION PROTOCOL
================================================================================

Step 1: UNDERSTAND THE DIRECTIVE (if exists)
Directives often combine multiple intents:
- "Why did you X?" = Explain + Fix X
- "This causes error" = Acknowledge + Fix error
- "Don't do Y" = Acknowledge + Apply rule

→ If directive exists: Start with RESPONSE section (answer + acknowledgment)
→ Then output the FIXED code

Step 2: IMPLEMENT EXACTLY AS PLANNED
→ Follow your plan from Phase 1
→ Stay focused on the primary task
→ Don't add unplanned features

FORBIDDEN: Do NOT use these patterns:
❌ "// ... all other imports ..."
❌ "// ... rest of the code ..."
❌ "{/* ... original JSX ... */}"
✅ Write EVERY import, EVERY function, EVERY line of JSX completely

Step 3: CONSISTENCY CHECKS - CRITICAL

⚠️  BEFORE YOU OUTPUT: Verify consistency across all files!

**Rule 1: package.json ↔ Config Files Consistency**
If you create/modify vite.config.ts, webpack.config.js, or similar:
- Check ALL imports in that config file
- ENSURE every imported package is in package.json dependencies/devDependencies

Example:
```typescript
// vite.config.ts
import react from '@vitejs/plugin-react';  // ← Need this in package.json!
```
```json
// package.json - MUST include:
{
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0"  // ← REQUIRED!
  }
}
```

**Rule 2: Import Path Consistency**
- If you import from '@/components', baseUrl must be configured in tsconfig.json
- If you use path aliases, they must match in both vite.config.ts AND tsconfig.json

**Rule 3: Dependency Version Compatibility**
- Vite 5.x → use @vitejs/plugin-react@^4.0.0
- Vite 4.x → use @vitejs/plugin-react@^3.0.0
- Check peer dependency requirements!

Step 4: FILE PATH RULES - CRITICAL

⚠️  USE REPOSITORY-RELATIVE PATHS ONLY!

**CRITICAL: File paths must be relative to the TARGET REPOSITORY ROOT, NOT the workspace directory!**

The system writes files to the TARGET REPOSITORY configured in config.json (e.g., /Users/probe/dev/test-app).
You must provide paths relative to THAT repository, NOT relative to the workspace folder structure.

✅ CORRECT - Repository-relative paths:
```
=== FILE: package.json ===
{
  "name": "test-app",
  "version": "1.0.0"
}
=== END FILE ===

=== FILE: src/components/Header.tsx ===
import React from 'react';
export function Header() { ... }
=== END FILE ===

=== FILE: vite.config.ts ===
import { defineConfig } from 'vite';
export default defineConfig({ ... });
=== END FILE ===
```

❌ WRONG - Including workspace path in file names:
```
=== FILE: workspace/test-app/package.json ===  ← WRONG! Don't include workspace path!
...
=== END FILE ===

=== FILE: /Users/probe/dev/test-app/src/Header.tsx ===  ← WRONG! Don't use absolute paths!
...
=== END FILE ===
```

**Rules:**
1. **ALWAYS use paths relative to the target repository root**
2. **NEVER include "workspace/" prefix in file paths**
3. **NEVER use absolute paths** (e.g., /Users/probe/...)
4. Examples: `package.json`, `src/App.tsx`, `public/index.html`
5. The file writer handles the actual disk location automatically

Step 5: OUTPUT FORMAT - CRITICAL RULES

✅ CORRECT - Pure source code:
=== FILE: [actual/path/to/Button.tsx] ===
import React from 'react';

export function Button({ label }: { label: string }) {
  return <button>{label}</button>;
}
=== END FILE ===

❌ WRONG - Markdown formatting:
=== FILE: [actual/path/to/Button.tsx] ===
\`\`\`typescript
import React from 'react';
\`\`\`
=== END FILE ===

