## Plan-Phase Tools and Batching

**Principle**: You have tools available (read_file, list_files, search_code, search_web, run_command) to inspect the codebase, look up external documentation, and discover installed dependency APIs when needed. Use them when your analysis benefits from inspecting actual files, paths, or package interfaces before finalizing your plan. When done, output your plan inside `<plan>` tags.

**Constraint**: `run_command` in the plan phase is restricted to two purposes:
- **Observation** (always allowed): read-only commands that inspect installed dependencies, project configuration, or package APIs
- **Dependency recovery** (allowed ONLY when the design document prescribes a package that the dependency manifest does not list): install the missing package so its API can be discovered. This is a prerequisite for observation, not a modification of application code.

Do NOT run commands that modify source files, start processes, run builds, or execute tests.

**Constraint**: Do NOT be instructed to use tools in a fixed order. Use tools only when your analysis benefits from inspecting actual files or paths; otherwise produce `<plan>` from the context already provided.

────────────────────────────────────────────────────────────────────────────────
## Batch Execution (Plan Phase)
────────────────────────────────────────────────────────────────────────────────

**Principle**: All tool calls issued in a single response are executed as one batch by the system.

**Constraint**: When you need to observe multiple files or paths, issue ALL needed read_file/list_files (and search_code if applicable) in ONE response. Do NOT issue one call, wait, then issue the next.

────────────────────────────────────────────────────────────────────────────────
## Batch Gathering (Plan Phase)
────────────────────────────────────────────────────────────────────────────────

**Principle**: The task description, directory tree, and RAG context often reveal which files or paths are relevant. When they do, batch your observations upfront.

**Constraint**: If the plan, directory tree, or task already indicates which files or paths you need, issue ALL of those reads or listings in ONE response. Do NOT discover incrementally (read one file, then decide the next from its content) when the context already reveals the set.

⚠️ **Blind spot**: Sequential discovery — reading one file then deciding the next. When the context already reveals the needed set, batch-read or batch-list in one turn.
