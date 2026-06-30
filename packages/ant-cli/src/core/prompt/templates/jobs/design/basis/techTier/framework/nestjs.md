## Framework Grounding — NestJS

**Applies when**: a NestJS backend is the grounded codebase (via PRD, directive, or codebase profile).

When the spec/design is grounded on an existing NestJS codebase, anchor every decision in the framework's observable structure rather than a generic backend mental model. Inspect the codebase before asserting where behavior lives.

---

### Routing & path shape

**Principle**: The externally-reachable path of an endpoint is composed, not declared in one place. Observe each contributing layer before specifying an expected URL.

- The global prefix (`app.setGlobalPrefix(...)` at bootstrap) — present or absent. Its presence/absence is the single most common source of path mismatch between a client and the server.
- Controller-level path (`@Controller('...')`) and handler-level path (`@Get/@Post('...')`).
- Versioning (`enableVersioning`) when configured.

**Constraint**: When the spec reasons about a 404 / route-not-matched symptom, observe the composed path across ALL layers above — do NOT assume the controller path is the full path.

### Composition & boundaries

**Principle**: The dependency graph is resolved by the DI container from module composition, not from import order.

- Module composition (`@Module({ imports, providers, exports, controllers })`) is the integration host; a provider is reachable across modules only when `exports`-ed.
- Application-wide behavior (guards, pipes, interceptors, filters) may be bound globally (bootstrap / `APP_*` tokens) or per-handler. Observe which, since it changes where a cross-cutting concern is specified.

### Configuration & environment

**Principle**: Configuration access has a framework-owned seam (`ConfigService` / `ConfigModule`). Specify where a new setting is read, not just that it exists.

### What the spec owns vs defers

Specify the boundary, the contract (route/DTO/error shape), and where each lives. Do NOT author controller/service code or restate NestJS APIs the implementer already knows — the spec names *what* and *where*, the code job decides *how*.
