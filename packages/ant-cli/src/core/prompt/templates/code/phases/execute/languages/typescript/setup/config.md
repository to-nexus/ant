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

Set up according to chosen framework (Vite/Next.js/etc). Match your project's needs.

## 4. Style/Linting Configuration

Configure as needed for project (Tailwind, ESLint, etc).

**⚠️ Tailwind CSS — `content` paths (CRITICAL):**

Tailwind JIT generates CSS ONLY for classes found in files matching the `content` glob patterns. If `content` paths don't match the framework's source directory structure, utility classes will be missing and all layouts will break.

**Principle**: The `content` array MUST include every directory that contains files using Tailwind classes. Observe the framework's directory convention:

- CSR frameworks (Vite, CRA): source files in `./src/`
- Next.js App Router: source files in `./app/`, `./components/`
- Next.js Pages Router: source files in `./pages/`, `./components/`

**Constraint**: Do NOT hardcode content paths from one framework when using another. Always match the actual project structure.

## 5. .gitignore

**Principles:**
- Include common artifacts: `node_modules`, `dist`, `build`, `.env`, `*.log`
- Include framework/platform-specific build outputs and caches (e.g., Next.js → `.next`, Nuxt → `.nuxt`, etc.)
- Include IDE/editor-specific files if appropriate
- When uncertain about platform artifacts, research the framework's recommended gitignore patterns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES:**

❌ Using npm workspaces instead of pnpm for monorepos
❌ Using `"*"` instead of `"workspace:*"` for monorepo package refs
❌ Forgetting `"moduleResolution": "node"` in tsconfig.json
❌ Missing `@types/` packages in devDependencies
❌ Wrong `"module"` setting (use "ESNext" not "CommonJS")
❌ Not setting `"type": "module"` in package.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

