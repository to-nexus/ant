## Framework Grounding — Gin (Go)

**Applies when**: a Gin (Go) backend is the grounded codebase.

When the spec/design is grounded on an existing Gin codebase, anchor decisions in the framework's observable routing and middleware structure. Inspect before asserting.

---

### Routing & path shape

**Principle**: The reachable path is composed from router groups + handler registration. Observe each layer before specifying an expected URL.

- Route group prefixes (`router.Group("/api/v1")`) and nested groups — the composed prefix, not a single declaration, determines the full path.
- Per-route method + path registration and the middleware attached at group vs route level.

**Constraint**: For a route-not-matched symptom, observe the composed group prefixes across all levels — do NOT assume a handler's path is the full path.

### Composition & boundaries

**Principle**: Specify where behavior lives across handler, service, and data layers; Go's package structure is the boundary.

- Handler layer (request binding, response shaping) vs service/domain layer vs data-access layer — observe the existing package split before placing new behavior.
- Where cross-cutting middleware (auth, logging, recovery) is registered (engine-global vs group vs route).

### What the spec owns vs defers

Specify the route contract, the package/boundary placement, and the error/response shape. Do NOT author handler code or restate Gin/Go APIs — name *what* and *where*; the code job decides *how*.
