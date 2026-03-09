## Go API Server Environment

**Context**: Backend API server handling concurrent HTTP requests

---

### Key Characteristics

1. **Goroutine-per-request**: Each request runs in its own goroutine automatically
2. **Long-running process**: Server stays alive, handles many requests
3. **Static binary**: Single compiled binary with no external runtime dependency

---

### Key Constraints

1. **Explicit error handling**: Every error return MUST be checked — do NOT discard with `_`
2. **Resource lifecycle**: Database connections, file handles, HTTP clients must be properly closed via `defer`
3. **Graceful shutdown**: Server must handle OS signals (SIGTERM, SIGINT) for clean connection draining
4. **Context propagation**: Use `context.Context` as the first parameter for cancellation and timeout propagation across layers

---

### Concurrency Considerations

**Principle**: Observe whether shared mutable state exists before introducing synchronization.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Shared state** | Is there mutable state accessed by multiple goroutines? |
| **Synchronization** | If shared state observed, what mechanism protects it? (mutex, channel, atomic) |
| **Goroutine lifecycle** | Are spawned goroutines properly bounded and tracked? |

**Constraint**: Do NOT spawn unbounded goroutines. If background work is needed, observe whether the existing codebase uses a worker pool, errgroup, or similar pattern — and follow it.

**Blind spot reminder**: Race conditions are silent until they crash. If you introduce shared mutable state, verify synchronization is in place.

---

### When Solving Problems

**Principle**: Observe the existing codebase structure and established patterns before making changes. Minimal, targeted changes only.

**Constraint**: Do NOT run build, module, or dependency commands (`go build`, `go mod tidy`, `go get`, `go run`, `go test`). Build and dependency verification is handled by the verification task — not yours.

⚠️ **Blind spot**: When a source file has import errors or type mismatches, the instinct is to run a build command to "check if it compiles." Resist this — fix the source code issue directly. If a dependency is missing from `go.mod`, add it to the `require` block via `edit_file` instead of running `go get`.

---

### Common Considerations

| Concern | What to Observe |
|---------|-----------------|
| Import errors | Module path in `go.mod`, package naming, circular imports |
| Type errors | Visibility (exported vs unexported), interface satisfaction |
| Cross-module imports | Is the imported module physically present in this workspace (listed in `go.work` or as a sibling directory)? Only workspace-local modules use `replace`. |

⚠️ **Blind spot**: `replace` directives are ONLY for modules whose source directory is physically present in this workspace. Adding `replace` for modules not in the workspace (e.g., same-org packages published externally) causes build failure — the relative path does not exist. Do NOT infer workspace-local status from organization name or module path prefix.

---

### Type Visibility

**Principle**: Identifiers starting with an uppercase letter are exported (cross-package accessible). Lowercase identifiers are package-private.

**Constraint**: When defining a type that will be referenced by another package in the same project, the type name MUST start with an uppercase letter. Decide visibility at definition time, not after a compile error.

⚠️ **Blind spot**: Data-transfer types in a repository package (row structs, result types) are easily created as unexported. If any service or handler package references these types, the build fails. Fixing visibility after the fact causes cascading renames across interface signatures, function returns, and variable declarations — each rename a separate interaction that replays the full conversation.

---

### Data Access Layer Consistency

**Principle**: Persistence operations belong in exactly one architectural layer. When an architecture defines a dedicated persistence layer, that layer is the single owner of all persistence operations.

**Observation target**: In which architectural layers do persistence statements appear?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Statement containment** | Do persistence statements appear outside the designated persistence layer? |
| **Cross-boundary atomicity** | When a service coordinates atomic operations across multiple persistence interfaces, does the coordination mechanism live in the persistence layer or the business logic layer? |

**Constraint**: If the architecture designates a persistence layer, other layers MUST NOT contain persistence statements — even when coordinating atomic operations across multiple persistence interfaces.

**Constraint**: When atomic coordination across persistence boundaries is needed, the mechanism MUST be exposed through the persistence layer's interface. The business logic layer orchestrates WHAT participates in the atomic operation; the persistence layer owns HOW it executes.

⚠️ **Blind spot**: When a service needs to update 2+ persistence interfaces atomically, it is tempting to bypass those interfaces and write persistence statements directly in the service layer. This creates a parallel data access path that breaks layer separation and is invisible to the persistence interface's contract. Verify that ALL persistence statements — including those inside atomic coordination — go through the designated persistence layer.

---

### Dependency Boundaries for Testability

**Principle**: Service and handler constructors should accept interfaces, not concrete implementations. This allows test doubles to be substituted without modifying source code.

**Observation target**: Does a constructor or factory function directly instantiate its dependencies?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Constructor parameters** | Does `NewXxxService(...)` accept interface types for its dependencies (repository, client, etc.)? |
| **Direct instantiation** | Does a service create its own `*sql.DB`, HTTP client, or repository struct internally? |
| **Handler-layer boundary** | Does the handler (HTTP/gRPC) depend on a service interface, not the concrete service struct? |

**Constraint**: If the architecture defines layer boundaries (handler → service → repository), each boundary should be an interface. The concrete type is wired at the composition root (e.g., `main()` or `cmd/`), not inside the consuming layer.

⚠️ **Blind spot**: It is easy to pass concrete struct pointers between layers because "it works." A dedicated test task runs after features — it cannot substitute dependencies unless interfaces exist at layer boundaries.

---

### Security Considerations

**Observation target**: Does the code protect against common API security vulnerabilities?

| Checkpoint | What to observe |
|-----------|----------------|
| **Secret comparison** | Are API keys or tokens compared using `crypto/subtle.ConstantTimeCompare`? A plain `==` or `!=` on secrets is a timing-attack vulnerability. |
| **Input bounds** | Are request body sizes limited via the framework or `http.Server.MaxHeaderBytes` / `http.MaxBytesReader`? |

**Constraint**: Do NOT compare authentication secrets with `==` or `!=`. Use `crypto/subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1` for all secret comparisons in middleware or handlers.

⚠️ **Blind spot**: `key != expectedKey` compiles, passes tests, and looks correct — but leaks timing information. This is the most commonly missed security pattern in Go API authentication middleware.
