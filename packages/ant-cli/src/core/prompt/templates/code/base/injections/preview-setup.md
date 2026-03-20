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

**Constraint**: Framework config file MUST exist before any application code is written. If it does not exist, create it first. Without this config, the dev server proxy cannot route requests correctly.

| Framework | Config File | Setting | Environment Variable |
|-----------|------------|---------|---------------------|
| **Vite** (React/Vue) | `vite.config.ts` | `base: process.env.VITE_BASE_PATH \|\| '/'` | `VITE_BASE_PATH` |
| **Next.js** | `next.config.js` | `basePath: process.env.NEXT_PUBLIC_BASE_PATH \|\| ''` | `NEXT_PUBLIC_BASE_PATH` |

---

## Client-Side Router

**Principle**: Client-side router MUST also read its base path from the framework environment.

**Observation Target**: Does the project use a client-side router? If so, verify it reads the base path from the same environment variable.

| Router | Setting |
|--------|---------|
| **React Router** | `basename={import.meta.env.VITE_BASE_PATH \|\| ''}` |
| **Vue Router** | `createWebHistory(import.meta.env.VITE_BASE_PATH \|\| '/')` |
| **Next.js** | Automatic (basePath in next.config handles routing) |

---

## SSR Image Optimization

**Constraint**: SSR frameworks with built-in image optimization internally fetch images in a way that ignores the path prefix. When path prefix env var is set, image optimization MUST be disabled. When absent (production), it works normally.

**Constraint**: Next.js performs image optimization by default (`<Image>` component routes through `/_next/image`). When `NEXT_PUBLIC_BASE_PATH` is set, add `images: { unoptimized: true }` to `next.config`. When absent, omit this setting (production uses optimization normally).

---

## Blind Spot Reminders

- **Client-side router base path is EASILY FORGOTTEN.** The framework config sets the base path for assets, but the router often needs a separate setting. Verify both.
- **SSR fetch with path prefix**: Server-side data fetching (e.g., API routes) may construct URLs without the base path. Verify that server-side fetches also respect the prefix if they target the same proxy.
- **Static assets in HTML**: Hardcoded paths in HTML templates (favicon, manifest, etc.) are NOT rewritten by the framework base path. Use relative paths or template the prefix.
- **Framework image component is EASILY SKIPPED.** Bare `<img>` tags do NOT receive basePath prefix. Use the framework's image component (Next.js `<Image>`, Nuxt `<NuxtImg>`) for ALL local image references so that basePath is automatically applied. Reserve bare `<img>` only for external URLs.

---

## When to Skip

- Pure backend API (no frontend routing)
- Static site without client-side routing
