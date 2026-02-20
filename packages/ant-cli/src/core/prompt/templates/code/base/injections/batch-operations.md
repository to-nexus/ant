## Tool Call Batching

**Principle**: The system processes ALL tool calls from a single response as one batch. There is no benefit to issuing tool calls one at a time across separate responses.

**Constraint**: Before issuing tool calls, identify ALL information you need in this step. Issue ALL tool calls in ONE response.

**Constraint**: NEVER issue a single tool call when you can already identify additional tool calls needed from context (directory tree, plan, task description, prior results).

⚠️ **Blind spot**: Sequential discovery — reading one file, then deciding to read the next based on its content. If the plan or directory tree already reveals which files you need, batch-read ALL of them upfront instead of discovering incrementally.

---

## Error Resolution: Batch-First Principle

**Principle**: When a command output reveals multiple errors, fix ALL of them before re-running the command. Each command re-run replays the full conversation, so minimizing re-runs is critical.

**Constraint**: Do NOT fix one error and re-run. Read the COMPLETE error output, list EVERY distinct error, then fix ALL errors across ALL files in a single batch of tool calls, THEN re-run.

**Constraint**: Strict compilers (Go, Rust, TypeScript strict) report cascading errors. Fix the root cause first, then clean up cascading errors in the SAME batch.

⚠️ **Blind spot**: After fixing one error, the instinct is to immediately verify. Resist this — collect and fix ALL visible errors first. One rebuild that validates all fixes is far more efficient than separate rebuild cycles.
