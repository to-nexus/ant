## 🖥️ Node.js API Server Environment

**Context**: Backend API server handling concurrent HTTP requests

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

### Architecture Compliance

**Constraint**: Architecture boundaries defined in System Design MUST be reflected as directory-level boundaries in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries are complementary:
- Framework mechanisms handle dependency resolution and runtime wiring
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: If System Design specifies explicit boundary separation, framework-conventional structure alone does NOT satisfy this requirement. Architecture boundaries MUST exist alongside framework conventions.

⚠️ **Blind spot reminder**: When a framework provides strong module/convention patterns, it is easy to let those patterns become the ONLY structural organization. Verify that each architecture boundary from System Design has a corresponding directory boundary — not just a conceptual separation within framework modules.

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
