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
- Check framework profile in `periphery/profiles/frameworks/` for detailed patterns
- Examples: `nextjs.md`, `remix.md` (if exist)

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

If you need unoptimized output for specific images (e.g., SVGs), use the `unoptimized` prop on individual `<Image>` components, NOT as a global config setting.

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

When `ui-tokens.json` is provided, configure tokens in the project's styling system:

### Tailwind CSS

**⚠️ Blind Spot — `content` path mismatch:**

**Principle**: `content` paths MUST list every directory where source files with styling classes exist.

**Constraint**: Do NOT assume existing `content` paths are correct. Observe the actual source directory structure and verify `content` matches.

**Constraint**: If source files are in a directory not listed in `content`, zero utility classes will be generated for those files. The CSS file still loads normally — it just contains only the base reset, making this failure invisible in network/console.

```javascript
// tailwind.config.js
module.exports = {
  content: [
    // ⚠️ REQUIRED — MUST match actual source directories
  ],
  theme: {
    extend: {
      colors: {
        primary: { green: '#00E676' },
        bg: { dark: '#121212' },
        background: { cardDark: 'rgba(45, 52, 54, 0.8)' },
      },
      fontFamily: { heading: ['Inter', 'sans-serif'] },
      spacing: { section: '120px' }
    }
  }
}
```

**Usage:**
```tsx
// ❌ WRONG: Arbitrary values
className="bg-[#121212] text-[#00E676] bg-[rgba(45,52,54,0.8)]"

// ✅ CORRECT: Token classes
className="bg-bg-dark text-primary-green bg-background-cardDark"
```

### CSS Variables

```css
/* globals.css */
:root {
  --color-primary-green: #00E676;
  --color-bg-dark: #121212;
  --font-heading: 'Inter', sans-serif;
}
```

**Usage:**
```css
.hero { background: var(--color-bg-dark); }
```

### Other Frameworks

| Framework | Configuration |
|-----------|--------------|
| SCSS | `_variables.scss` with `$color-primary`, etc. |
| Styled-components / Emotion | `theme.ts` with theme object |
| Vue/Nuxt | `assets/css/variables.css` |

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

### React/Next.js Component Hierarchy

```
page.tsx (entry point)
  └── SectionName.tsx (parent section)
        └── SectionNameCard.tsx (child component)
```

**Principle**: Creating a component is INCOMPLETE until it is rendered by a parent within YOUR task's scope. Orphan components that exist but are never imported are a task failure.

**Pattern:**
| If You Create | You MUST Also Create | You MUST Also Do |
|---------------|---------------------|------------------|
| `XCard.tsx` | `X.tsx` (parent) | Import `<X />` in the page/layout that YOUR task owns |

**Scope clarification**: "Entry point" means the page or layout file that YOUR task description covers — NOT shared application-wide entry points (like root layout or router) that belong to setup or integration tasks. If your task says "Implement Hero section", the page file that displays the Hero section is within YOUR scope.

**Anti-Pattern (TASK FAILURE):**
```tsx
// ❌ WRONG: Created XCard.tsx but page still has placeholder
<section id="x-section">
  <h2>X Section</h2>  {/* ← PLACEHOLDER! */}
</section>

// ✅ CORRECT: Replaced with actual component
import { X } from '@/components/X';
<X />
```

**Verification Checklist:**
- [ ] Child component created (`XCard.tsx`)
- [ ] Parent section created (`X.tsx`) using children
- [ ] Page/layout within YOUR task scope imports and renders the parent
- [ ] No `{/* ... Placeholder */}` comments remain in files YOU own

---

## 🖼️ Static Assets

When using `ui-assets.json`:

**Next.js**:
```tsx
import Image from 'next/image';

// Raster images (png, jpg, webp): framework image component with optimization
<Image src="/images/photo.png" alt="Photo" width={400} height={300} />

// SVG assets (static themeAdaptation): framework image component WITHOUT optimization
<Image src="/icons/logo.svg" alt="Logo" width={100} height={40} unoptimized />

// SVG assets (currentColor themeAdaptation): inline SVG component (inherits CSS color)
<WalletIcon className="text-current" />
```

**Principle**: SVG files do not benefit from raster image optimization. In Next.js, `<Image>` without `unoptimized` routes SVGs through `/_next/image` which may fail or produce incorrect output.

**For other frameworks:** Use standard `<img>` tag or framework's image component. SVG theme adaptation rules still apply.

---

### ⚠️ SVG Theme Compatibility

**Principle**: SVG icons with hardcoded `fill` or `stroke` colors become invisible when the app's color scheme changes.

**Constraint**: Before using an SVG asset:
1. Check `ui-assets.json` for `themeAdaptation` field
2. If `"currentColor"` — replace hardcoded colors with `currentColor` in the SVG, and render inline (NOT via `<img>`)
3. If `"static"` — use as-is (brand assets)

**Rendering method by adaptation type:**

| themeAdaptation | Rendering | Why |
|----------------|-----------|-----|
| `currentColor` | Inline SVG component or SVG sprite | `<img>`/`<Image>` cannot inherit CSS `color` |
| `static` | `<Image unoptimized>` (Next.js) or `<img>` | Colors fixed; optimization unnecessary for SVGs |
| `partial` | Inline SVG component | Need selective color control |

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
