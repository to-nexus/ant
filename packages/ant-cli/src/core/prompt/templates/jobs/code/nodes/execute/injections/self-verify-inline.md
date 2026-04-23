---

## Self-Verify Before Done (Tier 2 SingleTask)

**Principle**: This task is a single-unit-of-work breakdown. A separate verification task does NOT follow; the runtime expects THIS task to own install/typecheck/build/test gates before declaring completion.

**Principle**: The `<done>true</done>` signal means "code change applied AND verification gates pass". Emitting `<done>` with unrun or failing gates breaks the contract.

### Gate Order (observable, deterministic)

**Constraint**: Run the gates in this order, advancing only after the prior gate passes:

1. **Install (conditional)** — run the project's install command (`npm install` / `pnpm install` / `yarn` / `pip install -r` / `go mod tidy`, etc.) ONLY IF dependencies were added/changed during this task. Skip when no dependency edits occurred.
2. **Typecheck** — run the project's typecheck command (`tsc --noEmit` / `pnpm typecheck` / `mypy .` / `go vet`, etc.) when the language/framework supports it. Skip only when the stack has no typecheck phase (plain JS, shell scripts).
3. **Build** — run the project's build command (`next build` / `pnpm build` / `go build ./...` / `cargo build`, etc.). Always applicable.
4. **Test** — run the project's test command (`pnpm test` / `pytest -q` / `go test ./...`, etc.) when the stack has tests. Skip only when the project explicitly has no test suite.

**Constraint**: Use `run_command` with the EXACT command observable from the codebase's `package.json`/`Makefile`/`go.mod` context. Do NOT invent commands.

### Failure Handling (stay within this task)

**Principle**: A failing gate is a signal to iterate WITHIN this task, not to escalate. The loop budget is the single mechanism for bounding retries.

**Constraint**: When a gate fails, read the error output, apply the minimal fix, and re-run the SAME gate (and any downstream gates that depended on it). Do NOT skip ahead to `<done>`.

**Constraint**: If the failure cannot be fixed inside this task (scope expands beyond the original directive, or the root cause sits in a file the task has no mandate to touch), emit `<needsEscalation>true</needsEscalation>` instead of `<done>`. Do NOT emit both.

### Termination

**Constraint**: Emit `<done>true</done>` ONLY after every applicable gate has passed in one green chain. Emitting `<done>` with a prior gate failing or skipped-in-error is a contract violation.

⚠️ **Blind spot**: Declaring `<done>` after applying the code change but before running gates is the most common failure mode. The runtime does NOT re-verify afterwards for this task — if you skip gates, no safety net catches the regression.

⚠️ **Blind spot**: "My change is obviously correct" is not a reason to skip gates. The Tier Entry Node already judged the work requires verification — that decision is authoritative.

---
