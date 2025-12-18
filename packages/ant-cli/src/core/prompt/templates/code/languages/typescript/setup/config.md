━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📘 TYPESCRIPT PROJECT SETUP - CRITICAL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

Configure as needed for project (Tailwind, ESLint, etc). Standard setup.

## 5. .gitignore

```
node_modules
dist
build
.env
*.log
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES:**

❌ Using npm workspaces instead of pnpm for monorepos
❌ Using `"*"` instead of `"workspace:*"` for monorepo package refs
❌ Forgetting `"moduleResolution": "node"` in tsconfig.json
❌ Missing `@types/` packages in devDependencies
❌ Wrong `"module"` setting (use "ESNext" not "CommonJS")
❌ Not setting `"type": "module"` in package.json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

