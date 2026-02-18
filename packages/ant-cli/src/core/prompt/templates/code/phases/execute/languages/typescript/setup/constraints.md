## TypeScript/JavaScript Setup Task Constraints

⛔ **CRITICAL: Configuration files ONLY - No application code** ⛔

## 🎨 DESIGN TOKENS (IMPORTANT!)

**If you see a `# DESIGN TOKENS` section in this prompt:**
- The tokens are ALREADY LOADED from `outputs/design/ui-tokens.json`
- DO NOT attempt to read `ui-tokens.json` from `inputs/` or any other directory
- Use the token values from the prompt directly to configure Tailwind/theme

## 📁 PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ CORRECT:
  codebase/package.json
  codebase/tsconfig.json
  codebase/vite.config.ts

❌ WRONG:
  package.json          ← Missing codebase/ prefix!
  tsconfig.json         ← Missing codebase/ prefix!
```

**Setup Task Scope:**
```
PHASE 1 (Setup):    Config files in codebase/ → npm install → Ready for code
PHASE 2 (Feature):  Application code in codebase/ → Build → Done
```

### File Categories:

**✅ CREATE (Configuration layer)**
- Package: package.json, lock files
- TypeScript: tsconfig.json, tsconfig.*.json
- Build tools: vite.config.ts, webpack.config.js, etc.
- Styling: tailwind.config.js, postcss.config.js
- Linting: .eslintrc.* (MUST include ignorePatterns), .prettierrc
- Project: .gitignore, README.md, index.html (entry point only)
- Environment: `.env.example` (template with `@connection` annotations) AND `.env` (active copy with localhost/docker defaults)
- Docker: Dockerfile, docker-compose.yml (see Infrastructure Services below)

**❌ DON'T CREATE (Application layer)**
- Source directories: src/*, app/*, pages/*, lib/*, components/*, hooks/*, utils/*
- Application files: main.ts, App.tsx, server.ts, index.tsx
- Any .tsx/.jsx/.ts/.js outside of *.config.* files

**Constraint**: Only create configuration-layer files. Do NOT create application code directories (src/*, app/*, pages/*, components/*) or application source files (.tsx/.jsx/.ts/.js outside *.config.*).

**Critical Requirements:**
1. ESLint MUST have `ignorePatterns: ["dist", "build", "node_modules", "*.config.*"]`
2. Include ALL dependencies in package.json (don't defer to feature tasks)
3. Next task will create ALL application code - don't do it now
4. **Tailwind `content` paths MUST match actual source directories**

⚠️ **Blind spot — `content` path mismatch**:
If `content` paths don't cover the directories where source files exist, zero utility classes will be generated. The CSS file still loads normally — it just contains only the base reset, making this invisible in network/console. Ensure `content` paths match the directories where source files will be created.

## Infrastructure Services (Observe Design Document)

| Checkpoint | Observation Target |
|------------|-------------------|
| **External services** | Does the design document specify services that require a running server process? |
| **Scope** | Is this a root/workspace-level setup or a package-level setup? |
| **Environment** | Is this project frontend-only (no backend in this workspace)? |

**Principle**: Infrastructure provisioning belongs to the **root workspace level**, not individual packages.

**Environment Constraint**:
- If this project is **frontend-only** (detected environment is `BROWSER` without a backend package in the same workspace): Do NOT create `docker-compose.yml`, `dev:infra` scripts, or `.env.example` for external services — even if the design document mentions databases, caches, or queues. Infrastructure provisioning is the responsibility of the separate backend project.
- Only create infrastructure files when **this project itself** runs the external services.

**Root/workspace-level setup** (when external services observed in design AND project runs them):

| Required Output | Purpose |
|----------------|---------|
| `docker-compose.yml` | Local development environment for each observed service |
| `package.json` scripts: `"dev:infra"`, `"dev:infra:down"` | Start/stop infrastructure services |
| `.env.example` AND `.env` | Template with `@connection` annotations AND active copy with localhost/docker defaults (see preview-env-contract) |

**Package-level setup**: Do NOT create docker-compose.yml or dev:infra scripts.
Reference environment variables for service connections.

**Constraints**:
- Do NOT hardcode connection URLs in application code. Use environment variables.
- Do NOT omit healthcheck for any service in docker-compose.yml.
- Do NOT omit volume mounts for stateful services (data must survive container restart).
- Do NOT run `docker compose up` in setup tasks. Only create the files.
- `.env.example` MUST use `# @connection {category} {name}` annotation for each service connection endpoint (URL or address). Do NOT annotate individual components (host, port, user, password) — only the connection URL variable.
- Same-project internal connections (e.g., frontend → backend in fullstack) MUST add `self`: `# @connection business {name} self`
- Cross-project connections (e.g., frontend project referencing a separate backend project) MUST use `ant-project:{projectId}:{feature}`: `# @connection business {name} ant-project:{projectId}:{feature}`

⚠️ **Blind spot reminder — include these when creating files:**
- `dev:infra` / `dev:infra:down` scripts are EASILY FORGOTTEN. Include them in root package.json when infrastructure services are observed.
- `@connection` annotations in `.env.example` are EASILY FORGOTTEN. Include annotation for every connection endpoint URL (but not individual components like host, port, user, password).
- The `self` keyword for internal connections is EASILY FORGOTTEN in fullstack/monorepo projects.
- The `ant-project:{projectId}:{feature}` modifier for cross-project connections is EASILY FORGOTTEN when the specification names a specific external project as a dependency.
- Package-level setup must NOT duplicate infrastructure provisioning.

