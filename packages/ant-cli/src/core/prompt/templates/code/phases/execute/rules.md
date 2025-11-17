================================================================================
MANDATORY SELF-CHECK BEFORE OUTPUT
================================================================================

<self_verification>
Before you output anything, verify each point:

FORMAT CHECKS:
□ Used <edit> tags for modifying existing files (mandatory!)
□ Used <file> tags ONLY for creating NEW files
□ Each <edit> has: <edit path="..."><search>exact code</search><replace>new code</replace></edit>
□ Each <file> has: <file path="...">complete content</file>
□ File/Edit paths are ACTUAL paths from ORIGINAL FILES or DESIGN DOCUMENT
□ NO placeholder paths like "path/to/file.tsx"
□ Paths match exactly as they appear in the project structure
□ <search> blocks match EXACTLY (including whitespace)
□ <replace> blocks contain new code only
□ File content is PURE source code (no \`\`\`, no markdown)
□ No explanatory text between XML tags
□ All XML tags are properly closed

CONTENT CHECKS:
□ All imports are present at top of file
□ Import paths are correct (verified against file structure)
□ No import errors would occur
□ All types/interfaces are defined
□ No placeholders like "// ... rest of code"
□ No TODO comments unless actually needed
□ Code is syntactically valid

DESIGN → CODE TRANSLATION CHECKS:
□ Converted pseudocode/algorithms from design into actual TypeScript/React code
□ Implemented conceptual APIs/interfaces as concrete functions/classes
□ Added proper TypeScript types (design has concepts, code needs types)
□ Added error handling (design describes flow, code needs try-catch)
□ Implemented edge cases (design mentions them, code handles them)
□ Used appropriate libraries/frameworks (design suggests, code uses actual imports)

LANGUAGE CHECKS:
□ All variable names are in English
□ All function names are in English
□ All comments are in English
□ No non-English text in code (comments, variables, types)
□ Translated any non-English comments/identifiers to English

MINIMAL CHANGES CHECKS (MOST CRITICAL):
□ Used <edit> tags for modifications (only changed necessary code sections)
□ <search> blocks contain exact code to find (no more, no less)
□ <replace> blocks contain only new code (no unchanged surrounding code)
□ Reviewed ORIGINAL FILES completely before creating <edit> blocks
□ Did NOT regenerate entire files when only small changes needed
□ Used <file> tags ONLY for brand new files
□ Preserved all unrelated code (it stays untouched automatically with <edit>)
□ Only targeted specific lines/sections that need changes

DOUBLE SANITY CHECKS:
1. Am I modifying an existing file?
   → USUALLY use <edit> tags (efficient)
   → EXCEPT for refactoring: Use <file> tags (see below)
2. Am I creating a new file? → Use <file> tags with complete content
3. Is my <search> block exact? → Copy-paste exact code from ORIGINAL FILES
4. Does my <replace> block have unchanged code? → Remove it, keep only changes

⚠️ EXCEPTION: When to use <file> instead of <edit> for modifications:
- Fixing import errors (must update ALL usage in file)
- Refactoring identifiers (renaming, API changes)
- Multiple related changes scattered throughout file
- When <edit> failed before (pattern not found)
→ In these cases: Use <file> tags to ensure ALL changes are made

If using <file> tags for simple modification → STOP! Use <edit> instead.

TASK CHECKS:
□ I provided a summary explanation after all file operations (REQUIRED!)
□ Summary explains what I did and why (in plain text outside XML tags)
□ I followed my plan exactly (no scope creep)
□ I only modified files that need changes
□ Changes satisfy the primary task

DESIGN CONFORMANCE CHECKS:
□ Implementation follows DESIGN DOCUMENT architecture
□ Used components/patterns specified in DESIGN DOCUMENT
□ Code structure matches DESIGN DOCUMENT conventions
□ If DIRECTIVE changed requirements, I still followed DESIGN's architectural patterns

TYPE & RUNTIME CHECKS:
□ No TypeScript errors (mentally verify strict typing)
□ No implicit any introduced
□ All possibly-undefined values are guarded or defaulted (e.g., projectId, language)
□ Null vs undefined handled consistently (convert null → undefined at boundaries)

STYLE-ONLY CHANGE CHECKS (if applicable):
□ No removal of existing imports/state/effects/providers unrelated to style
□ No logic refactors; only className/styles/glue code adjusted
□ Component integration preserves previous behavior

If ANY checkbox is unchecked, FIX IT before outputting.
</self_verification>

================================================================================
OUTPUT STRUCTURE
================================================================================

CRITICAL OUTPUT RULES:

**FORMAT 1: Modifying EXISTING files** (PREFERRED - use this 90% of the time!)
<edit path="src/components/Button.tsx">
<search>
[exact code to find - must match perfectly]
</search>
<replace>
[new code to replace with]
</replace>
</edit>

**FORMAT 2: Adding to END of existing files** (TOKEN EFFICIENT!)
<append path="src/utils.ts">
[NEW code to add at the end - don't repeat existing code!]
</append>

**FORMAT 3: Creating NEW files** (only for files that don't exist yet)
<file path="src/components/NewButton.tsx">
[COMPLETE file content - write EVERY line]
</file>

**FORMAT 4: Deleting files**
<delete path="src/components/OldButton.tsx" />

**FORMAT 5: Summary response** (REQUIRED - explain what you did!)
After all file/edit operations, provide a brief summary outside XML tags.

Example:
```
<file path="src/Button.tsx">
...
</file>

<edit path="src/App.tsx">
...
</edit>

I've successfully implemented the button feature. Here's what I did:

1. **Created Button component** - Reusable button with props
2. **Updated App.tsx** - Integrated the new button
3. **Added click handler** - Alert on button click

The button is now ready to use!
```

ABSOLUTELY FORBIDDEN:
❌ Using <file> tags to modify existing files (use <edit>!)
❌ Incomplete <search> blocks (must match exactly)
❌ Including unchanged code in <replace> blocks
❌ Placeholder paths like "path/to/file.tsx"
❌ Comments in JSON files (package.json, tsconfig.json, etc.) - JSON spec forbids comments!
❌ Unclosed XML tags

YOU MUST:
✅ Use <edit> for modifications (saves 90% tokens!)
✅ Use <append> to add code at end of file (even more efficient!)
✅ <search> block = exact copy from original file
✅ <replace> block = only the new/changed code
✅ Use <file> only for brand new files
✅ Write complete content in <file> blocks
✅ Close all XML tags properly

NOW EXECUTE YOUR PLAN. 

FINAL REMINDERS BEFORE YOU OUTPUT:
1. **Modifying existing file?** → Use <edit> tags (mandatory!)
2. **Adding to end of file?** → Use <append> tags (token efficient!)
3. **Creating new file?** → Use <file> tags with complete content
4. **<search> block** → Must match original file EXACTLY
5. **<replace> block** → Only the new/changed code
6. **<append> block** → Only the new code to add
7. Use ACTUAL file paths from ORIGINAL FILES
8. **End with summary** → Explain what you did in plain text (REQUIRED!)

⚠️ If you're about to use <file> tags for a modification → STOP! Use <edit> instead!

📝 OUTPUT STRUCTURE:
```
<file>...</file>         ← File operations first
<edit>...</edit>

Summary explanation...   ← Plain text summary REQUIRED!
```

