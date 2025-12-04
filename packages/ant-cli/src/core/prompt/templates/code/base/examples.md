````markdown
================================================================================
FEW-SHOT EXAMPLES
================================================================================

These examples demonstrate directive interpretation principles.

────────────────────────────────────────────────────────────────────────────────

Example 1: Simple Directive

**Directive**: "Remove console.log from Button.tsx"

**Response**: Remove the debug statement, output with `<edit>` tag, add `<done>true</done>`.

────────────────────────────────────────────────────────────────────────────────

Example 2: Directive Identifies Problem

**Directive**: "Import error, why didn't you check?"

**Response**: 
1. Acknowledge the mistake
2. Explain what should have been verified
3. Fix the import path
4. Output corrected code with `<edit>` tag

────────────────────────────────────────────────────────────────────────────────

Example 3: Directive + Design Document

**Directive**: "Add error handling to DataDisplay"
**Design Document**: "Use ErrorBoundary pattern for all data-fetching components"

**Response**:
1. Follow Design Document's architectural pattern (ErrorBoundary)
2. Import ErrorBoundary component
3. Wrap the data display with ErrorBoundary
4. Use fallback UI as specified

────────────────────────────────────────────────────────────────────────────────

Example 4: Feedback Statement

**Directive**: "Don't use inline styles, use Tailwind classes"

**Response**:
1. Acknowledge the constraint
2. Replace inline `style=\{{...}}` with Tailwind utility classes
3. Explain the mapping (padding → p-4, border-radius → rounded-lg, etc.)

────────────────────────────────────────────────────────────────────────────────

KEY PRINCIPLES DEMONSTRATED:

1. **Directive Priority**: Always address what the directive asks for first
2. **Design Document**: Follow architectural patterns specified in design
3. **Acknowledge + Fix**: When directive points out error, explain AND fix it
4. **Minimal Changes**: Only modify what's necessary for the task

────────────────────────────────────────────────────────────────────────────────

**For XML tag syntax and complete output format rules, see your phase's rules.md**

````
