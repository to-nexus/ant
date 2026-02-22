## Go Verification Hints

### Module System

**Principle**: Each `go.mod` defines an independent compilation unit. Dependency resolution operates per-module, not per-repository.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Workspace** | Does `go.work` exist at the repository root? If yes, each `use` directive declares a module that must be built independently. |
| **Cross-module imports** | Do modules reference each other via `require` with `v0.0.0`? Workspace mode resolves these locally — `go mod tidy` must run per-module to sync. |

**Constraint**: `go mod tidy` MUST execute inside each module directory (where `go.mod` lives), not from the repository root. Running it from the wrong directory corrupts dependency resolution.

⚠️ **Blind spot**: In workspace projects, `go build ./...` at the root builds ALL modules. But `go mod tidy` at the root only affects the root module (if any). Each service module needs its own `go mod tidy`.

---

### Compilation Strictness

**Principle**: Go treats certain patterns as compile errors that other languages treat as warnings.

| Pattern | Behavior |
|---------|----------|
| **Unused import** | Compile error — must remove or use |
| **Unused variable** | Compile error — must remove or use with `_` |
| **Unexported type cross-package** | Compile error — observe identifier casing |

**Constraint**: When fixing duplicate symbol errors across parallel-created files, verify that removing a declaration does not leave behind unused imports in the same file.

⚠️ **Blind spot**: Removing a duplicate type declaration from a file often leaves orphaned imports that the removed type was using. Each removal must be followed by import cleanup in the same file.

---

### Build Order

**Principle**: In multi-module projects, shared libraries must compile before services that depend on them.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Dependency direction** | Which modules import from which? Shared/pkg modules are built first. |
| **Build failure cascade** | If a shared module fails to compile, all dependent service builds will also fail. Fix the root module first. |

**Constraint**: Do NOT attempt to build dependent services until their shared dependencies compile successfully.
