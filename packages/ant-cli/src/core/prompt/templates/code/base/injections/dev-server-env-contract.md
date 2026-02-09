# Dev Server Runtime Contract (Ant Platform)

**Platform contract** for projects running via Ant-managed development servers.

**Principle**: Project MUST accept runtime-injected configuration so that:
- Running via Ant works (dynamic ports, proxy routing)
- Running outside Ant still works (project-defined defaults)

**Constraint**: Do NOT hardcode values that the platform injects. Always read from the injected source with a sensible default.

---

## 1) Frontend: API Base URL

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

## 2) Backend: Port Binding

### Principle
**Backend MUST bind to the injected port, not a hardcoded one.**

### Contract

| Variable | Purpose | Default when absent |
|----------|---------|-------------------|
| `PORT` | Dynamic port allocated by platform | Project-defined default |

- Backend MUST read port from `process.env.PORT`
- Backend MUST NOT require a specific hardcoded port

---

## 3) Frontend: Router Path Prefix

### Principle
**Frontend MUST support dynamic path prefix for proxy routing.**

### Contract

| Rendering Type | Variable | Injection Method |
|---------------|----------|-----------------|
| CSR | `window.__BASENAME__` | Runtime `<script>` tag in HTML |
| SSR | `NEXT_PUBLIC_BASE_PATH` | Environment variable at startup |

- CSR: Client-side router MUST read base path from `window.__BASENAME__`
- SSR: Framework config MUST read path prefix from environment variable
- Both MUST default to empty string when running outside Ant

**⚠️ Constraint**: Do NOT use `window.__BASENAME__` for SSR frameworks. Server-rendered HTML and client bundle must produce identical URLs — only the framework's native path config achieves this.

See `dev-server-setup.md` for detailed principles and constraints.