## Error Resolution: Batch-First Principle

**Principle**: When a command output reveals multiple errors, fix ALL of them before re-running the command. Each command re-run replays the full conversation, so minimizing re-runs is critical.

**Constraint**: Do NOT fix one error and re-run. Read the COMPLETE error output, list EVERY distinct error, then fix ALL errors across ALL files in a single batch of tool calls, THEN re-run.

**Constraint**: When a batch of edits is needed, issue MULTIPLE tool calls (edit_file, file creation) in a SINGLE response. Do NOT split them across separate turns.

| Situation | Correct Action |
|-----------|---------------|
| Build output shows N errors | Fix all N errors, then rebuild once |
| Multiple files need same kind of fix | Edit all files in one response |
| Error in file A causes cascade in B, C | Fix root cause in A + cascading fixes in B, C together |

**Constraint**: Strict compilers (Go, Rust, TypeScript strict) report cascading errors. Unused imports appear AFTER removing the code that used them. Fix the root cause first, then clean up cascading errors in the SAME batch.

⚠️ **Blind spot**: After fixing one error, the instinct is to immediately verify. Resist this — collect and fix ALL visible errors first. One rebuild that validates 8 fixes is 8x more efficient than 8 separate rebuild cycles.
