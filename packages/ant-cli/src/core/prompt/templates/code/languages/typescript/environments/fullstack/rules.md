## 🌐🖥️ Fullstack Framework Environment

**Context**: Code runs BOTH on server (Node.js) AND client (browser) - Next.js, Remix, SvelteKit, Nuxt

---

### Critical: Dual Environment Awareness

**Before writing ANY code, determine:**
1. Where will this code execute? (Server / Client / Both)
2. What APIs are available in that context?

---

### Key Constraints

| Context | Node.js APIs | Browser APIs | Examples |
|---------|--------------|--------------|----------|
| Server Components / API Routes | ✅ Yes | ❌ No | `fs`, `path`, database access |
| Client Components | ❌ No | ✅ Yes | `useState`, `localStorage`, DOM |
| Shared/Universal | ❌ No | ❌ Limited | Pure logic, fetch (both have it) |

---

### When Solving Problems

**Analyze first:**
- Which file/component is this? Server or client context?
- Does the framework have a specific pattern for this? (Check existing code)
- Is there existing project convention to follow?

**Key principle:** The framework documentation and existing project patterns take precedence. Analyze the codebase structure before implementing.

---

### Common Patterns (for reference)

- **Data fetching**: Server components fetch directly, client components use API routes
- **Environment variables**: Server-only secrets vs public client vars (framework-specific prefixes)
- **File operations**: Only in API routes or server components

---

**Remember:** You already know these frameworks. Look at the existing code patterns and follow them.
