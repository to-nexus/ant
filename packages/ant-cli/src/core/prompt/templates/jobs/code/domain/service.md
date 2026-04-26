## Code-Overlay — Service Domain (Implementation Discipline)

**Activation gate**: job `code` × `domain === 'service'`. Layered on top of `templates/domain/service.md` (workspace identity, D27).

This overlay defines the **implementation discipline** specific to service / SaaS / dashboard / internal-tool projects. Use it when a code intent (`gen-code-sys` / `gen-code-spec` / `gen-code-directive` / `rev-code`) materializes a service feature. The code job decides **how** boundaries collaborate at runtime — design's policies (data ownership, contracts, persistence, RBAC) are taken as inputs and compiled into running code, not redebated here.

### MECE implementation section map

The implementation surface is partitioned into 5 sections. The partition is **mutually exclusive** (each section answers one boundary commitment) and **collectively exhaustive** (the union covers every code-time decision a service feature forces).

| # | Section | Implementation commitment | Outcome the section commits |
|---|---|---|---|
| 1 | Transactional boundary | Where consistency starts and ends | The boundary that begins / commits / rolls back a unit of work; idempotency markers; retry safety |
| 2 | Error propagation | How failure travels | Domain failures vs infra failures vs user-input failures; which boundary maps each into a user-visible response |
| 3 | Authorization gate | Who is allowed | Where RBAC / ACL is enforced (per use-case entry, never per template / per query); audit emission |
| 4 | External-dependency wiring | How the outside world is reached | Contract objects with timeout / retry / fallback owners; mock implementations for development |
| 5 | Observability hook | What runtime emits | Structured log fields, metric names, trace span boundaries — emitted at use-case boundaries, NOT scattered through helpers |

### 1. Transactional boundary

- Each use-case entry begins exactly one unit of work and either commits or rolls back. Nested transactions are forbidden — split the use case if two units of work disagree.
- Idempotency markers (request-id, content hash, natural key) live on the boundary that owns the use-case orchestration. Storage adapters MAY enforce them, but the policy decision is made one layer up.
- Retry-safe operations declare their idempotency contract in the function signature or a sibling type, so callers cannot retry an unsafe operation by accident.

### 2. Error propagation

| Failure class | Propagation | Mapped at |
|---|---|---|
| Domain rule violation | Typed domain error | Use-case entry — translates to 4xx |
| Authorization failure | Distinct typed error | Authorization gate — translates to 401 / 403 |
| Infrastructure failure | Wrapped infrastructure error | Adapter boundary — translates to 5xx with retry hint |
| Validation failure | Field-level errors | Edge / DTO boundary — translates to 422 with field map |

- Re-throwing untyped `Error` from infrastructure is forbidden. Wrap at the adapter boundary into a typed shape.
- The user-visible mapping happens at exactly one boundary (transport layer). Helpers MUST NOT format error responses directly.

### 3. Authorization gate

- Authorization is checked once at the use-case entry, with the actor and the target resource as inputs. Helpers / repositories MUST NOT perform authorization checks (defense-in-depth at the storage layer is OK only when expressed as a policy filter, not as an inline `if (user.role !== 'admin')`).
- Audit emission is the authorization gate's responsibility — every authorized action emits an audit record at the boundary where the decision was made, with actor / resource / outcome fields.
- Permissions are referenced by name, never re-derived per use case. Names live in a single registry (typically the design surface's permission catalog).

### 4. External-dependency wiring

For each external dependency contract (HTTP client, queue, cache, third-party SDK):

- The contract object exposes operations at the conceptual level the design names. Implementation files map the conceptual operations to concrete SDK calls — a contract that leaks SDK types is a leak.
- Timeout, retry, and circuit-breaker decisions live on the boundary that owns the contract. Callers MUST NOT set timeouts ad-hoc.
- A `mock` (or fake) implementation is wired alongside the production implementation. Local infrastructure brought up via docker-compose (DB / cache / queue) is NOT a mock target — it is real infrastructure.

### 5. Observability hook

- Structured logs are emitted at use-case boundaries with a fixed set of fields (`actor`, `action`, `target`, `outcome`, `requestId`, `latencyMs`). Adding fields is a design decision; emitting them inconsistently per call site is forbidden.
- Metric names follow the registry the design surface defines. Helpers MUST NOT mint new metric names without registering them.
- Trace spans wrap use-case entries and adapter calls. Spans MUST NOT wrap individual helper functions — that explodes cardinality.

### Forbidden implementation details (service-specific)

- ❌ Hard-coded timeout / retry numbers inside helpers.
- ❌ Authorization checks inside repositories or template renderers.
- ❌ Reaching into framework internals (request lifecycle hooks, middleware ordering tweaks) to bypass the use-case boundary.
- ❌ Silent fallback to default values when external dependencies are missing — fail explicitly, surface to the error-propagation chain.
- ❌ Use-case-private concerns (storage keys, query shapes) leaking into transport / DTO layer.

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Set the cache TTL to 60 seconds" | "Cache TTL is a configurable adapter setting; the use case owns the invalidation event" |
| **What over How** | "Use Postgres `NOTIFY` for domain events" | "Domain events are emitted at the use-case boundary; the transport is an adapter decision" |
| **Observable over Assumed** | "Most users will have valid input" | Validate at the edge boundary; failed validation produces a typed error with field map |
| **Universal over Specific** (outside the gate) | "Wrap with `axios.create({ timeout: 5000 })`" | The library / config belongs to the framework partial under `basis/techTier/framework/<name>.md` |
| **Constraints over Instructions** | "Handle errors well" | "Adapter MUST wrap infra failures into a typed `InfrastructureError` shape" |
| **Reminders for Blind Spots** | (none) | "⚠️ Authorization checks duplicated across helpers diverge over time — keep them at the use-case boundary" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'service'`. It is REQUIRED to use service implementation vocabulary (`use case`, `transaction`, `RBAC`, `audit`, `idempotency`, `retry`, `circuit breaker`, `SLA`, `non-functional`). It is FORBIDDEN to:

- Specify game-domain implementation concerns (`game loop`, `scene`, `sprite`, `tick`, `oscillator`, `fixed-timestep`) — those live in `jobs/code/domain/game.md`. The matrix gate already excluded them.
- Specify framework-specific APIs (Express / NestJS / Next.js handlers) — those belong to the framework partial under `basis/techTier/framework/`.
- Specify exact pixel layouts, `sprite` filenames, or game-balance numbers — that is a category error against this domain.

### Blind-spot reminders

- ⚠️ **Authorization scattered across helpers** silently diverges. Keep it at the use-case entry; defense-in-depth at the storage layer is OK only as a declarative policy filter.
- ⚠️ **Untyped `Error` re-thrown from infra** loses the actor / resource context required for audit. Always wrap at the adapter boundary.
- ⚠️ **Adapter timeouts hard-coded inside helpers** are invisible to ops and impossible to tune. Surface them as adapter config.
- ⚠️ **Use-case orchestration leaking into transport** (a controller computing `total = items.reduce(...)`) puts domain rules in the wrong layer.

### Refine-mode discipline

When refining existing code (`rev-code`), the directive defines the scope. Do NOT cross into adjacent boundaries (use-case → transport, helper → use-case) even when the refinement reveals an issue there — surface the issue as an open question or a follow-up directive, do not silently rewrite.
