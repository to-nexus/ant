## 🌐 Browser/Frontend Environment

**Context**: Client-side code running in web browsers

**Includes:**
- **CSR (Client-Side Rendering)**: React SPA, Vue SPA, Angular apps
- **SSR (Server-Side Rendering)**: Next.js, Remix, SvelteKit, Nuxt

**Note**: SSR frameworks like Next.js are considered "frontend" environment, not "fullstack".  
They run in the browser (with optional server-side rendering), but are NOT backend server + frontend monorepos.

---

### For CSR Frameworks (React, Vue, Angular)

**Key Constraints:**
1. **No Node.js APIs**: `fs`, `path`, `crypto`, `http`, `child_process` etc. don't exist in browsers
2. **Sandboxed**: No direct filesystem access, limited system access
3. **Security**: CORS restrictions, no access to other origins without server cooperation

**Common Alternatives:**

| Node.js Need | Browser Alternative |
|--------------|---------------------|
| File storage | `localStorage`, `IndexedDB`, or backend API |
| File reading | `<input type="file">` + FileReader, or fetch from API |
| Crypto | Web Crypto API (`crypto.subtle`) |
| Path operations | URL API, string manipulation |
| Environment vars | Build-time injection (Vite: `import.meta.env`) |

---

### For SSR Frameworks (Next.js, Remix, SvelteKit, Nuxt)

**CRITICAL: Dual Environment Awareness**

SSR frameworks run code in TWO contexts:
1. **Server context**: Server Components, API Routes, `getServerSideProps`
2. **Client context**: Client Components, browser-side code

**Before writing ANY code, determine:**
- Where will this code execute? (Server / Client / Both)
- What APIs are available in that context?

**Key Constraints:**

| Context | Node.js APIs | Browser APIs | Examples |
|---------|--------------|--------------|----------|
| Server Components / API Routes | ✅ Yes | ❌ No | `fs`, `path`, database access |
| Client Components | ❌ No | ✅ Yes | `useState`, `localStorage`, DOM |
| Shared/Universal | ❌ No | ❌ Limited | Pure logic, fetch (both have it) |

**Common Patterns:**
- **Data fetching**: Server components fetch directly, client components use API routes or React Query
- **Environment variables**: Server-only secrets vs public client vars (framework-specific prefixes like `NEXT_PUBLIC_`)
- **File operations**: Only in API routes or server components
- **Database access**: Only in server context (API routes, server components)

**Framework-Specific Patterns:**
- Check framework profile in `core/prompt/profiles/frameworks/` for detailed patterns
- Examples: `nextjs.md`, `remix.md` (if exist)

---

### ⚠️ Blind Spot: Transitive Dependency Runtime Conflict

**Principle**: A direct dependency that works in the browser may carry transitive dependencies that reference Node.js built-in modules (`fs`, `os`, `child_process`). The bundler traces the full dependency tree into the client bundle, causing "Module not found" at build time.

**Constraint**: When adding a dependency to a browser or SSR project, determine whether it is designed for the client runtime:

| Situation | Action |
|-----------|--------|
| Package itself is a Node.js-only tool (logger, CLI util, filesystem lib) and you are importing it in client code | Choose a browser-compatible alternative for the same functional need |
| Package is required for the project (SDK, framework plugin) but its transitive deps include Node.js modules | Keep the package; configure the bundler to stub the offending transitive modules in client builds (see framework profile for `resolve.fallback`) |

**Key distinction**: The decision depends on whether the package itself serves a client-side need, NOT on whether its dependency tree is clean. A Web3 SDK that internally uses a Node.js logger is still a valid client dependency — the transitive conflict is resolved at the bundler level.

---

### ⚠️ Blind Spot: SSR Hydration Mismatch

**Principle**: SSR frameworks expect server-rendered HTML and client initial render to produce identical DOM. A `typeof window !== 'undefined'` or `typeof document !== 'undefined'` guard that changes rendered output causes React hydration failure.

**Constraint**: Do NOT branch rendering logic on browser API availability checks. Both server and client initial render must return the same JSX. Defer browser-only rendering to `useEffect` + `useState(false)` mount guard.

**Common triggers**: `createPortal(... document.body)`, viewport-dependent layout, `localStorage`-based initial state.

---

### ⚠️ Blind Spot: SSR Base Path

**Principle**: SSR frameworks generate URLs on BOTH server and client. Both MUST produce identical paths.

**Constraint**: If the framework config does not include a dynamic base path from an environment variable, server-rendered HTML produces asset URLs that do not match the proxy path -- causing hydration mismatch and broken assets.

**Observation Target**: Does the framework config file read base path from an environment variable? If not, this MUST be fixed before proceeding with feature code.

**ANT Platform Variables** — injected at runtime by ProcessSpawner — do NOT define in `.env.example`:

| Variable | Framework | Config file usage |
|----------|-----------|-------------------|
| `NEXT_PUBLIC_BASE_PATH` | Next.js | `next.config.ts` → `basePath: process.env.NEXT_PUBLIC_BASE_PATH \|\| ''` |
| `VITE_BASE_PATH` | Vite | `vite.config.ts` → `base: process.env.VITE_BASE_PATH \|\| '/'` |
| `ANT_BASE_PATH` | All | Universal fallback |

⚠️ **Constraint**: Do NOT add `NEXT_PUBLIC_BASE_PATH`, `VITE_BASE_PATH`, or `ANT_BASE_PATH` to `.env.example`. These are platform-injected variables — defining them (even as empty values) in `.env.example` pollutes user-facing config with internal platform concerns.

**Next.js `next.config.ts` — Correct Pattern:**
```typescript
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // Do NOT add: images: { unoptimized: !!basePath }
};
```

⚠️ **Critical Blind Spot — `images: { unoptimized: !!basePath }` breaks image routing**:

When `images.unoptimized: true`, `next/image` returns the `src` attribute **unchanged** (no basePath prefix). All image requests go to the fallback proxy without the urlKey, which cannot route them correctly.

When `unoptimized` is NOT set (default), `next/image` generates `/{basePath}/_next/image?url=...` — this URL contains the urlKey, so the main proxy routes it correctly.

| Config | next/image output | Proxy path | Result |
|--------|-------------------|------------|--------|
| `unoptimized: true` | `<img src="/icons/logo.svg">` | fallback | ❌ 404 |
| `unoptimized: false` (default) | `<img src="/{basePath}/_next/image?url=...">` | main proxy | ✅ works |

SVG assets must NOT use `<Image>` at all — import them as SVGR components (see Static Assets section below).

---

### Dependency Boundaries for Testability

**Principle**: Side effects and external I/O (API calls, storage access, third-party SDK interactions) should be isolated in dedicated service modules or custom hooks, not embedded directly in component render logic.

**Observation target**: Does a component directly perform external I/O inline?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **API calls** | Does a component call `fetch` or an HTTP client directly in its body or event handlers? Isolate into a service module or custom hook. |
| **Storage access** | Does a component directly read/write `localStorage`, `sessionStorage`, or `IndexedDB` inline? Isolate into a dedicated hook or utility. |
| **Provider boundaries** | Are shared dependencies (API clients, auth state, feature flags) accessible through context providers that can be replaced in tests? |

**Constraint**: Do NOT over-architect. A component with a single, simple `fetch` call does not need a service layer. Apply when the component has multiple external dependencies or non-trivial data transformations before rendering.

⚠️ **Blind spot**: When API calls are embedded in component render functions, a test task must either mock the global `fetch` (fragile, leaks across tests) or restructure the component (violates source modification constraint). Isolating I/O into importable modules enables clean module-level mocking.

---

### When Solving Problems

**Analyze first:**
- Is this a client-side or server-side concern?
- For SSR: Which context is this file/component? (check for `'use client'` directive, file location)
- What APIs are available in the current context?
- Does this need a backend API call?

**Key principle:** 
- For CSR: If you need Node.js capabilities, create an API endpoint and call it from the browser
- For SSR: Use server components/API routes for Node.js capabilities, client components for browser interactions

---

### Design-Prescribed Dependency API Discovery

**Principle**: If a design-prescribed dependency's API is not in your training data, observe it before writing code — do NOT guess function names or type signatures.

**Protocol** (via `read_file` — index then drill-down):

1. `read_file("codebase/node_modules/{package}/package.json")` — find the `types` or `typings` entry point. For scoped packages: `read_file("codebase/node_modules/@scope/name/package.json")`
2. `read_file` the entry `.d.ts` — scan exported symbol names (this serves as the index)
3. If the `.d.ts` is large, use `list_files` to explore the package structure, then read specific sub-module `.d.ts` files relevant to your task

**Constraint**: If the package is not yet installed (`node_modules` does not contain it), inform the user that dependencies need to be installed first.

⚠️ **Blind spot**: Packages from the same organization are easily assumed to follow familiar conventions. Their actual exported types may differ — always verify by reading `.d.ts` files when uncertain.

---

## 🎨 Design Tokens Configuration

When `ui-tokens.json` is provided, configure tokens in the project's styling system.

**Principle**: The project's installed styling tool and its configuration files determine the token integration method. Read existing config files (postcss, bundler, styling framework) to determine the correct approach — do NOT assume a specific tool version or configuration format.

**Constraint**: When a styling framework provides a token-to-class mapping mechanism, use semantic token classes — not hardcoded values.

```tsx
// ❌ WRONG: Hardcoded values bypass the token system
className="bg-[#121212] text-[#00E676]"

// ✅ CORRECT: Semantic token classes
className="bg-bg-dark text-primary-green"
```

**⚠️ Blind Spot — Utility framework source scan mismatch:**

CSS utility frameworks generate classes only for source files covered by their configured scan paths. A mismatch between configured paths and actual source directories causes **silent failure** — the CSS file loads normally but contains only the base reset, making this invisible in network/console.

**Observation target**: Verify the styling framework's source scan configuration covers all directories where styled components exist.

---

### ⚠️ Shared UI Component Duplication

**Principle**: Shared UI primitives may already exist if a design-system task ran before this one. Do not create duplicates.

**Observation target**: Before creating a UI primitive (Button, Badge, Input, Card, etc.), read the shared component location indicated by the design specification.

| Observation | Constraint |
|-------------|------------|
| A matching component already exists at any path in the codebase | Import from that path. Do NOT create a new implementation at a different path. |
| No matching component exists | Create it in a scope appropriate to this task. |

**Constraint**: Do NOT create a new implementation of a component that already exists elsewhere in the codebase. Having two implementations of the same primitive at different paths causes import divergence — different parts of the app use different implementations, breaking visual and behavioral consistency.

⚠️ **Blind spot**: The existing component may be at `<shared-dir>/badge/badge.tsx` (subdirectory) while you target `<shared-dir>/badge.tsx` (flat file). These are different paths — the file system will not warn you. Always read the shared component directory, not just check a specific target path.

---

## 🧩 UI Component Integration Patterns

### Component Render Chain Completeness

**Principle**: Creating a component is INCOMPLETE until it is rendered by a parent within YOUR task's scope. Orphan components that exist but are never imported are a task failure.

**Constraint**: Every component you create MUST be imported and rendered in a page or layout file that YOUR task owns. The render chain must be complete from page entry point down to leaf components.

**Scope clarification**: "Entry point" means the page or layout file that YOUR task description covers — NOT shared application-wide entry points (like root layout or router) that belong to setup or integration tasks. If your task says "Implement Hero section", the page file that displays the Hero section is within YOUR scope.

**Anti-Pattern (TASK FAILURE):**
```tsx
// ❌ WRONG: Component created but page still has placeholder text instead of rendering it
// ✅ CORRECT: Page imports and renders the component — no placeholders remain
```

**Verification:**
- [ ] Every component created in this task is imported and rendered by a parent
- [ ] The render chain reaches a page/layout entry point within YOUR task scope
- [ ] No `{/* ... Placeholder */}` comments remain in files YOU own

---

## 🖼️ Static Assets

When using `ui-assets.json`:

**Observation target**: What is the `format` field of the asset?

| format | File placement | Code pattern | Why |
|--------|---------------|--------------|-----|
| `svg` | Source tree (`src/assets/`) | `import Icon from '@/assets/icon.svg'` → `<Icon />` | `public/` files are NOT in webpack module graph → SVGR cannot process them. `<Image>`/`<img>` with SVG → Next.js optimizer rejects SVG; bare `<img>` has no basePath → 404 in proxy. |
| `png`, `jpg`, `webp` | `public/` | `<Image src="/assets/photo.png" />` | Framework image component auto-applies basePath. Bare `<img>` for raster = basePath not applied = proxy routing failure. |

**Constraint**: SVG format assets MUST be placed in the source tree (`src/assets/`) and imported as SVGR React components. Placing SVGs in `public/` makes SVGR import impossible — webpack only processes the source tree.

```tsx
// SVG: import as React component (SVGR — inline, no URL, SSR/CSR safe)
import CalendarIcon from '@/assets/icon-calendar.svg';
import LogoIcon from '@/assets/logo-horizontal.svg';
<CalendarIcon className="text-gray-500" />

// Raster — Next.js:
import Image from 'next/image';
<Image src="/assets/photo.png" alt="Photo" width={400} height={300} />

// Raster — Vite/React:
<img src={`${import.meta.env.VITE_BASE_PATH || ''}/assets/photo.png`} alt="Photo" />
```

### SVG Component Sizing

**Principle**: An inline `<svg>` element with only a `viewBox` and no `width`/`height` attributes expands to fill its parent container. This applies regardless of how the SVG was imported (SVGR, raw inline, or any other SVG-to-component loader).

**Observation target**: Check `ui-assets.json` for the asset's `rendering` field.

| rendering.method | Action |
|-----------------|--------|
| `explicit` | Apply `rendering.width` and `rendering.height` as `width` and `height` props on the SVG component |
| `fill` | SVG fills parent — parent MUST have explicit dimensions |

**Constraint**: When `rendering.method` is `explicit`, the component MUST receive `width` and `height` from `ui-assets.json` rendering field values. CSS size classes are acceptable only when the design spec prescribes different sizing in a specific usage context.

---

### SVG Color Adaptation (SVGR post-processing)

After importing as SVGR component, check `ui-assets.json` for `themeAdaptation`. **If the field is missing, default to `"currentColor"`.**

| themeAdaptation | Action | Why |
|----------------|--------|-----|
| `currentColor` (or missing) | Replace hardcoded `fill`/`stroke` colors with `currentColor` | Icon inherits CSS `color` → adapts to light/dark theme |
| `static` | Keep original colors | Brand assets with specific colors |
| `partial` | Replace non-brand colors with `currentColor`, keep brand colors | Selective theme adaptation |

```tsx
// ❌ WRONG: <img> with theme-dependent SVG — color won't change
<img src="/icons/wallet.svg" />

// ✅ CORRECT: Inline SVG inherits text color
<WalletIcon className="text-gray-700 dark:text-gray-300" />
```

---

## 🖼️ Image Rendering Verification

When images fill their container (fill mode, 100% size, background-size: cover, etc.):

**Principle:** The parent container MUST have explicit or computable dimensions.

| Pattern | Result |
|---------|--------|
| Parent has explicit size (e.g., `h-[200px]`) | ✅ Image renders |
| Parent uses aspect-ratio AND has computed width | ✅ Image renders |
| Parent uses `height: auto` with no content | ❌ Height = 0, image invisible |
| Parent uses `100%` but ancestor has no size | ❌ Height = 0, image invisible |
| Responsive: `h-[200px] lg:h-auto` | ❌ Desktop height = 0 |

**⚠️ aspect-ratio Requires Width:**
```tsx
// ❌ BROKEN: aspect-ratio but width not computed (flex item without basis)
<div className="flex">
  <div className="aspect-[4/3]">  {/* width = 0, so height = 0 */}
    <Image fill />
  </div>
</div>

// ✅ WORKS: aspect-ratio with explicit or computed width
<div className="grid grid-cols-3">
  <div className="aspect-[4/3]">  {/* grid computes width */}
    <Image fill />
  </div>
</div>
```

**⚠️ Responsive Breakpoint Trap:**
```tsx
// ❌ BROKEN: Mobile works, desktop fails
<div className="h-[200px] lg:h-auto">  {/* lg: height becomes 0 */}
  <Image fill />
</div>

// ✅ WORKS: All breakpoints have computable height
<div className="h-[200px] lg:h-[300px]">
  <Image fill />
</div>
```

**Quick Check:** Trace size computation at EACH breakpoint. If any breakpoint relies on content for size but has none, image fails.

---

## 🎨 Overlay Opacity Check

When applying overlay gradients on background images:

**Principle:** Overlay should enhance visibility, not replace the background.

| Opacity Range | Effect |
|---------------|--------|
| 20-60% | Background visible through overlay |
| 60-80% | Background faintly visible |
| 90%+ | Background effectively invisible |

**Quick Check:** If overlay opacity > 80%, verify the background is intentionally hidden. If not, reduce opacity.

---

**Remember:** You already know these frameworks. Analyze the codebase structure and follow existing patterns.
