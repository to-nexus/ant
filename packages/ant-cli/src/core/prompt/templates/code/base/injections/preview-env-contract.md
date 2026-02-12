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

### Why
- Browser cannot reach server's internal network directly
- Proxy handles routing to the correct backend port

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
| `VITE_API_BASE_URL` | Fullstack frontends | Backend API routing path |
| `PORT` | All packages | Dynamic port binding |

See `preview-setup.md` for detailed configuration examples.
