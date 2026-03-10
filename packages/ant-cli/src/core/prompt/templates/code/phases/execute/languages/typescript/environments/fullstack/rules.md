## 🌐🖥️ Fullstack Environment (Backend + Frontend Monorepo)

**Context**: This project contains BOTH backend server (Express, NestJS, etc.) AND frontend application in the same repository.

**Important**: This is NOT for SSR frameworks (Next.js, Remix). SSR frameworks are "frontend" environment, not "fullstack".

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

**Or single repo with clear separation:**
```
project/
├── server/          # Backend code
└── client/          # Frontend code
```

---

### Key Principles

1. **Respect boundaries**: Backend code cannot directly import frontend code, and vice versa
2. **Shared types**: If types are shared, extract to a common package/folder
3. **Independent execution**: Backend and frontend should be independently runnable
4. **API contract**: Communication happens via HTTP/REST/GraphQL, not direct function calls

---

### When Working on Backend Code

- Follow Node.js API environment rules
- Use Node.js APIs (`fs`, `path`, database libraries)
- NO browser APIs
- May import shared types from common package

### When Working on Frontend Code

- Follow Browser environment rules (or SSR framework rules if using Next.js)
- Use browser APIs (`window`, `localStorage`, DOM)
- NO Node.js APIs (except in Next.js server components)
- May import shared types from common package

---

### Shared Code (Common Package)

- **Purpose**: Share types, interfaces, constants between backend and frontend
- **Constraints**: Must be pure TypeScript (no Node.js or browser-specific APIs)
- **Typical contents**: DTOs, enums, validation schemas, utility functions

---

### Testability Across Package Boundaries

**Principle**: Each package (backend, frontend, shared) follows the testability rules of its own environment. Backend follows Node.js API rules, frontend follows Browser rules. Shared code must be testable from both contexts.

**Observation target**: Does shared code depend on environment-specific APIs?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Shared code purity** | Does the common package import Node.js-only or browser-only modules? If so, it cannot be tested in the other context. |
| **Cross-package interfaces** | Are API contracts between backend and frontend defined as types in the shared package? This allows both sides to be tested independently against the contract. |

**Constraint**: Shared packages MUST remain environment-agnostic. If a shared utility needs environment-specific behavior, accept it as a parameter — do NOT branch on runtime detection.

⚠️ **Blind spot**: When a shared validation schema imports a Node.js module (e.g., `crypto`), frontend tests that import the same schema will fail. Verify shared code has zero environment-specific imports.

---

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

**Remember:** You're working in a monorepo. Identify which package you're editing before proceeding.
