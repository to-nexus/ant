# Dev Server Runtime Contract (Ant Platform)

This is a **platform contract** for projects that run via Ant-managed development servers.

The Ant platform can run multiple packages (frontend + backend) with **dynamic ports** and serve them through a proxy.
Your project MUST be compatible with runtime injection so that:
- running via Ant works (dynamic ports)
- running outside Ant still works (project-defined defaults / developer setup)

## 1) Frontend: API Base URL is injected at runtime

When Ant starts a fullstack dev server, it starts the backend first, allocates a port, then **injects** that backend address into the frontend process environment.

### Contract
- Frontend MUST support a runtime-configurable API base URL.
- In Vite-based frontends, this is typically exposed as `import.meta.env` variables (e.g. `VITE_API_BASE_URL`).

### Implementation requirement (project-side)
- Prefer configuring your API client to read an injected value (if present).
- Do NOT assume a fixed backend port when running under Ant.

**Note:** The exact variable name is a platform integration detail. If the project uses a different key, Ant can support it only if it is part of the project's declared convention.

## 2) Backend: bind to injected port

Ant allocates backend ports dynamically. Backend servers MUST bind to the injected port (commonly via `process.env.PORT` or an equivalent mechanism supported by the framework).

### Contract
- Backend MUST be able to start on a port provided by the environment.
- Do not require a single fixed port to be hard-coded for the application to run.

## 3) Frontend router proxy prefix (basename)

When running through Ant's dev proxy, the frontend is served under:
`/dev/{tenantId}:{userId}:{projectId}:{feature}/`

Frontends with client-side routing MUST support a dynamic router basename. Ant injects the basename at runtime (e.g., `window.__BASENAME__` in the proxied HTML).

If you see routing failures under `/dev/...`, apply the router basename configuration described in `dev-server-setup.md`.


