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

**Remember:** You're working in a monorepo. Identify which package you're editing before proceeding.
