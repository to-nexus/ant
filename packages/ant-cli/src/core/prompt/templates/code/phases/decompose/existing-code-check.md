{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

**MODIFICATION MODE: The code ALREADY EXISTS!**

**Task Creation Principles:**
1. **Build on existing**: Modify/extend what exists, don't recreate
2. **Assume infrastructure exists**: package.json, tsconfig.json already present
3. **Action verbs matter**:
   - Use: "Fix", "Complete", "Extend", "Add to", "Update"
   - Avoid: "Create", "Implement from scratch", "Build complete"

**Missing Files ≠ Setup Task:**
- Error "entry point missing" → Feature task to add missing file
- NOT → Setup task to rebuild infrastructure
- Principle: Fix the gap, don't rebuild the foundation

**Task Description Principle:**

Descriptions define WHAT scope the task covers, not HOW it is implemented.

**Constraint**: When existing code is detected, descriptions use action verbs that acknowledge existing code ("Fix", "Extend", "Add to", "Complete") — not "Create" or "Implement from scratch".

**Constraint**: Do NOT include file paths, method signatures, or specific class names in descriptions. The Plan phase discovers those from the codebase.

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

