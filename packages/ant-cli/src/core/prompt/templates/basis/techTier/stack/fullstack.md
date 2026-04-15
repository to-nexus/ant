## Fullstack Environment — Monorepo-Specific Rules

**Context**: This project contains BOTH a backend server (Express, NestJS, etc.) AND a frontend application as **separate packages** in the same repository.

**Important**: This is NOT for SSR frameworks (Next.js, Remix). SSR frameworks are "browser" environment, not "fullstack". This applies ONLY to separate BE + FE monorepos.

**Note**: Browser-specific and backend-specific rules are injected separately. This file contains ONLY fullstack monorepo-specific rules (package boundaries, shared code constraints).

---

### Project Structure Patterns

**Typical monorepo structure:**
```
project/
├── packages/
│   ├── backend/     # Express/NestJS API server
│   └── frontend/    # React/Vue frontend
├── apps/
│   ├── api/         # Backend service
│   └── web/         # Frontend app
```

---

### Package Boundary Principles

1. **Respect boundaries**: Backend code cannot directly import frontend code, and vice versa
2. **Shared types**: If types are shared, extract to a common package/folder
3. **Independent execution**: Backend and frontend should be independently runnable
4. **API contract**: Communication happens via HTTP/REST/GraphQL, not direct function calls

**Observation target**: Before writing any import statement, identify which package the current file belongs to.

| Checkpoint | What to observe |
|-----------|----------------|
| **Current package** | Is this file in the backend, frontend, or shared package? |
| **Import target** | Does the import cross a package boundary? |
| **Shared access** | If cross-boundary types are needed, do they exist in the shared package? |

---

### Shared Code (Common Package)

**Principle**: Shared packages exist exclusively for cross-boundary type sharing. They MUST remain environment-agnostic.

**Constraints**:
- Must be pure TypeScript (no Node.js or browser-specific APIs)
- Typical contents: DTOs, enums, validation schemas, utility functions
- If a shared utility needs environment-specific behavior, accept it as a parameter — do NOT branch on runtime detection

⚠️ **Blind spot**: When a shared validation schema imports a Node.js module (e.g., `crypto`), frontend tests that import the same schema will fail. Verify shared code has zero environment-specific imports.

---

### Testability Across Package Boundaries

**Principle**: Each package follows the testability rules of its own environment. Shared code must be testable from both contexts.

**Observation target**: Does shared code depend on environment-specific APIs?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Shared code purity** | Does the common package import Node.js-only or browser-only modules? |
| **Cross-package interfaces** | Are API contracts between backend and frontend defined as types in the shared package? |

---

**Remember:** You're working in a monorepo. Identify which package you're editing before proceeding.
