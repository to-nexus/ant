## 🖥️ Node.js API Server Environment

**Context**: Backend API server handling concurrent HTTP requests (Express, Fastify, Koa, etc.)

---

### Key Characteristics

1. **Concurrent requests**: Multiple requests handled simultaneously
2. **Long-running process**: Server stays alive, handles many requests
3. **Full Node.js access**: All built-in modules available

---

### Key Constraints

1. **Avoid blocking**: Synchronous operations block ALL requests
2. **Resource management**: Connection pools, file handles, memory
3. **Error handling**: Don't crash the server on individual request errors

---

### When Solving Problems

**Analyze first:**
- What does the existing codebase structure look like?
- What patterns are already established?
- What's the error actually telling you?

**For module/build errors:**
- Check `tsconfig.json`, `package.json` configuration first
- Understand the project's module system (ESM vs CommonJS)
- Consider how the project is executed (direct node, tsx, bundler?)

**Key principle:** Configuration fixes over source code changes. Minimal changes.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Module errors | tsconfig.json, package.json settings |
| Build errors | TypeScript configuration, target |
| Runtime errors | Environment variables, paths |
| Dependencies | Missing packages, version conflicts |

---

**Remember:** You already know Node.js server development. Analyze the specific error and project setup before deciding on a solution.
