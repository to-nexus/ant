━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📘 TYPESCRIPT PROJECT SETUP - CRITICAL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 📁 PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ codebase/package.json
✅ codebase/tsconfig.json
✅ codebase/vite.config.ts
✅ codebase/pnpm-workspace.yaml

❌ package.json (WRONG - missing codebase/ prefix)
```

---

## 0. Project Structure Decision ⭐⭐⭐

**Monorepo vs Single Package:**

Use **monorepo** (multiple packages) if:
- Multiple related applications/libraries (even single-stack)
- Shared code between packages (types, utils, domain logic)
- Need independent versioning or deployment

Use **single package** if:
- Single application, simple domain, no sharing needed

**🚨 CRITICAL: Fullstack projects MUST use monorepo**
- Frontend + Backend = Always separate packages
- Mandatory structure: `packages/frontend`, `packages/backend`, `packages/shared`
- No exceptions for fullstack

**🚨 MSA/Service-Oriented (if design doc specifies service boundaries):**
- Each service boundary in design doc = separate package
- Shared code (types, DTOs) = separate package
- Use scoped package names: `@project/<service-name>`
- **Follow design doc's service naming and boundaries exactly**

**Monorepo tool:** Use **pnpm workspaces** (not npm - faster, stricter)

**🚨 CRITICAL: For monorepo, you MUST create `pnpm-workspace.yaml`:**

```yaml
packages:
  - 'packages/*'
```

**Critical rules:**
- ✅ Always create `pnpm-workspace.yaml` file first
- Use scoped package names: `@project/backend`, `@project/frontend`, `@project/shared`
- Cross-package refs: `"@project/shared": "workspace:*"` (not `"*"`)
- Root scripts: `pnpm --filter`, `pnpm -r`, `pnpm --parallel`
- ❌ Do NOT use npm workspaces (slower, less strict)

### Dependency Classification Protocol

For each dependency in `package.json`, two decisions must be made in order: (1) local vs external, (2) version.

#### Step 1 — Local or External?

| Package physically present in workspace? | Protocol |
|------------------------------------------|----------|
| **YES** — directory listed in `pnpm-workspace.yaml` globs | `"workspace:*"` |
| **NO** — not in workspace filesystem | External npm dependency |

**Constraint**: Do NOT infer workspace-local status from package scope (`@org/`), organization name, or terminology in the design document ("shared packages", "common libraries", "internal packages"). A package is workspace-local ONLY if its directory is matched by `pnpm-workspace.yaml` and physically present in this workspace.

**Constraint**: `"workspace:*"` for a package that does not exist in the workspace causes `pnpm install` failure. If the package directory does not exist, it is an external dependency.

⚠️ **Blind spot**: Scoped packages published by the same organization (e.g., `@company/logger`) are easily confused with workspace-local packages. They are external npm dependencies — use a version specifier, not `"workspace:*"`, unless their source directory is confirmed present in `pnpm-workspace.yaml`.

#### Step 2 — Version Specifier

| Category | Version known? | Action |
|----------|---------------|--------|
| **Workspace-local** (Step 1 = YES) | N/A | `"workspace:*"` |
| **External** — version in design doc or LLM training data | YES | Semver range (e.g., `"^1.10.1"`) |
| **External** — version unknown | NO | `"latest"` |

**Principle**: `"latest"` is a valid npm dist-tag that all package managers resolve to the most recent published version during install. The lockfile pins the resolved version for reproducibility. If a specific version is required, it should be specified in the design document.

**Constraint**: Do NOT invent version numbers for packages you do not know. Use `"latest"` — the package manager resolves it correctly. Guessing a wrong version causes `pnpm install` failure.

---

## 1. package.json ⭐

**EXAMPLE** (for Vite + React):
```json
{
  "name": "project-name",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "@types/react": "^18.2.0"
  }
}
```

**Key points:**
- Include `@types/xxx` for type definitions
- `"type": "module"` for ES modules
- Match build tool in scripts

## 2. tsconfig.json ⭐⭐⭐

**CRITICAL:** Must include `"moduleResolution": "node"`

**Required fields:**
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "node",  // ← CRITICAL!
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**Without "moduleResolution":** Cannot resolve imports, compilation fails.

## 3. Build Tool Configuration

**Constraint**: Every build framework has a native config file. This config file MUST be created during setup -- it is not optional.

**Observation Target**: Check if `preview-setup` injection is present in the prompt. If so, its environment variable bindings (base path, API base URL) MUST be wired into the framework config file during setup.

## 4. Style/Linting Configuration

Configure as needed for project (Tailwind, ESLint, etc).

**⚠️ Blind Spot — Tailwind `content` paths:**

**Principle**: `content` MUST list every directory where source files with styling classes will exist.

**Constraint**: Do NOT assume existing `content` paths are correct. Observe where the framework convention places source files, and ensure `content` paths match.

## 5. .gitignore

**Principles:**
- Include common artifacts: `node_modules`, `dist`, `build`, `.env`, `*.log`
- Include framework/platform-specific build outputs and caches (e.g., Next.js → `.next`, Nuxt → `.nuxt`, etc.)
- Include IDE/editor-specific files if appropriate
- When uncertain about platform artifacts, research the framework's recommended gitignore patterns

## 6. Environment Files

**Principle**: When project requires environment variables, create both `.env.example` (committed template) and `.env` (active, gitignored).

**Constraint**: `.env.example` MUST use `@connection` annotations for service connection variables (see preview-env-contract). `.env` MUST contain the same variables with localhost/docker-compose default values.

**Constraint**: In monorepos with multiple packages, follow the layered placement from the platform runtime contract (Section 3.5) — shared infrastructure connections at root, service-specific config per package.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES:**

❌ Using npm workspaces instead of pnpm for monorepos
❌ Using `"*"` instead of `"workspace:*"` for monorepo package refs
❌ Using `"workspace:*"` for external packages not present in `pnpm-workspace.yaml` (same-org scope does NOT mean workspace-local)
❌ Inventing version numbers for unknown packages (use `"latest"` — the package manager resolves it; a wrong guess causes install failure)
❌ Forgetting `"moduleResolution": "node"` in tsconfig.json
❌ Missing `@types/` packages in devDependencies
❌ Wrong `"module"` setting (use "ESNext" not "CommonJS")
❌ Not setting `"type": "module"` in package.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

