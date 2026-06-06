## TypeScript/JavaScript Setup Task Constraints

⛔ **CRITICAL: Configuration files ONLY - No application code** ⛔

## 🎨 DESIGN TOKENS (IMPORTANT!)

**If design-token values are injected into this prompt (a context block carrying token values):**
- Use those values directly to configure the styling framework's theme
- Do NOT re-read token files from disk — the injected values are authoritative for this task

**If no design-token values are present in this prompt:**
- Create a minimal styling framework config with sensible defaults (standard theme)
- A later design-system task derives the full theme from the design source (the UI document or, when none, the visual-tier policies in the basis)
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

**✅ CREATE (Configuration + Directory skeleton)**
- Package: package.json, lock files
- TypeScript: tsconfig.json, tsconfig.*.json
- Build tool config (e.g., Vite, Webpack — use the tool's current config format)
- Styling tool config (e.g., Tailwind, PostCSS — use the tool's current config format)
- Linting & formatting config (e.g., ESLint, Prettier — use the tool's current config format)
- Project: .gitignore, README.md, index.html (entry point only)
- Environment: `.env.example` (template with `@connection` annotations) AND `.env` (active copy with localhost/docker defaults)
- Docker: Dockerfile, docker-compose.yml (see Infrastructure Services below)
- **Directory skeleton** — create the top-level source directory tree for the unit YOU own, reflecting architecture boundaries from system design (or framework convention if no system design exists). Use empty `.gitkeep` files to preserve directories without source yet. Sibling and future tasks bind to this via `list_files` as the structural context. **Scope by band**: a `band:'root'` setup in a multi-package workspace creates the workspace manifest + member glob + shared config ONLY — it does NOT create any member/package directory or skeleton (the glob discovers members). A band-absent (package) setup creates its own member's directory + skeleton. In a single-package project the band-absent setup seals the app's source tree.

**❌ DON'T CREATE (Application source files)**
- Application source files: main.ts, App.tsx, server.ts, index.tsx
- Any .tsx/.jsx/.ts/.js outside of *.config.* files

**Constraint**: Create configuration files AND the directory skeleton (with `.gitkeep`). Do NOT create application source files (.tsx/.jsx/.ts/.js outside *.config.*) — feature tasks own those.

**Source root for tooling config**: When configuring paths that reference source directories (e.g., styling framework source scan paths, tsconfig `paths`), use `src/` as the default source root per the language profile convention. Feature tasks will create source files there.

### Member placement (multi-package workspace)

**Observation target**: For each workspace member, does it have its own runnable/serve entry and lifecycle, or is it consumed by other members with no standalone run target?

- A member with its own runnable/serve entry and lifecycle (a **deployable application or service** — frontend app, backend service, etc.) → `apps/<name>`.
- A member consumed by other members, with no standalone run target (a **shared library**) → `packages/<name>`.

This mapping is stack-agnostic: it holds for a frontend-only workspace (multiple apps + shared lib), a backend-only workspace (multiple services + shared lib), and a fullstack workspace alike.

**Vocabulary constraint**: Every workspace member is a *package* in the manager's sense (it has its own `package.json`) **regardless of which directory it lives in**. "Package" does NOT mean "under `packages/`" — the directory is chosen by the member's kind above, never by the word "package" appearing in a task description or design document.

⚠️ **Blind spot**: A deployable application is NEVER placed under `packages/` — `packages/` holds shared libraries only. The number of members does not change this kind→directory mapping.

**Critical Requirements:**
1. Linter config MUST exclude build output directories (`dist`, `build`), `node_modules`, and config files (`*.config.*`) from analysis
2. Include ALL dependencies in package.json (don't defer to feature tasks)
3. Next task will create ALL application code - don't do it now
4. **Styling framework source scan paths MUST match actual source directories**
5. In monorepos, `"workspace:*"` MUST only reference packages whose source directory is physically present in `pnpm-workspace.yaml` globs. Do NOT use `"workspace:*"` for externally published packages — regardless of scope name (`@org/`) or design document terminology ("shared packages", "common libraries"). For external packages whose version is unknown, use `"latest"` in `dependencies` / `devDependencies` (a semver range in `peerDependencies`) — do NOT invent version numbers. A meta-framework and the renderer/runtime it peer-depends on are ONE version-decision set: apply the same strategy to all members (all `latest`, or all pinned-compatible); never split (framework `latest` + renderer fixed older range). See config §0 Step 2.
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

### Shared-Library Package Packaging

**Applicability**: A workspace member consumed by other members (a shared library, typically under `packages/<name>`) that exposes built artifacts via a `package.json` `exports` map and/or emits its own type declarations.

**Constraint — `exports` condition order**: In a conditional `exports` entry, the `types` condition MUST come BEFORE `import` / `require` / `default`. Node resolves conditions top-down and uses the FIRST match — a `types` condition placed after `import`/`require` is never reached, so consumers silently receive no types (the bundler warns "the condition … will never be used"). Order: `types` first, then `import`, then `require`, `default` last.

**Constraint — one declaration emitter**: A package's `.d.ts` declarations have exactly ONE emitter. If a bundler emits the declarations (e.g. a `dts: true` build), do NOT also set `"composite": true` in that package's `tsconfig.json` WITHOUT matching project `references` — `composite` targets the `tsc --build` project-reference graph and its file-list validation collides with the bundler's declaration pass (TS6307). Choose one: the bundler emits declarations (no `composite` on that package) OR a `tsc --build` references graph does (no bundler dts). A correctly-wired `composite` + `references` setup is fine — the fault is `composite` *without* references alongside a bundler dts.

## Infrastructure Services (Observe Design Document)

| Checkpoint | Observation Target |
|------------|-------------------|
| **External services** | Does the design document specify services that require a running server process? |
| **Scope** | Is this a `band:'root'` workspace-level setup or a band-absent package-level setup? (root owns workspace manifest + glob + shared infra; package owns its own member only) |
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

