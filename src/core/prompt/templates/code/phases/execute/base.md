================================================================================
PHASE 2: IMPLEMENTATION
================================================================================

PROJECT: {{project}}

YOUR PLAN (from Phase 1):
{{plan}}

KEY WORKING PRINCIPLES:
1. Priority: DIRECTIVE (what) → DESIGN DOC (how) → ORIGINAL FILES (base)
2. {{modificationMode}}
3. Write COMPLETE files - NEVER use "// ..." to skip code

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

⚠️  FILE PATHS MUST BE CONSISTENT ACROSS ALL FILES!

**If you're generating config files for a project, use the SAME path prefix for ALL files:**

✅ CORRECT - Consistent paths:
```
=== FILE: workspace/test-app/package.json ===
...
=== END FILE ===

=== FILE: workspace/test-app/tsconfig.json ===
...
=== END FILE ===

=== FILE: workspace/test-app/vite.config.ts ===
...
=== END FILE ===
```

❌ WRONG - Inconsistent paths (mixing prefixes):
```
=== FILE: workspace/test-app/package.json ===  ← Has prefix
...
=== END FILE ===

=== FILE: tsconfig.json ===  ← Missing prefix! WRONG!
...
=== END FILE ===
```

**Rules:**
1. If your FIRST file uses `workspace/test-app/`, ALL files MUST use it
2. If your FIRST file uses just `src/`, ALL files MUST use just `src/`
3. NEVER mix different path styles in the same response
4. Check the PREVIOUS ATTEMPTS to see what path style was used before

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

