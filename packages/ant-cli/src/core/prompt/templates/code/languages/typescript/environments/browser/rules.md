## 🌐 Browser Environment

**Context**: Client-side code running in web browsers (SPA, React, Vue, Angular)

---

### Key Constraints

1. **No Node.js APIs**: `fs`, `path`, `crypto`, `http`, `child_process` etc. don't exist in browsers
2. **Sandboxed**: No direct filesystem access, limited system access
3. **Security**: CORS restrictions, no access to other origins without server cooperation

---

### When Solving Problems

**Analyze first:**
- Is this a client-side or server-side concern?
- What browser APIs are available for this task?
- Does this need a backend API call?

**Key principle:** If you need Node.js capabilities, create an API endpoint and call it from the browser.

---

### Common Alternatives (for reference, choose what fits)

| Node.js Need | Browser Alternative |
|--------------|---------------------|
| File storage | `localStorage`, `IndexedDB`, or backend API |
| File reading | `<input type="file">` + FileReader, or fetch from API |
| Crypto | Web Crypto API (`crypto.subtle`) |
| Path operations | URL API, string manipulation |
| Environment vars | Build-time injection (Vite: `import.meta.env`) |

---

**Remember:** You already know browser APIs. Analyze the specific situation and choose the appropriate solution.
