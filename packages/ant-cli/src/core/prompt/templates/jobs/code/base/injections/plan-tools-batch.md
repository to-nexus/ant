## Plan-Phase Tool Usage

**Principle**: You have tools (read_file, list_files, search_code, run_command) to inspect the codebase and discover dependency APIs. Tool calls have a limited budget — spend them on what you CANNOT know from training data.

**Constraint**: `run_command` is restricted to:
- **Observation**: read-only commands that inspect installed dependencies, project configuration, or package APIs
- **Dependency recovery**: install a missing package when the design document prescribes it but the dependency manifest does not list it

Do NOT run commands that modify source files, start processes, run builds, or execute tests.

────────────────────────────────────────────────────────────────────────────────
## Tool Priority Protocol
────────────────────────────────────────────────────────────────────────────────

### Priority 1 — Design-Prescribed Dependency API Discovery

**Observation target**: Does the design document reference packages that are NOT part of the language standard library and NOT widely-known open-source packages? These are **design-prescribed dependencies** — packages the design document mandates for this project (organization-internal repos, private packages, project-specific libraries).

**Principle**: Observe the actual exported API signatures of each prescribed dependency before writing the plan. The implementation phase cannot see your tool output — it relies entirely on what you record **inline** in the `purpose`/`changes` of the `implementation.modify`/`create` entry that uses the package.

**Constraint**: Do NOT record function/type names without full signatures. Record parameter types and return types exactly as observed.

**Protocol**:
1. Scan the design document for import paths and package references
2. For each design-prescribed dependency, check the dependency manifest (e.g., `go.mod`, `package.json`)
3. If present in the manifest, observe its exported API:
   - TypeScript/JavaScript (primary): `search_code("^export\\b", include_dependencies: true, file_pattern: "codebase/node_modules/{package}/**/*.d.ts")` to enumerate exports across sub-paths in one call. For a single known entry file, `read_file("codebase/node_modules/{package}/package.json")` to find the `types`/`typings` entry, then `read_file` the entry `.d.ts`.
   - Go: `run_command("go doc <module>/<subpackage>")`
   - Other ecosystems: use the language-native documentation command when available; otherwise `search_code(include_dependencies: true)` on the installed source.
4. If NOT present in the manifest, install it first (`run_command`), then observe the API
5. Record the import path + **full signatures** (parameter types, return types) **inline** in the `purpose` (for `create`) or `changes` (for `modify`) of the entry that uses the package. If several entries share the same package, declare the full signatures in the first entry and reference by name in the rest.

**Constraint**: Do NOT substitute a design-prescribed dependency with standard library or alternative packages. Discover the actual API first; plan with the prescribed package.

**Constraint**: Every design-prescribed dependency whose API was observed via tools MUST appear inline in the entry that uses it. A discovered signature that does not make it into any `implementation.*` entry is invisible to the implementation phase.

### Priority 2 — Codebase Observation

Read existing source files, directory listings, or configs when the task requires understanding current project structure or patterns.

### PROHIBITED — Well-Known Package Exploration

Do NOT use tools to explore publicly available, well-known packages. This includes standard library packages and popular open-source packages (HTTP frameworks, database drivers, logging libraries, etc.). Your training data already contains their API documentation. Spending tool rounds on them prevents discovery of design-prescribed dependencies.

────────────────────────────────────────────────────────────────────────────────
## Finalization Discipline
────────────────────────────────────────────────────────────────────────────────

**Principle**: After gathering sufficient information from Priority 1-2, produce `<plan>` promptly.

**Constraint**: Once you have observed the APIs for the design-prescribed dependencies, produce `<plan>` in your NEXT response with the signatures inlined into the relevant `implementation.*` entries. Do NOT continue calling tools after the key APIs have been discovered.

⚠️ **Blind spot**: Calling tools indefinitely without producing `<plan>`. The system enforces a round-trip limit; if you exceed it your exploration context is used to generate the plan automatically. Produce `<plan>` BEFORE hitting the limit.

────────────────────────────────────────────────────────────────────────────────
## Batch Execution
────────────────────────────────────────────────────────────────────────────────

**Principle**: All tool calls issued in a single response are executed as one batch.

**Constraint**: When you need to observe multiple files or paths, issue ALL needed tool calls in ONE response. Do NOT issue one call, wait, then issue the next.

**Constraint**: If the task description, directory tree, or RAG context already indicates which files or paths you need, issue ALL of those reads or listings in ONE response. Do NOT discover incrementally when the context already reveals the set.

⚠️ **Blind spot**: Sequential discovery — reading one file then deciding the next. When the context already reveals the needed set, batch in one turn.
