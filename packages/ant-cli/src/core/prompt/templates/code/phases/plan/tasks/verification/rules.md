{{#if hasTools}}
## Diagnostic Tool Usage

**Principle**: You have tools (read_file, list_files, search_code, run_command) to diagnose build/test failures. Your PRIMARY use of `run_command` is to execute build and test commands.

**`run_command` is permitted for**:
- **Build/test execution**: Run the project's build command, test command, or related verification commands
- **Observation**: Read-only commands that inspect configuration, dependencies, or project state
- **Dependency recovery**: Install a missing package when the project configuration requires it

**`run_command` is NOT permitted for**:
- Modifying source files (use the code execution phase for that)
- Persistent background processes unrelated to the verification steps above
  (e.g., database servers, message queues — the dev server in Step 3
   is permitted and is auto-terminated by the platform after startup verification)

**Constraint**: When you need to read multiple files referenced in build errors, issue ALL reads in ONE response. Do NOT read files one at a time.

**Constraint**: After running build/test and reading error-related files, produce `<analysis>` and `<plan>` promptly. Do NOT continue calling tools after sufficient diagnostic information is gathered.

{{/if}}

## Diagnostic Protocol Rules

### Error Grouping Principle

**Constraint**: A single root cause often produces multiple compiler/runtime errors.
Group errors by their underlying cause, not by their surface-level error message.

Common root cause patterns:
- Missing import/dependency -> multiple "not found" errors across files
- Duplicate symbol -> redeclaration errors in multiple compilation units
- Type mismatch -> cascading type errors in downstream consumers
- Deleted/moved file -> broken imports in multiple dependents

### Fix Priority Principle

**Constraint**: Fix root causes in dependency order.
A fix to a foundational issue (e.g., restoring a missing export) may resolve cascading errors automatically.

Priority ordering:
1. Dependency/import errors (unblock compilation)
2. Type/interface mismatches (unblock type checking)
3. Logic/runtime errors (unblock execution)
4. Test failures (verify correctness)

### Complete Error Discovery

**Principle**: Some build tools abort after the first error or first few errors. If the build output shows only 1-3 errors, a dedicated type checker or linter may reveal more.

**Constraint**: When language-specific hints are provided (below), follow their guidance on running a comprehensive error check BEFORE the project's build command. This prevents a fix-one-discover-next loop.

**Constraint**: If the first build run shows errors and a comprehensive type check command is available, run it to surface ALL errors before producing the remediation plan.

### Plan Completeness

**Constraint**: The plan must account for ALL errors discovered across all diagnostic commands.
Do not plan a fix for only the first error — the execution phase expects a comprehensive plan.

**Constraint**: If the same file needs multiple changes, consolidate them into a single `modify` entry with multiple `changes`.

### Build Command Discovery

If you are unsure which build command to use, observe:
- `package.json` scripts (npm/yarn/pnpm projects)
- `Makefile`, `CMakeLists.txt`, or build tool configs
- `Cargo.toml` (Rust), `go.mod` (Go), `build.gradle` (Java/Kotlin)

Use `read_file` on the project root's configuration files to determine the correct build command.
