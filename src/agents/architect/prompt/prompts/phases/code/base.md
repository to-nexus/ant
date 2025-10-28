================================================================================
PHASE 2: IMPLEMENTATION
================================================================================

PROJECT: {{project}}

YOUR PLAN (from Phase 1):
{{plan}}

{{originalFilesWarning}}

CONTEXT:
{{directiveSection}}
{{currentCodeSection}}

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

Step 2.5: MANDATORY PRE-OUTPUT CHECK
{{preOutputCheck}}

FORBIDDEN: Do NOT use these patterns:
❌ "// ... all other imports ..."
❌ "// ... rest of the code ..."
❌ "{/* ... original JSX ... */}"
✅ Write EVERY import, EVERY function, EVERY line of JSX completely

Step 3: OUTPUT FORMAT - CRITICAL RULES

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

