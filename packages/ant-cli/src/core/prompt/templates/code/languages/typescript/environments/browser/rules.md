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

**Remember:** You already know these frameworks. Analyze the codebase structure and follow existing patterns.
