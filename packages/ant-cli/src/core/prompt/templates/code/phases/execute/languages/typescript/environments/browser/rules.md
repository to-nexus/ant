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

```javascript
// tailwind.config.js
module.exports = {
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
// After copying: inputs/assets/logo.svg → public/logos/logo.svg
import Image from 'next/image';

<Image src="/logos/logo.svg" alt="Logo" width={100} height={40} />
```

**For other frameworks:** Use standard `<img>` tag or framework's image component.

---

## 🖼️ Image Rendering Verification

When images fill their container (fill mode, 100% size, background-size: cover, etc.):

**Principle:** The parent container MUST have explicit or computable dimensions.

| Pattern | Result |
|---------|--------|
| Parent has explicit size (e.g., `h-[200px]`) | ✅ Image renders |
| Parent uses aspect-ratio with computed width | ✅ Image renders |
| Parent uses `height: auto` with no content | ❌ Height = 0, image invisible |
| Parent uses `100%` but ancestor has no size | ❌ Height = 0, image invisible |

**Quick Check:** After implementing a fill-mode image, trace the size computation upward. If any ancestor relies on content for size but has none, the image won't render.

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
