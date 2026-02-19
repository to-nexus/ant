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

### Architecture Compliance

**Constraint**: Architecture boundaries defined in System Design MUST be reflected as directory-level boundaries in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries are complementary:
- Framework mechanisms handle routing, middleware chaining, and dependency injection
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: If System Design specifies explicit boundary separation, framework-conventional structure alone does NOT satisfy this requirement. Architecture boundaries MUST exist alongside framework conventions.

**Blind spot reminder**: When a framework provides strong convention patterns (route groups, handler registration), it is easy to let those patterns become the ONLY structural organization. Verify that each architecture boundary from System Design has a corresponding directory boundary — not just a conceptual separation within framework route groups.

---

### Reference Project Layout

The following is the reference directory structure for Go backend projects.
Use this as the default layout. Adapt (reduce or extend directories) only
when the architecture in System Design does not fit this structure.

```
cmd/           Entry points
config/        Configuration loading
docs/          API documentation
internal/      Private application packages
router/        Route definitions and setup
schema/        Database schemas and migrations
test/          Integration and E2E tests
```

**Constraint**: Do NOT flatten architecture layers into root-level directories.
Layers from System Design (handler, service, repository, etc.) belong as
sub-packages within this layout, not as root directories.

**Constraint**: Before creating any directory, observe the existing directory
tree. Follow established structure.

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

---

### Type Visibility

**Principle**: Identifiers starting with an uppercase letter are exported (cross-package accessible). Lowercase identifiers are package-private.

**Constraint**: When defining a type that will be referenced by another package in the same project, the type name MUST start with an uppercase letter. Decide visibility at definition time, not after a compile error.

⚠️ **Blind spot**: Data-transfer types in a repository package (row structs, result types) are easily created as unexported. If any service or handler package references these types, the build fails. Fixing visibility after the fact causes cascading renames across interface signatures, function returns, and variable declarations — each rename a separate interaction that replays the full conversation.
