## Framework Augmentation — Go API Server

**Applies when**: Go language with API server environment detected (via PRD, directive, or codebase profile)

---

### Goal

Ensure architecture boundaries from System Design map to Go's package-based module system with clear separation between entry points, internal packages, and infrastructure.

---

### A. Reference Project Layout

**Principle**: Go API projects follow a standard top-level layout. Architecture layers from System Design live as sub-packages within this structure, not as root-level directories.

| Top-level directory | Role |
|---------------------|------|
| `cmd/` | Entry points (main packages) |
| `config/` | Configuration loading |
| `docs/` | API documentation |
| `internal/` | Private application packages (architecture layers live here) |
| `router/` | Route definitions and setup |
| `schema/` | Database schemas and migrations |
| `test/` | Integration and E2E tests |

**Constraint**: Adapt (reduce or extend directories) only when the architecture in this design document does not fit this structure.

**Constraint**: Do NOT flatten architecture layers (handler, service, repository, etc.) into root-level directories. They belong as sub-packages within `internal/`.

---

### B. Package Boundary Mapping

**Principle**: Each architecture boundary specified in this document MUST correspond to a Go package boundary.

| Attribute | What to define |
|-----------|---------------|
| **Package scope** | What types and functions belong in this package |
| **Export policy** | Which identifiers are exported (uppercase) vs package-private (lowercase) |
| **Import direction** | What other packages it may import |

**Constraint**: Framework wiring mechanisms (route registration, middleware chaining, DI) and architecture boundaries are complementary — both must coexist. Framework conventions alone do NOT satisfy architecture boundary separation.

---

### C. Dependency Direction

**Principle**: Import direction flows inward. Infrastructure depends on domain interfaces, not the reverse.

| Rule | Description |
|------|-------------|
| **cmd/ → internal/*` | Entry point wires concrete implementations |
| **router/ → internal/handler** | Routes delegate to handler package |
| **handler → service (interface)** | Handler depends on service interface, not concrete type |
| **service → repository (interface)** | Service depends on repository interface |
| **repository → domain types** | Repository implements domain-defined data contracts |
| **domain → nothing** | Domain types and rules have zero external imports |

**Constraint**: Each layer boundary is an interface. Concrete wiring happens at the composition root (`cmd/` or `main()`).

---

### D. Coding Phase Directives

**Principle**: Include a concise checklist of structural constraints the coding phase must enforce.

The design document SHOULD include a "Coding Phase Directives" section with:
- Sub-package structure within `internal/` matching architecture boundaries
- Interface definitions at each layer boundary
- Composition root location (`cmd/` or `main()`)
- Type visibility rules (exported vs unexported) for cross-package types

**Constraint**: Keep directives at principle level. Do NOT list specific function signatures, struct definitions, or implementation details.
