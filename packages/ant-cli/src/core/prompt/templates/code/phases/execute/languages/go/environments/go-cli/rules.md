## Go CLI Tools Environment

**Context**: Command-line tools and scripts compiled as standalone Go binaries

---

### Key Characteristics

1. **Static binary**: Single compiled binary, no runtime dependencies
2. **Direct OS interaction**: Full access to filesystem, network, process management
3. **No concurrency concerns for simple CLIs**: Sequential execution is acceptable unless parallelism is explicitly needed

---

### Key Constraints

1. **Exit codes matter**: Return appropriate exit codes for CI/CD integration (0 = success, 1 = general error, 2 = usage error)
2. **Error output**: Write error messages to stderr (`os.Stderr`), not stdout
3. **Cross-platform**: Consider OS differences in paths, line endings, and available commands when build tags or runtime checks are needed

---

### When Solving Problems

**Analyze first:**
- What does the existing CLI structure look like?
- Are there existing argument parsing patterns (flags, cobra, urfave/cli)?
- What's the expected output format?

**Key principle:** Follow existing project conventions. If none exist, keep it simple.

**Constraint**: Do NOT run build, module, or dependency commands (`go build`, `go mod tidy`, `go get`, `go run`, `go test`). Build and dependency verification is handled by the verification task — not yours.

**Exception**: `go doc` is allowed via `run_command` — it is read-only and has no side effects.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Arguments | Is there existing parsing? What library is used? |
| Output | Structured (JSON) or human-readable? |
| Errors | How does existing code handle and report errors? |
| Signals | Does the CLI need graceful shutdown on interrupt? |

---

### Dependency Boundaries for Testability

**Principle**: CLI command handlers that perform I/O (filesystem, network, subprocess) should accept those capabilities as interfaces or function parameters, not call them directly inline.

**Observation target**: Does a command handler directly call `os.ReadFile`, `exec.Command`, or `http.Get` inline?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Filesystem access** | Does a command handler directly call `os` or `io` package functions inline? Accept an interface or isolate into a dedicated I/O module. |
| **Subprocess execution** | Does a module directly call `os/exec` functions? Accept as a parameter or isolate into a runner interface. |

**Constraint**: Do NOT over-architect simple scripts. A CLI with a single file operation does not need an I/O abstraction layer. Apply when the CLI has multiple commands with distinct I/O patterns.

⚠️ **Blind spot**: CLI tools often embed filesystem and exec calls throughout command handlers because "it compiles and works." A test task running after features cannot verify command behavior without touching the real filesystem unless I/O is behind an interface.

---

### Design-Document Dependency Pre-check

**Observation target**: Does the design document or plan reference a package that is NOT in `go.mod`?

**Constraint**: Before writing code that imports a design-document-prescribed package, verify it exists in `go.mod`. If missing, add the module to the `require` block via `edit_file`. If the exact version is unknown, add the import in the `.go` file — the verification phase's `go mod tidy` resolves missing modules from imports automatically.

### Unknown Package API Discovery

**Principle**: If a package's API is not in your training data, observe it before writing code — do NOT guess function names or type signatures.

**Protocol** (via `run_command`):

1. `go doc package` — package overview with one-line summary of each exported symbol (index)
2. `go doc package.TypeName` — drill into specific types referenced by the design document or needed for the task
3. `go doc package.TypeName.Method` — drill into specific methods when signatures are needed
4. Repeat steps 2-3 for each type/function you need until you have sufficient API knowledge

**Constraint**: Do NOT start with `go doc -all` — it outputs the entire package documentation and is easily truncated. Start with the package index (step 1) and drill into specific symbols.

**Constraint**: If `go doc` returns "no symbol found" or an error, the package may not be downloaded yet. Inform the user that the package needs to be resolved first (setup phase responsibility).

⚠️ **Blind spot**: Packages from the same organization are easily assumed to follow familiar conventions. Their actual exported API may differ — always verify with `go doc` when uncertain.

---

**Remember:** You already know how to build CLI tools in Go. Analyze the specific requirements and existing patterns.
