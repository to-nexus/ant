## Plan-Phase Tool Usage

**Principle**: You have tools (read_file, list_files, search_code, run_command) to inspect the codebase and discover dependency APIs. Tool calls have a limited budget — spend them on what you CANNOT know from training data.

**Constraint**: `run_command` is restricted to:
- **Observation**: read-only commands that inspect installed dependencies, project configuration, or package APIs
- **Dependency recovery**: install a missing package when the design document prescribes it but the dependency manifest does not list it

Do NOT run commands that modify source files, start processes, run builds, or execute tests.

────────────────────────────────────────────────────────────────────────────────
## Tool Priority Protocol
────────────────────────────────────────────────────────────────────────────────

### Priority 1 — Unknown Dependency API Discovery

**Observation target**: Does the design document reference packages whose API is NOT in your training data (organization-internal repos, private packages, unfamiliar libraries)?

**Protocol**:
1. Scan the design document for import paths and package references
2. For each package you do NOT recognize from training data, check the dependency manifest (e.g., `go.mod`, `package.json`)
3. If present in the manifest, use documentation commands to discover its exported API (e.g., `go doc <module>/<subpackage>`)
4. If NOT present in the manifest, install it first (`run_command`), then discover the API
5. Include **concrete import paths and function/type names** from the discovered API in your plan

**Constraint**: Do NOT substitute a design-prescribed unknown package with standard library or alternative packages. Discover the actual API first; plan with the prescribed package.

**Constraint**: Plan entries that reference a discovered dependency MUST include specific API details (import path, function names, type names). Vague references like "use package X or internal alternative" are insufficient.

**Constraint**: Every unknown package whose API was discovered via tools MUST appear in `prescribedPackages` with concrete API details. A discovered package omitted from `prescribedPackages` will not be used by the implementation phase.

### Priority 2 — Codebase Observation

Read existing source files, directory listings, or configs when the task requires understanding current project structure or patterns.

### PROHIBITED — Well-Known Package Exploration

Do NOT use tools to explore publicly available, well-known packages. This includes standard library packages and popular open-source packages (HTTP frameworks, database drivers, logging libraries, etc.). Your training data already contains their API documentation. Spending tool rounds on them prevents discovery of actually unknown packages.

────────────────────────────────────────────────────────────────────────────────
## Finalization Discipline
────────────────────────────────────────────────────────────────────────────────

**Principle**: After gathering sufficient information from Priority 1-2, produce `<plan>` promptly.

**Constraint**: Once you have observed the APIs for the unknown dependencies, produce `<analysis>` and `<plan>` in your NEXT response. Do NOT continue calling tools after the key APIs have been discovered.

⚠️ **Blind spot**: Calling tools indefinitely without producing `<plan>`. The system enforces a round-trip limit; if you exceed it your exploration context is used to generate the plan automatically. Produce `<plan>` BEFORE hitting the limit.

────────────────────────────────────────────────────────────────────────────────
## Batch Execution
────────────────────────────────────────────────────────────────────────────────

**Principle**: All tool calls issued in a single response are executed as one batch.

**Constraint**: When you need to observe multiple files or paths, issue ALL needed tool calls in ONE response. Do NOT issue one call, wait, then issue the next.

**Constraint**: If the task description, directory tree, or RAG context already indicates which files or paths you need, issue ALL of those reads or listings in ONE response. Do NOT discover incrementally when the context already reveals the set.

⚠️ **Blind spot**: Sequential discovery — reading one file then deciding the next. When the context already reveals the needed set, batch in one turn.
