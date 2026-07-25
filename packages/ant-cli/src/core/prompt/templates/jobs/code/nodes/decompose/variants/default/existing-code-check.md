{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{> jobs/code/base/injections/existing-code-discipline}}

**Task Creation Principles:**
1. **Assume infrastructure exists**: package.json, tsconfig.json already present
2. **Action verbs matter**:
   - Use: "Fix", "Complete", "Extend", "Add to", "Update"
   - Avoid: "Create", "Implement from scratch", "Build complete"

**Task Description Principle:**

Descriptions define WHAT scope the task covers, not HOW it is implemented.

**Constraint**: When existing code is detected, descriptions use action verbs that acknowledge existing code ("Fix", "Extend", "Add to", "Complete") — not "Create" or "Implement from scratch".

**Constraint**: Do NOT include file paths, method signatures, or specific class names in descriptions. The Plan phase discovers those from the codebase.

{{#if clarifyActive}}
**Fresh-build conflict check:**

Judge the directive's relationship to the existing codebase. When ALL of the
following are observed — the directive's scope covers what already exists, AND
its framing requests a new application or starting over, AND it does not state
how the existing code should be treated — emit `<clarify>` (within the Clarify
Budget) asking whether to:
(a) extend/modify the existing codebase, or
(b) replace it — the breakdown then explicitly owns removal/overwrite of superseded code.

Do NOT ask when the directive is an incremental change, explicitly states
replacement or extension, or targets code unrelated to the existing project.
On "extend" → normal modification-mode decomposition. On "replace" → a setup
task is legitimate and superseded files are removed, not left to drift.
{{/if}}

**File Analysis:**
{{fileCount}} files detected in codebase:
```
{{fileList}}
```

⚠️ **These files EXIST. Don't create tasks to recreate them!**

════════════════════════════════════════════════════════════════════════════════

{{else}}

**NO EXISTING CODE DETECTED**

You are creating tasks for NEW implementation (no codebase).

════════════════════════════════════════════════════════════════════════════════

{{/if}}

