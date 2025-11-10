================================================================================
MANDATORY SELF-CHECK BEFORE OUTPUT
================================================================================

<self_verification>
Before you output anything, verify each point:

FORMAT CHECKS:
□ Used EDIT format for modifying existing files (mandatory!)
□ Used FILE format ONLY for creating NEW files
□ Each EDIT block has: === EDIT: path ===, <<<<<<< SEARCH, =======, >>>>>>> REPLACE, === END EDIT ===
□ Each FILE block has: === FILE: path ===, [content], === END FILE ===
□ File/Edit paths are ACTUAL paths from ORIGINAL FILES or DESIGN DOCUMENT
□ NO placeholder paths like "path/to/file.tsx"
□ Paths match exactly as they appear in the project structure
□ SEARCH blocks match EXACTLY (including whitespace)
□ REPLACE blocks contain new code only
□ File content is PURE source code (no \`\`\`, no markdown)
□ No explanatory text between tags

CONTENT CHECKS:
□ All imports are present at top of file
□ Import paths are correct (verified against file structure)
□ No import errors would occur
□ All types/interfaces are defined
□ No placeholders like "// ... rest of code"
□ No TODO comments unless actually needed
□ Code is syntactically valid

LANGUAGE CHECKS:
□ All variable names are in English
□ All function names are in English
□ All comments are in English
□ No non-English text in code (comments, variables, types)
□ Translated any non-English comments/identifiers to English

MINIMAL CHANGES CHECKS (MOST CRITICAL):
□ Used EDIT format for modifications (only changed necessary code sections)
□ SEARCH blocks contain exact code to find (no more, no less)
□ REPLACE blocks contain only new code (no unchanged surrounding code)
□ Reviewed ORIGINAL FILES completely before creating EDIT blocks
□ Did NOT regenerate entire files when only small changes needed
□ Used FILE format ONLY for brand new files
□ Preserved all unrelated code (it stays untouched automatically with EDIT)
□ Only targeted specific lines/sections that need changes

DOUBLE SANITY CHECKS:
1. Am I modifying an existing file?
   → USUALLY use EDIT format (efficient)
   → EXCEPT for refactoring: Use FILE format (see below)
2. Am I creating a new file? → Use FILE format with complete content
3. Is my SEARCH block exact? → Copy-paste exact code from ORIGINAL FILES
4. Does my REPLACE block have unchanged code? → Remove it, keep only changes

⚠️ EXCEPTION: When to use FILE instead of EDIT for modifications:
- Fixing import errors (must update ALL usage in file)
- Refactoring identifiers (renaming, API changes)
- Multiple related changes scattered throughout file
- When EDIT failed before (pattern not found)
→ In these cases: Use FILE format to ensure ALL changes are made

If using FILE format for simple modification → STOP! Use EDIT instead.

TASK CHECKS:
□ If DIRECTIVE exists: I responded with === RESPONSE === section
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
=== EDIT: src/components/Button.tsx ===
<<<<<<< SEARCH
[exact code to find - must match perfectly]
=======
[new code to replace with]
>>>>>>> REPLACE
=== END EDIT ===

**FORMAT 2: Creating NEW files** (only for files that don't exist yet)
=== FILE: src/components/NewButton.tsx ===
[COMPLETE file content - write EVERY line]
=== END FILE ===

**FORMAT 3: Deleting files**
=== DELETE: src/components/OldButton.tsx ===

ABSOLUTELY FORBIDDEN:
❌ Using FILE format to modify existing files (use EDIT!)
❌ Incomplete SEARCH blocks (must match exactly)
❌ Including unchanged code in REPLACE blocks
❌ Placeholder paths like "path/to/file.tsx"
❌ Comments in JSON files (package.json, tsconfig.json, etc.) - JSON spec forbids comments!

YOU MUST:
✅ Use EDIT for modifications (saves 90% tokens!)
✅ SEARCH block = exact copy from original file
✅ REPLACE block = only the new/changed code
✅ Use FILE only for brand new files
✅ Write complete content in FILE blocks

NOW EXECUTE YOUR PLAN. 

FINAL REMINDERS BEFORE YOU OUTPUT:
1. **Modifying existing file?** → Use EDIT format (mandatory!)
2. **Creating new file?** → Use FILE format with complete content
3. **SEARCH block** → Must match original file EXACTLY
4. **REPLACE block** → Only the new/changed code
5. Use ACTUAL file paths from ORIGINAL FILES

⚠️ If you're about to use FILE format for a modification → STOP! Use EDIT instead!

