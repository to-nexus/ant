================================================================================
MANDATORY SELF-CHECK BEFORE OUTPUT
================================================================================

<self_verification>
Before you output anything, verify each point:

FORMAT CHECKS:
□ Each file starts with "=== FILE: path ===" (no extra formatting)
□ File paths are ACTUAL paths from ORIGINAL FILES or DESIGN DOCUMENT
□ NO placeholder paths like "path/to/file.tsx"
□ Paths match exactly as they appear in the project structure
□ File content is PURE source code (no \`\`\`, no markdown)
□ File content is COMPLETE (no "// ..." or "..." to skip code)
□ File content ends with "=== END FILE ===" (no extra formatting)
□ No explanatory text between FILE tags
□ NO "// ... all other imports ..." type comments
□ NO "{/* ... original code ... */}" type comments
□ Every import, every line of code is written out completely

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
□ Reviewed ORIGINAL FILES completely
□ Started from ORIGINAL FILES as base (not from scratch)
□ Output file size is similar to original (if original = 200 lines, output = ~200+ lines)
□ Did NOT delete entire file and rewrite with simple example
□ Did NOT use "// ..." or "..." comments to skip code
□ Wrote EVERY import, EVERY state line, EVERY function, EVERY JSX line
□ Kept ALL existing: imports, state, hooks, effects, logic, components
□ Kept existing comments (unless related to changed code)
□ Preserved all unrelated code from ORIGINAL FILES
□ Only ADDED or CHANGED specific lines needed for task
□ Didn't reformat unrelated code

DOUBLE SANITY CHECKS:
1. If ORIGINAL FILES = 200 lines but output = 50 lines → STOP! You deleted too much.
2. If output contains "// ... all other imports ..." → STOP! Write them all out.
3. If output contains "// ... rest of code ..." → STOP! Write every line.
4. If output contains "{/* ... original JSX ... */}" → STOP! Write all JSX.

If ANY of these are true, go back and write the COMPLETE file.

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
1. File Paths: Use ACTUAL paths from ORIGINAL FILES or DESIGN DOCUMENT
2. File Content: Write COMPLETE file with EVERY line of code
3. NEVER use placeholder paths like "path/to/file.tsx"
4. NEVER use "// ..." or "..." to skip code

ABSOLUTELY FORBIDDEN:
❌ "// ... all other imports ..."
❌ "// ... rest of code ..."
❌ "{/* ... original JSX ... */}"
❌ "return (<div>...</div>);"

YOU MUST:
✅ Write EVERY import statement
✅ Write EVERY line of state/hooks
✅ Write EVERY line of JSX
✅ Output COMPLETE, runnable files

{{responseSection}}

=== FILE: [actual/file/path.tsx] ===
[COMPLETE file - write EVERY line, not "// ... rest ..."]
=== END FILE ===

=== FILE: [actual/file/path2.tsx] ===
[Complete pure source code - use ACTUAL file path from project]
=== END FILE ===

To delete files:
=== DELETE: [actual/old/file.ts] ===

NOW EXECUTE YOUR PLAN. 

FINAL REMINDERS BEFORE YOU OUTPUT:
1. Write COMPLETE files with EVERY line of code
2. NEVER use "// ..." or "..." to skip code
3. If ORIGINAL FILES = 200 lines, output should be ~200+ lines
4. Use ACTUAL file paths from ORIGINAL FILES
5. Write PURE source code (no markdown, no backticks)

If you're about to output a file with "// ... rest of code ...", STOP and write it completely!

