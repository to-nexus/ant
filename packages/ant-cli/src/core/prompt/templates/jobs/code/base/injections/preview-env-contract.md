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
| Next.js | `NEXT_PUBLIC_BASE_PATH` | `...(basePath ? { basePath } : {})` in `next.config.ts` | `''` |

- Framework config MUST read the path prefix from the environment variable
- Client-side router MUST also use the same variable for its base/basename
- Default MUST be empty string or `'/'` when running outside Ant

### Why
- The platform proxy serves each project under a unique path prefix
- All generated URLs (routes, assets, images) must include this prefix
- Both server-rendered and client-rendered content must produce identical URLs

### Platform-Injected Variables

**Constraint**: Base path variables (`NEXT_PUBLIC_BASE_PATH`, `VITE_BASE_PATH`, `ANT_BASE_PATH`) are injected by the platform at dev server startup. Do NOT include them in `.env.example` or `.env`. Do NOT list them in task descriptions as environment file targets.

**Observation target**: If a variable from the Contract table above appears in a task description or specification, wire it into the framework config file only — not into `.env.example`.

⚠️ **Blind spot**: These variables appear in the Contract table alongside connection variables like `PORT`, making them look like regular environment variables that belong in `.env.example`. They are NOT — they are platform-internal and invisible to end users.

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

## 3.5) Monorepo: Environment File Placement

### Principle
**In monorepos with multiple services, environment files follow a layered placement.**

### Contract

| Level | Contains | Example Location |
|-------|----------|-----------------|
| Root | Shared infrastructure connections used by 2+ services | `codebase/.env.example` |
| Per-service | Service-specific configuration and connections used by that service only | `codebase/services/{svc}/.env.example` |

- Root `.env.example` holds variables shared across services (e.g., infrastructure URLs consumed by multiple services)
- Per-service `.env.example` holds service-scoped variables (e.g., API keys, service-specific settings, PORT default)
- Both levels use `@connection` annotation for connection variables
- ALWAYS create `.env` alongside each `.env.example` with resolved localhost values
- Single-service projects: root-level only (no per-service split needed)

### Why
- The platform loads environment from BOTH levels (root first, then per-service override)
- Per-service files make each service's dependencies self-documenting
- Shared infrastructure at root avoids URL duplication

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
- **`self`** -- `ant-project` resolution targeting another package within the same project (e.g., frontend connecting to its own backend in a fullstack project, or backend-A connecting to backend-B in a monorepo). The platform auto-resolves to the correct internal proxy path at runtime. **Precondition — `self` is legal ONLY when a runnable backend sibling package actually exists in THIS workspace**: the package the connection resolves to must be present and serve the endpoint. A frontend-only workspace whose backend is virtualized (there is NO backend package in the workspace) MUST use the default (no modifier) `url` resolution and let the Service Virtualization mock stand in for the absent external backend — tagging such a connection `self` resolves to an internal proxy path that points at nothing (a dead route in the preview's connection view). This mirrors the existence precondition the `ant-project:` modifier already carries.
- **`ant-project:{projectId}:{feature}`** -- `ant-project` resolution targeting a **different Ant project**. Use when the specification explicitly names another project as a dependency (e.g., a frontend project that uses a separately managed backend project). The platform auto-resolves to the target project's proxy path at runtime. Optionally append **`:{serviceName}`** to target a specific service within a multi-package project (e.g., `ant-project:my-be:main:api`). When omitted, the platform routes to the project's default entry service.

Examples:
```env
# Same-project internal connection (frontend → backend in fullstack/monorepo)
# @connection business backend-api self
VITE_API_BASE_URL=

# Cross-project connection (frontend project → separate backend project)
# @connection business backend-api ant-project:sketch-be:skeleton
VITE_API_BASE_URL=

# Cross-project connection targeting a specific service in a multi-package backend
# @connection business stats-api ant-project:sketch-be:skeleton:stats
VITE_STATS_BASE_URL=

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
- For `ant-project:{projectId}:{feature}[:{serviceName}]`, the `projectId` and `feature` MUST match existing Ant project identifiers. The optional `serviceName` targets a specific package within a multi-service project

### One Connection, One Variable

**Principle**: Each external service MUST be represented by exactly ONE annotated connection variable using a URL-format connection string. Do NOT split a single service connection into multiple environment variables.

**Constraint**: If a service accepts a connection URL (e.g., `redis://host:port/db`, `postgresql://user:pass@host:port/db`, `amqp://user:pass@host:port/vhost`), use ONE URL variable with `@connection` annotation. Do NOT additionally create decomposed variables (HOST, PORT, PASSWORD, DB) for the same service — they cause the platform to detect phantom duplicate connections.

**Constraint**: Non-connection configuration for a service (timeout, pool size, retry count) does NOT need `@connection` annotation — it is plain configuration, not a connection endpoint.

**Constraint**: Each `@connection` name MUST be unique within a single `.env.example` file. In monorepos, if a connection is already declared in root `.env.example` (shared infrastructure), do NOT redeclare it in per-service `.env.example`.

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
- Same-project internal connections **to a runnable sibling package that exists in this workspace** use the `self` keyword; a virtualized or otherwise absent backend (no backend package present) uses NO modifier (`url`)
- Cross-project connections use `ant-project:{projectId}:{feature}[:{serviceName}]` when the specification names a specific target project

---

## 4.5) Service Virtualization (business connections)

### Principle
**Every `business` `@connection` declares an external dependency that the project MUST be able to virtualize.** No additional annotation token is required — the `business` category itself is the virtualization signal. Each business connection MUST be reachable through a port whose production and virtualized adapters are wired side-by-side, with the runtime selecting the active adapter via env var. The adapter-pair shape, the identical-interface / consumer-usability contract, and the closed-system rule are specified by the Service Virtualization Contract (injected alongside this section whenever business connections exist); this section owns only the concrete env-var mechanics below.

This is the implementation of Service Virtualization (Mountebank / WireMock-class pattern) at the code-job level. `infrastructure` connections are NOT virtualization targets — local infra (DB / cache / queue via docker-compose) is real, not virtualized.

### Toggle Variable Naming (framework-aware)

The toggle env var name is derived from the `@connection` name AND the
runtime visibility required by the adapter factory's consumer. Framework
bundlers (Next.js, Vite, CRA) strip non-prefixed `process.env.*` references
from the browser bundle, so an unprefixed `USE_MOCK_*` read in client code
inlines as `undefined`, the production adapter activates silently, and the
app makes real network calls that fail with **no build or type error**.
This is the single most common Service Virtualization defect.

| Consumer runtime | Toggle name | Master broadcast | Example (`@connection business stripe-api`) |
|---|---|---|---|
| Server-only (Node, RSC, server actions, backend services) | `USE_MOCK_<NAME>` | `USE_MOCK` | `USE_MOCK_STRIPE_API` |
| Next.js — adapter selected from a client component or a module imported by one | `NEXT_PUBLIC_USE_MOCK_<NAME>` | `NEXT_PUBLIC_USE_MOCK` | `NEXT_PUBLIC_USE_MOCK_STRIPE_API` |
| Vite (React / Vue SPA) | `VITE_USE_MOCK_<NAME>` | `VITE_USE_MOCK` | `VITE_USE_MOCK_STRIPE_API` |
| CRA | `REACT_APP_USE_MOCK_<NAME>` | `REACT_APP_USE_MOCK` | `REACT_APP_USE_MOCK_STRIPE_API` |

`<NAME>` = uppercase snake of the `@connection` name (hyphens → underscores).

**Determining the runtime**: if any file in the frontend package selects
the adapter (factory module, store, hook, page component, shared module
imported by a client component), the toggle MUST use the framework prefix.
The default for any business connection consumed by a frontend package is
the prefixed form. Only when adapter selection is exclusively server-side
(backend service, dedicated server module never imported by client code)
does the bare `USE_MOCK_<NAME>` apply.

### .env / .env.example Discipline

Every business `@connection` MUST have its toggle line in `.env.example` with a comment describing what virtualization provides. The master broadcast toggle MAY be present in `.env.example` for default-broadcast across every business connection lacking a per-connection override. `.env` MUST mirror `.env.example` keys (per the existing invariant). Adapter-specific config that ONLY the virtualized adapter reads MUST also appear in `.env.example` so the contract is self-documenting.

Examples:

```env
# Third-party API consumed from a Next.js client component
# @connection business stripe-api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_USE_MOCK_STRIPE_API=true

# Same-project backend consumed from a Vite SPA
# @connection business backend-api self
VITE_API_BASE_URL=
VITE_USE_MOCK_BACKEND_API=true

# Server-only third-party API (consumed only from backend service)
# @connection business notification-service
NOTIFICATION_SERVICE_URL=
USE_MOCK_NOTIFICATION_SERVICE=true

# Master broadcast (optional) — uses the same framework prefix as the
# per-connection toggles in the same .env.example
NEXT_PUBLIC_USE_MOCK=true
```

### Constraints
- Annotation grammar carries NO virtualization token — the `business` category alone is the contract. Adding a `mock:*` token to an annotation has no effect (and is a syntax error in future grammar revisions).
- The toggle line (per the framework-aware naming table above) MUST appear in `.env.example` for every business connection — without it, the toggle is invisible to the runtime.
- `infrastructure` connections never declare virtualization. Toggle env vars attached to infrastructure variable rows have no effect.
- Per-connection toggle and master broadcast in the same `.env.example` MUST share the same framework prefix. Mixing (e.g., `NEXT_PUBLIC_USE_MOCK_STRIPE_API` alongside bare `USE_MOCK`) is a defect because the master broadcast becomes invisible to client code.

### Blind Spot
**The toggle line is EASILY OMITTED from `.env.example`** — without it the per-connection toggle is invisible to the runtime and the virtualized adapter never activates. (The adapter-pair-completeness blind spot itself is owned by the Service Virtualization Contract; verification exercises every business connection in both modes, so a missing toggle line or virtualized adapter surfaces there.)

---

## 5) TOML Configuration File Support

### Principle
**For Go projects using TOML configuration (viper, koanf), the platform also scans `config.example.toml` for `@connection` annotations.** This is an alternative to `.env.example` — the same annotation protocol applies, with one addition: TOML annotations require an explicit `env:VAR_NAME` mapping.

### File Convention

| File | Purpose | Committed? |
|------|---------|-----------|
| `config.example.toml` | Schema with annotations and placeholder values | YES |
| `config.toml` | Active runtime config with resolved values | NO (gitignored) |

The platform auto-creates `config.toml` from `config.example.toml` at startup if it does not exist.

### Contract

| Line | Format |
|------|--------|
| Annotation | `# @connection {category} {name} [modifier] env:{ENV_VAR_NAME}` |
| TOML key | `key = "default_value"` |

The `env:{ENV_VAR_NAME}` token is **REQUIRED** for TOML annotations. TOML keys (e.g., `database.url`) do not correspond to flat environment variable names, so the annotation must explicitly declare which env var the platform should inject.

Examples:
```toml
# Plain configuration (no annotation)
[server]
port = 8080
env = "development"

# Infrastructure connection
# @connection infrastructure postgres env:DATABASE_URL
[database]
url = "postgresql://localhost:5432/mydb"

# Infrastructure connection
# @connection infrastructure redis env:REDIS_URL
[cache]
url = "redis://localhost:6379/0"

# Same-project internal connection (e.g., frontend → backend in fullstack)
# @connection business backend-api self env:API_BASE_URL
[api]
base_url = ""

# Cross-project connection
# @connection business stats-api ant-project:sketch-be:skeleton env:STATS_API_URL
[external]
stats_url = ""
```

### Runtime Injection Mechanism

The platform injects resolved values via **environment variables** (not by modifying the TOML file). The Go application MUST bind TOML keys to env vars so that injected values override file defaults:

```go
// viper example
viper.SetConfigName("config")
viper.SetConfigType("toml")
viper.AddConfigPath(".")
viper.AutomaticEnv()
// Or explicit binding:
viper.BindEnv("database.url", "DATABASE_URL")
```

### Constraint
- `env:VAR_NAME` is REQUIRED in TOML annotations. Without it, the platform cannot inject the connection value and the annotation is ignored.
- A project may use `.env.example` OR `config.example.toml` OR both. If both exist, the platform merges connections from both sources.
- Do NOT declare the same connection in both `.env.example` and `config.example.toml`. Duplicate declarations cause the platform to detect phantom connections.
- `config.example.toml` and `config.toml` MUST contain identical structure (same sections and keys). Modifying one without the other = inconsistency.

### Blind Spot
**`env:VAR_NAME` is EASILY FORGOTTEN in TOML annotations.**
Before completing any task that creates `config.example.toml`, verify every `@connection` line includes `env:VAR_NAME` as the last token.

**`config.toml` is EASILY FORGOTTEN** when `config.example.toml` is created. Both files MUST be created together.

**Decomposed variables are EASILY ADDED alongside a connection URL.**
If `DATABASE_URL` already has `@connection`, do NOT also add `DB_HOST`, `DB_PORT`, `DB_PASSWORD`, `DB_NAME` for the same service. The URL variable is the single source of truth. Decomposed variables cause the platform to detect duplicate connections for the same service.

**`.env.example` / `.env` sync is EASILY BROKEN.**
Any task that adds or modifies environment variables MUST update BOTH files:
- `.env.example` with annotation and placeholder value
- `.env` with the resolved localhost value
If only one file is updated, either the platform cannot detect the connection OR the application fails at runtime.

**Invariant**: At task completion, `.env` MUST contain all variable keys present in `.env.example` with resolved localhost values. This invariant applies to every task — not only tasks whose scope explicitly mentions environment variables.
