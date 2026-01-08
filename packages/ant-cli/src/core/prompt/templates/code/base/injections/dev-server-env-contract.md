# Dev Server Runtime Contract (Ant Platform)

This is a **platform contract** for projects that run via Ant-managed development servers.

The Ant platform runs multiple packages (frontend + backend) with **dynamic ports** through a proxy.
Your project MUST be compatible with runtime injection so that:
- Running via Ant works (dynamic ports, proxy routing)
- Running outside Ant still works (project-defined defaults)

---

## 1) Frontend: API Base URL

### Principle
**API calls MUST go through the proxy, not directly to backend.**

Ant injects `VITE_API_BASE_URL` as a **relative proxy path**. This ensures API calls work regardless of where the browser is running (local or remote).

### Contract
- Frontend MUST read `VITE_API_BASE_URL` from environment
- Frontend MUST use it as a **prefix** for all API calls
- Frontend MUST define its own API path structure (e.g., `/api/v1`)
- Frontend MUST provide a sensible default when running outside Ant

### Pattern
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const API_PREFIX = '/api/v1';  // Project-defined

fetch(`${API_BASE}${API_PREFIX}/endpoint`);
```

### Why
- Browser cannot reach server's internal network directly
- Proxy handles routing to the correct backend port
- Works in any deployment environment

---

## 2) Backend: Port Binding

### Principle
**Backend MUST bind to the injected port, not a hardcoded one.**

Ant allocates ports dynamically and injects via `process.env.PORT`.

### Contract
- Backend MUST read port from environment variable
- Backend MUST NOT require a specific hardcoded port

---

## 3) Frontend: Router Basename

### Principle
**Frontend router MUST support dynamic basename for proxy prefix.**

Ant serves frontend under `/dev/{serverKey}/` and injects `window.__BASENAME__` at runtime.

### Contract
- Frontend router MUST read basename from `window.__BASENAME__`
- Frontend MUST provide empty string as default

See `dev-server-setup.md` for framework-specific implementation.
