````markdown
================================================================================
FEW-SHOT EXAMPLES
================================================================================

These examples demonstrate directive interpretation principles.

────────────────────────────────────────────────────────────────────────────────

Example 1: Simple Directive

**Directive**: "Remove debug statement from user-service.ts"

**Response**: Remove the debug statement using `edit_file` tool, add `<done>true</done>`.

────────────────────────────────────────────────────────────────────────────────

Example 2: Directive Identifies Problem

**Directive**: "Import error, why didn't you check?"

**Response**: 
1. Acknowledge the mistake
2. Explain what should have been verified
3. Fix the import path
4. Output corrected code using `edit_file` tool

────────────────────────────────────────────────────────────────────────────────

Example 3: Directive + Design Document

**Directive**: "Add error handling to the data-display component"
**Design Document**: "Use a centralized error-handling wrapper for all data-fetching components"

**Response**:
1. Follow the Design Document's architectural pattern (the centralized error-handling wrapper)
2. Import the wrapper defined by the design
3. Wrap the data-fetching component with it
4. Use the fallback presentation as specified

────────────────────────────────────────────────────────────────────────────────

Example 4: Feedback Statement

**Directive**: "Don't use inline styles, use the project's styling convention"

**Response**:
1. Acknowledge the constraint
2. Replace inline styles with the project's established styling mechanism (whatever the codebase already uses)
3. Apply it consistently across the affected elements

────────────────────────────────────────────────────────────────────────────────

KEY PRINCIPLES DEMONSTRATED:

1. **Directive Priority**: Always address what the directive asks for first
2. **Design Document**: Follow architectural patterns specified in design
3. **Acknowledge + Fix**: When directive points out error, explain AND fix it
4. **Minimal Changes**: Only modify what's necessary for the task

────────────────────────────────────────────────────────────────────────────────

**For XML tag syntax and complete output format rules, see your phase's rules.md**

````
