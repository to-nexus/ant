## 🌐 Browser/Frontend Environment

**Context**: Client-side code running in web browsers

**Includes:**
- **CSR (Client-Side Rendering)**: React SPA, Vue SPA, Angular apps
- **SSR (Server-Side Rendering)**: Next.js, Remix, SvelteKit, Nuxt

**Note**: SSR frameworks like Next.js are considered "frontend" environment, not "fullstack".  
They run in the browser (with optional server-side rendering), but are NOT backend server + frontend monorepos.

---

### Architecture Compliance

**Constraint**: Architecture boundaries defined in System Design MUST be reflected as directory-level boundaries in the codebase.

**Constraint**: Framework conventions alone do NOT satisfy architecture boundary separation when System Design specifies explicit boundaries.

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

## 🧩 UI Component Integration Patterns

### React/Next.js Component Hierarchy

```
page.tsx (entry point)
  └── SectionName.tsx (parent section)
        └── SectionNameCard.tsx (child component)
```

**Pattern:**
| If You Create | You MUST Also Create | You MUST Also Do |
|---------------|---------------------|------------------|
| `XCard.tsx` | `X.tsx` (parent) | Import `<X />` in entry point |

**Anti-Pattern (TASK FAILURE):**
```tsx
// ❌ WRONG: Created XCard.tsx but entry point still has placeholder
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
- [ ] Entry point imports parent
- [ ] No `{/* ... Placeholder */}` comments remain

---

## 🖼️ Static Assets (Next.js Example)

When using `ui-assets.json`:

```tsx
// After copying: inputs/assets/<category>/logo.svg → public/<category>/logo.svg
import Image from 'next/image';

<Image src="/<category>/logo.svg" alt="Logo" width={100} height={40} />
```

**For other frameworks:** Use standard `<img>` tag or framework's image component.

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
