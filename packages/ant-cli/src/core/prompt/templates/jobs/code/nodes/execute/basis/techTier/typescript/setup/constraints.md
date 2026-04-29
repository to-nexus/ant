## TypeScript/JavaScript Setup Task Constraints

⛔ **CRITICAL: Configuration files ONLY - No application code** ⛔

## 🎨 DESIGN TOKENS (IMPORTANT!)

**If you see a `# DESIGN TOKENS` section in this prompt:**
- The tokens are ALREADY LOADED from `visual/ui/ant/ui-tokens.json`
- DO NOT attempt to read `ui-tokens.json` from disk (e.g., `visual/ui/ant/`) — use the injected tokens directly
- Use the token values from the prompt directly to configure the styling framework's theme

**If NO `# DESIGN TOKENS` section but visual tier policies exist in the basis:**
- Create a minimal styling framework config with sensible defaults (standard theme)
- The design-system task (running after setup) will derive the full theme from visual tier policies
- Do NOT attempt to derive the full token set in setup — keep configuration generic

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
- Build tool config (e.g., Vite, Webpack — use the tool's current config format)
- Styling tool config (e.g., Tailwind, PostCSS — use the tool's current config format)
- Linting & formatting config (e.g., ESLint, Prettier — use the tool's current config format)
- Project: .gitignore, README.md, index.html (entry point only)
- Environment: `.env.example` (template with `@connection` annotations) AND `.env` (active copy with localhost/docker defaults)
- Docker: Dockerfile, docker-compose.yml (see Infrastructure Services below)

**❌ DON'T CREATE (Application layer)**
- Source directories: src/*, app/*, pages/*, lib/*, components/*, hooks/*, utils/*
- Application files: main.ts, App.tsx, server.ts, index.tsx
- Any .tsx/.jsx/.ts/.js outside of *.config.* files

**Constraint**: Only create configuration-layer files. Do NOT create application code directories (src/*, app/*, pages/*, components/*) or application source files (.tsx/.jsx/.ts/.js outside *.config.*).

**Source root for tooling config**: When configuring paths that reference source directories (e.g., styling framework source scan paths, tsconfig `paths`), use `src/` as the default source root per the language profile convention. Feature tasks will create source files there.

**Critical Requirements:**
1. Linter config MUST exclude build output directories (`dist`, `build`), `node_modules`, and config files (`*.config.*`) from analysis
2. Include ALL dependencies in package.json (don't defer to feature tasks)
3. Next task will create ALL application code - don't do it now
4. **Styling framework source scan paths MUST match actual source directories**
5. In monorepos, `"workspace:*"` MUST only reference packages whose source directory is physically present in `pnpm-workspace.yaml` globs. Do NOT use `"workspace:*"` for externally published packages — regardless of scope name (`@org/`) or design document terminology ("shared packages", "common libraries"). For external packages whose version is unknown, use `"latest"` — do NOT invent version numbers
6. **SVG loader config MUST preserve intrinsic dimensions.** Do NOT set `dimensions: false` in SVGR plugin configuration (vite-plugin-svgr, @svgr/webpack). Stripping `width`/`height` attributes causes viewBox-only SVGs to expand to container size.

⚠️ **Blind spot — Styling framework source scan mismatch**:
If a CSS utility framework's source scan paths don't cover the directories where source files exist, zero utility classes will be generated. The CSS file still loads normally — it just contains only the base reset, making this failure invisible in network/console. Ensure scan paths match the directories where source files will be created.

### Toolchain Version Consistency (Multi-Package Projects)

**Principle**: In multi-package workspaces, all module definition files must declare the same TypeScript compiler version and Node engine version. A mismatch between the workspace root and individual modules causes silent toolchain resolution failures.

*Library version pins (e.g. `react`, `next`, `vitest`) are enforced separately at write/install time — see the **Workspace Dependency Pins** section in the prompt for the live snapshot of pinned libraries; do NOT restate or duplicate library version policy here.*

| Checkpoint | Observation Target |
|-----------|-------------------|
| **TypeScript version** | Does the workspace-level `typescript` declaration match every module's `typescript` declaration? |
| **Node engine** | Does the `engines.node` (or equivalent runtime version) declaration match the workspace root in every module? |

**Constraint**: Do NOT assume a default toolchain version is safe. Observe the highest minimum required by any dependency, and declare that version consistently across all module files.

⚠️ **Blind spot**: TypeScript / Node engine mismatches between workspace root and module files are invisible until build or toolchain resolution fails. Verify alignment at creation time.

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
- Do NOT set `container_name` for any service in docker-compose.yml. The platform namespaces containers using a project-scoped `-p` flag. An explicit `container_name` bypasses that namespace and causes container name conflicts across runs or projects.
- `.env.example` MUST use `# @connection {category} {name}` annotation for each service connection endpoint (URL or address). Do NOT annotate individual components (host, port, user, password) — only the connection URL variable.
- Same-project internal connections (e.g., frontend → backend in fullstack) MUST add `self`: `# @connection business {name} self`
- Cross-project connections (e.g., frontend project referencing a separate backend project) MUST use `ant-project:{projectId}:{feature}[:{serviceName}]`: `# @connection business {name} ant-project:{projectId}:{feature}`. Optionally append `:{serviceName}` to target a specific service in a multi-package project

⚠️ **Blind spot reminder — include these when creating files:**
- `dev:infra` / `dev:infra:down` scripts are EASILY FORGOTTEN. Include them in root package.json when infrastructure services are observed.
- `@connection` annotations in `.env.example` are EASILY FORGOTTEN. Include annotation for every connection endpoint URL (but not individual components like host, port, user, password).
- The `self` keyword for internal connections is EASILY FORGOTTEN in fullstack/monorepo projects.
- The `ant-project:{projectId}:{feature}[:{serviceName}]` modifier for cross-project connections is EASILY FORGOTTEN when the specification names a specific external project as a dependency.
- Package-level setup must NOT duplicate infrastructure provisioning.

