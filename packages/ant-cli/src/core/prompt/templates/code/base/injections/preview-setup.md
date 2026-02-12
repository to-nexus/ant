# Development Server: Path Prefix Configuration

## Principle

**Frontend MUST support dynamic path prefix for proxy-based routing.**

The platform serves each project under a unique proxy path (`/{urlKey}/`).
Without path prefix configuration, routing and asset loading will break.

---

## Universal Rule: Framework-Native Base Path

**Constraint**: Every frontend framework MUST use its native base path mechanism,
reading from an environment variable injected at dev server startup.

**Contract**:
- The platform injects a base path environment variable at dev server startup
- Framework config MUST read this env var and set its native path prefix option
- Default MUST be empty string or `'/'` when env var is absent (non-Ant execution)
- This ensures ALL generated URLs (routes, assets, images) include the correct prefix

| Framework | Config File | Setting | Environment Variable |
|-----------|------------|---------|---------------------|
| **Vite** (React/Vue) | `vite.config.ts` | `base: process.env.VITE_BASE_PATH \|\| '/'` | `VITE_BASE_PATH` |
| **Next.js** | `next.config.js` | `basePath: process.env.NEXT_PUBLIC_BASE_PATH \|\| ''` | `NEXT_PUBLIC_BASE_PATH` |

---

## Client-Side Router

**Principle**: Client-side router MUST also read its base path from the framework environment.

| Router | Setting |
|--------|---------|
| **React Router** | `basename={import.meta.env.VITE_BASE_PATH \|\| ''}` |
| **Vue Router** | `createWebHistory(import.meta.env.VITE_BASE_PATH \|\| '/')` |
| **Next.js** | Automatic (basePath in next.config handles routing) |

---

## SSR Image Optimization

**Constraint**: SSR frameworks with built-in image optimization may internally fetch images
in a way that ignores the path prefix. Disable image optimization when running in the proxy environment.

**Contract**:
- When path prefix env var is set, image optimization MUST be disabled
- When path prefix env var is absent (production), image optimization works normally
- This is a conditional toggle, not a permanent disable

Example for Next.js:
```js
images: {
  unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH,
}
```

---

## When to Skip

- Pure backend API (no frontend routing)
- Static site without client-side routing
