# Dev Server Runtime Contract (Ant Platform)

**Platform contract** for projects running via Ant-managed development servers.

**Principle**: Project MUST accept runtime-injected configuration so that:
- Running via Ant works (dynamic ports, proxy routing)
- Running outside Ant still works (project-defined defaults)

**Constraint**: Do NOT hardcode values that the platform injects. Always read from the injected source with a sensible default.

---

## 1) Frontend: Base Path Prefix

### Principle
**Frontend MUST use its framework's native base path mechanism, reading from an environment variable.**

### Contract

| Framework | Variable | Config Setting | Default when absent |
|-----------|----------|---------------|-------------------|
| Vite (React/Vue) | `VITE_BASE_PATH` | `base: process.env.VITE_BASE_PATH \|\| '/'` | `'/'` |
| Next.js | `NEXT_PUBLIC_BASE_PATH` | `basePath: process.env.NEXT_PUBLIC_BASE_PATH \|\| ''` | `''` |

- Framework config MUST read the path prefix from the environment variable
- Client-side router MUST also use the same variable for its base/basename
- Default MUST be empty string or `'/'` when running outside Ant

### Why
- The platform proxy serves each project under a unique path prefix
- All generated URLs (routes, assets, images) must include this prefix
- Both server-rendered and client-rendered content must produce identical URLs

---

## 2) Frontend: API Base URL

### Principle
**API calls MUST go through the proxy, not directly to backend.**

### Contract

| Variable | Purpose | Default when absent |
|----------|---------|-------------------|
| `VITE_API_BASE_URL` | Relative proxy path for API routing | `''` (empty string) |

- Frontend MUST read API base from environment
- Frontend MUST use it as a prefix for all API calls
- Frontend MUST define its own API path structure (project-specific)

**Constraint**: Frontend code does NOT need to know how `VITE_API_BASE_URL` is resolved. It reads the variable and prepends it to API requests. The platform resolves the value at runtime.

### Why
- Browser cannot reach server's internal network directly
- Proxy handles routing to the correct backend port
- Cross-project linking is transparent to frontend code

---

## 3) Backend: Port Binding

### Principle
**Backend MUST bind to the injected port, not a hardcoded one.**

### Contract

| Variable | Purpose | Default when absent |
|----------|---------|-------------------|
| `PORT` | Dynamic port allocated by platform | Project-defined default |

- Backend MUST read port from `process.env.PORT`
- Backend MUST NOT require a specific hardcoded port

---

## Summary

| Variable | Injected For | Purpose |
|----------|-------------|---------|
| `VITE_BASE_PATH` | Vite frontends | Asset and route path prefix |
| `NEXT_PUBLIC_BASE_PATH` | Next.js projects | basePath for SSR + CSR |
| `ANT_BASE_PATH` | All frontends | Universal fallback |
| `VITE_API_BASE_URL` | Frontends with backend | Backend API routing path (same-project or cross-project) |
| `PORT` | All packages | Dynamic port binding |

See `preview-setup.md` for framework-specific base path configuration.

---

## 4) Service Connection Annotation

### Principle
**The platform auto-detects service dependencies by scanning `.env.example` for `@connection` annotations.** An environment variable that connects to an external service is fundamentally different from plain configuration. The platform needs to distinguish them.

### Observation Target

For each environment variable in `.env.example`, determine:
**Does this variable connect to an external service (database, cache, queue, API)?**

- If YES -> annotate with `# @connection {category} {name}` on the line above
- If NO (PORT, NODE_ENV, LOG_LEVEL, etc.) -> no annotation

### Contract

| Line | Format |
|------|--------|
| Annotation | `# @connection {category} {name} [modifier]` |
| Variable | `KEY=default_value` |

Categories:
- `business` -- frontend, backend, microservice, or any application-level endpoint
- `infrastructure` -- database, cache, message queue, or any runtime dependency managed via docker-compose in development

Modifier (optional, determines resolution):
- **(none)** -- default `url` resolution. Use for external services, third-party APIs, or infrastructure with a direct URL.
- **`self`** -- `ant-project` resolution targeting another package within the same project (e.g., frontend connecting to its own backend in a fullstack project, or backend-A connecting to backend-B in a monorepo). The platform auto-resolves to the correct internal proxy path at runtime.
- **`ant-project:{projectId}:{feature}`** -- `ant-project` resolution targeting a **different Ant project**. Use when the specification explicitly names another project as a dependency (e.g., a frontend project that uses a separately managed backend project). The platform auto-resolves to the target project's proxy path at runtime.

Examples:
```env
# Same-project internal connection (frontend → backend in fullstack/monorepo)
# @connection business backend-api self
VITE_API_BASE_URL=

# Cross-project connection (frontend project → separate backend project)
# @connection business backend-api ant-project:sketch-be:skeleton
VITE_API_BASE_URL=

# Infrastructure connection (no modifier)
# @connection infrastructure postgres
{VAR_NAME}={connection_string}

# External third-party API (no modifier)
# @connection business payment-api
{VAR_NAME}={service_url}
```

### Constraint
- Variable names in examples above are PLACEHOLDERS showing annotation FORMAT only. Actual variable names MUST come from the task description or design specification. Do NOT treat example variable names as recommendations
- Variables WITHOUT annotation are invisible to the platform's connection registry
- Annotation MUST be on the line immediately above the variable
- `name` identifies the service for display purposes (lowercase, hyphens allowed)
- `.env.example` is committed; `.env` is .gitignored
- Resolution type is constrained by category:
  - `infrastructure` connections resolve via `url` or `docker` only
  - `business` connections resolve via `url` or `ant-project` only
- For `ant-project:{projectId}:{feature}`, the `projectId` and `feature` MUST match existing Ant project identifiers

### Why
The platform uses annotations to:
- Register connections and inject environment variables at runtime
- Display connection status in the preview configuration UI (grouped by package)
- Diagnose startup failures (missing infra, unreachable endpoints)
- Auto-resolve internal proxy paths for `self` and cross-project `ant-project` connections

Without annotation, a connection variable cannot be managed.

### Blind Spot
**`@connection` annotation is EASILY FORGOTTEN.**
Before completing any task that creates or modifies `.env.example`, verify:
- Every environment variable with a connection URL has `# @connection` above it
- Same-project internal connections use the `self` keyword
- Cross-project connections use `ant-project:{projectId}:{feature}` when the specification names a specific target project

**`.env.example` / `.env` sync is EASILY BROKEN.**
Any task that adds or modifies environment variables MUST update BOTH files:
- `.env.example` with annotation and placeholder value
- `.env` with the resolved localhost value
If only one file is updated, either the platform cannot detect the connection OR the application fails at runtime.
