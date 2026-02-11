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

**Analyze first:**
- What does the existing codebase structure look like?
- What patterns are already established?
- What's the error actually telling you?

**For build/module errors:**
- Check `go.mod` and `go.sum` first
- Understand the module path and import structure
- Consider whether dependencies need `go mod tidy`

**Key principle:** Configuration fixes over source code changes. Minimal changes.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Import errors | go.mod module path, package naming, circular imports |
| Build errors | Go version compatibility, build tags, CGO dependencies |
| Runtime errors | nil pointer, interface assertion, closed channel |
| Dependencies | go.mod/go.sum consistency, major version suffixes |

---

**Remember:** You already know Go server development. Analyze the specific error and project setup before deciding on a solution.
