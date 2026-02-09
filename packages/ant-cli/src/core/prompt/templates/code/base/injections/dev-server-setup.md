# Development Server: Path Prefix Configuration

## Principle

**Frontend MUST support dynamic path prefix for proxy-based routing.**

The platform serves each project under a unique proxy path (`/{serverKey}/`).
Without path prefix configuration, routing and asset loading will break.

---

## Rendering Type Determines Mechanism

**Constraint**: Determine the rendering type FIRST, then apply the correct mechanism.

| Rendering Type | Path Prefix Source | Injection Time |
|---------------|-------------------|----------------|
| **CSR** (client-side only) | `window.__BASENAME__` | Runtime (injected into HTML by proxy) |
| **SSR** (server + client) | Framework config reading environment variable | Build/startup time (injected as env var) |

---

## CSR: Runtime Global Variable

**Principle**: Client-side router MUST read its base path from `window.__BASENAME__`.

**Contract**:
- The proxy injects `window.__BASENAME__` into the HTML `<head>` at runtime
- Client-side router MUST consume this value as its base/prefix
- Default MUST be empty string (`''`) when variable is absent (non-Ant execution)
- TypeScript projects MUST declare the global type

**⚠️ Blind Spot**: Router initialization often happens before DOM is ready. `window.__BASENAME__` is injected as a synchronous `<script>` in `<head>`, so it IS available at module evaluation time.

---

## SSR: Framework-Native Path Config

**Principle**: SSR frameworks MUST use their native path prefix mechanism, NOT `window.__BASENAME__`.

**⚠️ CRITICAL Blind Spot — SSR Hydration Mismatch**:
SSR renders HTML on the server, then the client hydrates it. If path prefixes differ between server and client, hydration fails with prop mismatch warnings. Proxy-level URL rewriting (post-render patching) causes exactly this problem because:
- Server output gets rewritten by proxy (prefixed URLs)
- Client bundle still has original un-prefixed URLs
- React/framework detects the mismatch during hydration

**Constraint**: Do NOT use `window.__BASENAME__` for SSR frameworks. It only patches the client side.

**Contract**:
- The platform injects `NEXT_PUBLIC_BASE_PATH` as an environment variable at dev server startup
- Framework config MUST read this env var and set its native path prefix option
- Default MUST be empty string when env var is absent (non-Ant execution)
- This ensures server-rendered HTML and client bundle produce identical URLs

**⚠️ Blind Spot — SSR Image Optimization**:
SSR frameworks with built-in image optimization (e.g., `next/image`) may internally fetch images in a way that ignores the path prefix. Disable image optimization when running in the proxy environment to avoid broken images.

**Contract**:
- When path prefix env var is set, image optimization MUST be disabled
- When path prefix env var is absent (production), image optimization works normally
- This is a conditional toggle, not a permanent disable

---

## When to Skip

- Pure backend API (no frontend routing)
- Static site without client-side routing

