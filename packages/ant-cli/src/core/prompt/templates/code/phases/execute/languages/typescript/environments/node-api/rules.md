## 🖥️ Node.js API Server Environment

**Context**: Backend API server handling concurrent HTTP requests

---

### Key Characteristics

1. **Concurrent requests**: Multiple requests handled simultaneously
2. **Long-running process**: Server stays alive, handles many requests
3. **Full Node.js access**: All built-in modules available

---

### Key Constraints

1. **Avoid blocking**: Synchronous operations block ALL requests
2. **Resource management**: Connection pools, file handles, memory
3. **Error handling**: Don't crash the server on individual request errors

---

### Architecture Compliance

**Constraint**: Architecture boundaries defined in System Design MUST be reflected as directory-level boundaries in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries are complementary:
- Framework mechanisms handle dependency resolution and runtime wiring
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: If System Design specifies explicit boundary separation, framework-conventional structure alone does NOT satisfy this requirement. Architecture boundaries MUST exist alongside framework conventions.

⚠️ **Blind spot reminder**: When a framework provides strong module/convention patterns, it is easy to let those patterns become the ONLY structural organization. Verify that each architecture boundary from System Design has a corresponding directory boundary — not just a conceptual separation within framework modules.

---

### Dependency Boundaries for Testability

**Principle**: Modules that depend on external I/O (database clients, HTTP clients, third-party SDKs) should accept those dependencies as constructor or function parameters, not import and call them directly at module scope.

**Observation target**: Does a service or handler module directly import and use a database client or external service at module level?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Constructor/factory parameters** | Does the class constructor or factory function accept its dependencies (repository, client) as parameters? |
| **Module-level side effects** | Does the module import a database client and call it directly in exported functions without any indirection? |
| **Handler-layer boundary** | Does the route handler/controller depend on a service interface or abstract type, not the concrete service class? |

**Constraint**: Do NOT introduce a DI framework or container unless the project already uses one. Constructor injection or function parameters are sufficient.

⚠️ **Blind spot**: Importing a database client at the top of a service file and calling it directly in every function "works" but makes the module impossible to test without a live database. A dedicated test task runs after features — it cannot substitute dependencies unless they are injected.

---

### When Solving Problems

**Analyze first:**
- What does the existing codebase structure look like?
- What patterns are already established?
- What's the error actually telling you?

**For module/build errors:**
- Check `tsconfig.json`, `package.json` configuration first
- Understand the project's module system (ESM vs CommonJS)
- Consider how the project is executed (direct node, tsx, bundler?)

**Key principle:** Configuration fixes over source code changes. Minimal changes.

---

### Design-Prescribed Dependency API Discovery

**Principle**: If a design-prescribed dependency's API is not in your training data, observe it before writing code — do NOT guess function names or type signatures.

**Protocol** (via `read_file` — index then drill-down):

1. `read_file("codebase/node_modules/{package}/package.json")` — find the `types` or `typings` entry point. For scoped packages: `read_file("codebase/node_modules/@scope/name/package.json")`
2. `read_file` the entry `.d.ts` — scan exported symbol names (this serves as the index)
3. If the `.d.ts` is large, use `list_files` to explore the package structure, then read specific sub-module `.d.ts` files relevant to your task

**Constraint**: If the package is not yet installed (`node_modules` does not contain it), inform the user that dependencies need to be installed first.

⚠️ **Blind spot**: Packages from the same organization are easily assumed to follow familiar conventions. Their actual exported types may differ — always verify by reading `.d.ts` files when uncertain.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Module errors | tsconfig.json, package.json settings |
| Build errors | TypeScript configuration, target |
| Runtime errors | Environment variables, paths |
| Dependencies | Missing packages, version conflicts |

---

**Remember:** You already know Node.js server development. Analyze the specific error and project setup before deciding on a solution.
