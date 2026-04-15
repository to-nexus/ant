## Frontend Environment — Single Application

**Context**: This project is a frontend-only application. There is no backend server in this workspace.

**Important**: The framework profile (if loaded) determines whether this is a CSR SPA or an SSR-capable framework. This file covers scope boundaries that apply regardless of rendering strategy.

---

### Scope Boundary

**Principle**: All code in this workspace targets the browser runtime (or a browser-targeted build pipeline). There is no backend service to create, configure, or deploy within this workspace.

**Constraint**: Do NOT create backend-scoped tasks or artifacts:
- No API server setup (Express, Fastify, NestJS, etc.)
- No database schema, migration, or ORM configuration
- No server middleware or authentication server logic

**Constraint**: External API dependencies are consumed via HTTP calls, not implemented here. If the specification describes API endpoints, they are **contracts to call**, not contracts to build.

### Task Planning Observations

| Checkpoint | What to observe |
|-----------|----------------|
| **API references in spec** | Are they endpoints to BUILD or endpoints to CONSUME? In frontend scope, always CONSUME. |
| **Data persistence** | Client-side only (localStorage, IndexedDB) or via external API — no local database. |
| **Authentication** | Token management and protected routes — not auth server or session storage. |

### Framework Authority

**Principle**: The framework profile is the single source of truth for rendering strategy, routing model, and build tooling. Do NOT assume or override these decisions at the stack level.

**Constraint**: If the framework profile specifies a build tool (Vite, webpack, etc.) or routing model (client-side router, file-based routing), follow it — even if the existing codebase uses a different tool. The framework profile takes precedence over existing codebase conventions when they conflict.

⚠️ **Blind Spot**: An existing `package.json` may contain a framework different from the one specified in the framework profile. Observe the framework profile first, then the codebase — not the reverse.
