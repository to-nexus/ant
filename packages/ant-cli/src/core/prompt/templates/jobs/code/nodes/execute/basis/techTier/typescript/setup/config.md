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

## 0. Workspace Mechanics (single vs multi-package) ⭐⭐⭐

**The package structure is already decided by your setup task scope** — whether this is a single
package or a multi-package workspace was determined during decomposition (single setup task →
single package; root + per-package setup tasks → multi-package workspace). This section gives the
**pnpm/TypeScript mechanics** for realizing whichever structure your setup task specifies. It does
NOT re-decide the structure.

**Single package**: a plain `package.json` at `codebase/` — no `pnpm-workspace.yaml`.

**Multi-package workspace (monorepo)**: realize the units the setup tasks define, placing each
member in the directory its kind selects — see the **Member placement** rule in the setup
constraints (deployable application → `apps/<name>`, shared library → `packages/<name>`).

**Tool:** Use **pnpm workspaces** (not npm — faster, stricter).

**🚨 CRITICAL: A multi-package workspace MUST have `pnpm-workspace.yaml` at `codebase/`**, with
globs covering whichever of deployable apps and shared libraries the structure uses:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Critical rules (multi-package):**
- ✅ Create `pnpm-workspace.yaml` first; include only the globs the structure actually uses.
- **Package names use ONE scope, applied uniformly to every member**: `@<scope>/<member-dir>`. The scope is a single value chosen once for the whole workspace — it MUST NOT vary per member. Each member's `package.json` `name` is the SSOT for that package's identity.
- Cross-package refs use that exact name: `"@<scope>/shared": "workspace:*"` (not `"*"`).
- Root scripts: `pnpm --filter`, `pnpm -r`, `pnpm --parallel`. **Every `--filter` target MUST equal a member's `package.json` `name` VERBATIM** — never a placeholder, a re-typed guess, or a different scope. A `--filter` target that matches no member silently runs nothing.
- **Root `dev` over multiple long-running servers**: when ≥ 2 members run a long-running dev server that defaults to the SAME port, a broadcast root `dev` (`--filter='*' dev` / `-r dev` / `--parallel dev`) starts them concurrently and they collide on that port — the second fails to bind or silently steals the first's traffic, so a single `pnpm dev` at the root cannot launch the project. Observable: count members whose `dev` binds a default port; if > 1, give each member a distinct port (or have the root `dev` start one entry member) so one root command boots cleanly. A broadcast root `dev` is safe only when at most one member is a port-binding server.
- ❌ Do NOT use npm workspaces (slower, less strict).

### Root orchestration & shared-package consumption (multi-package) ⭐⭐⭐

**Principle**: A multi-package workspace MUST be operable from ONE place. The root `package.json` owns the whole-project lifecycle — a developer, and a real git-based deployment, expects a single root command to build, to run in dev, and to run in production, NOT a manual per-package sequence. This is owned by the `band:'root'` setup task (the one that owns the root manifest) and authored before any member exists.

**Required root scripts** (root `package.json`):
- `build` — builds every member in dependency order. Use a graph-driven runner (`turbo` with `"dependsOn": ["^build"]`, or `pnpm -r` resolving the workspace graph topologically) so a member builds only after the members it depends on. Graph-driven means it MUST NOT enumerate member names — members added later are covered automatically.
- `dev` — boots the whole project with one command. Honor the port rule above: if ≥ 2 members bind a long-running server, give each a distinct port so a concurrent root `dev` does not collide.
- A production run path — a build + serve route for real deployment (framework-native, e.g. a root `start` that serves each built app via `next start`). The Ant preview runs only `dev`, so it will NOT exercise this path; the project MUST nonetheless be buildable and serveable for deployment outside Ant (see the "runs outside Ant" principle in `preview-env-contract`).

**Shared-package consumption — prefer source consumption**: When an application consumes a workspace library (`"@scope/lib": "workspace:*"`), prefer consuming the library's SOURCE over a build artifact, so the application starts WITHOUT a separate library pre-build step. Configure the consumer to transpile the workspace package (Next.js `transpilePackages`; or the library's `package.json` `exports`/`main` pointing at source; Vite resolves workspace source by default). Only when a library genuinely requires its own build (a bundler-specific transform with no source-consumption path) does the application rely on the dependency-ordered root `build` above to produce that artifact first.

⚠️ **Blind spot**: A shared library that must be hand-built before any app can start — with no root script ordering it and no source-consumption configured — leaves the apps unrunnable from a clean checkout. Either make the library source-consumable, or guarantee the root `build`/`dev` orders it ahead of its consumers; never both-absent.

**pnpm native-build gate (`allowBuilds`)**: pnpm gates dependency `postinstall` build scripts behind an explicit allowlist in `pnpm-workspace.yaml` → `allowBuilds` (per-package BOOLEAN). Do NOT emit speculative or placeholder entries — a non-boolean value (e.g. `pkg: set this to true or false`) is read as not-allowed and silently skips the native build. Rule: list a dependency `true` ONLY when it has a runtime-critical `postinstall` (a binary the app needs at runtime); otherwise OMIT the `allowBuilds` block entirely (build-time-only or JS-fallback deps do not need it). When uncertain, omit — never placeholder.

### Dependency Classification Protocol

For each dependency in `package.json`, two decisions must be made in order: (1) local vs external, (2) version.

#### Step 1 — Local or External?

| Package physically present in workspace? | Protocol |
|------------------------------------------|----------|
| **YES** — directory listed in `pnpm-workspace.yaml` globs | `"workspace:*"` |
| **NO** — not in workspace filesystem | External npm dependency |

**Constraints**:
- Do NOT infer workspace-local status from package scope (`@org/`), organization name, or terminology in the design document ("shared packages", "common libraries", "internal packages"). A package is workspace-local ONLY if its directory is matched by `pnpm-workspace.yaml` and physically present in this workspace.
- `"workspace:*"` for a package that does not exist in the workspace causes `pnpm install` failure. If the package directory does not exist, it is an external dependency.

⚠️ **Blind spot**: Scoped packages published by the same organization (e.g., `@company/logger`) are easily confused with workspace-local packages. They are external npm dependencies — use a version specifier, not `"workspace:*"`, unless their source directory is confirmed present in `pnpm-workspace.yaml`.

#### Step 2 — Version Specifier

| Category | Version known? | Action |
|----------|---------------|--------|
| **Workspace-local** (Step 1 = YES) | N/A | `"workspace:*"` |
| **External leaf** — version in design doc or LLM training data | YES | Semver range (e.g., `"^1.10.1"`) |
| **External leaf** — version unknown | NO | `"latest"` |
| **Meta-framework + the renderer/runtime it peer-depends on** | — | Decide as ONE set — see below |

**Set-coherence principle (framework ↔ runtime)**: A meta-framework and the renderer/runtime it peer-depends on are a single version-decision unit, decided **framework-led**. Do NOT use the floating `"latest"` tag for the set — a peer-coupled set needs concrete, coherent versions, and floating `"latest"` silently jumps majors on a later install (breaking the peer match). Instead pin the set to its **latest stable release** (concrete version ranges), with the renderer following the framework's peer requirement for that major. NEVER split the set (one member `"latest"`, or a major different from the one the framework requires): that yields a peer mismatch that passes install but breaks at runtime.

**Principle**: For a **generic external leaf**, `"latest"` is a valid npm dist-tag that package managers resolve to the most recent published version at install (the lockfile pins it for reproducibility). The framework↔runtime set is the exception — it does NOT use floating `"latest"` (see the set-coherence rule above). If a specific version is required, it should be specified in the design document.

**Constraint**: Do NOT invent version numbers for packages you do not know. For a generic external leaf, use `"latest"` — the package manager resolves it correctly. For a framework↔runtime set whose version is unknown, do NOT use floating `"latest"`; apply the set-coherence rule above (pin the set to its latest stable release, renderer following its peer) to the WHOLE set, never split. Guessing a wrong version causes `pnpm install` failure.

#### Design-Prescribed Dependency API Discovery

**Principle**: If the design document specifies a dependency, the execution environment is expected to have the necessary access credentials. A package appearing in the design document is evidence that the user has — or intends to have — access to it. Do NOT preemptively assume authentication will fail.

**Constraints**:
- Include ALL dependencies from the design document in `package.json` — including private or organization-scoped packages. Do NOT skip based on assumptions about registry authentication or package accessibility. `pnpm install` will reveal actual access issues.
- All `pnpm` / `npm` commands MUST use `working_directory: "codebase"`. The default working directory is the feature root (parent of `codebase/`), where no `package.json` exists. Do NOT use `cd codebase &&` — use the `working_directory` parameter.

**Protocol** (after `pnpm install` completes — index then drill-down):

1. `read_file("codebase/node_modules/{package}/package.json")` — find the `types` or `typings` entry point. For scoped packages: `read_file("codebase/node_modules/@scope/name/package.json")`
2. `read_file` the entry `.d.ts` — scan exported symbol names (this serves as the index)
3. If the `.d.ts` is large, use `list_files` to explore the package structure, then read specific sub-module `.d.ts` files relevant to your task

**Constraint**: If `pnpm install` fails (authentication error, package not found, registry unreachable), do NOT proceed with guessed APIs. Instead, output a message to the user explaining:
- Which package failed and the error message
- Likely cause (e.g., private registry requiring `.npmrc` configuration or authentication token)
- Suggested resolution steps

⚠️ **Blind spot**: Private or organization-scoped packages are easily omitted from `package.json` with the assumption "this will fail without auth." The execution environment often has credentials pre-configured (`.npmrc`, registry tokens, SSH keys). Always include them — only report failure after an actual failed install.

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
- This example is **Vite + React**; its `react`/`react-dom` versions are illustrative. For a meta-framework (e.g. Next.js), the renderer version follows the framework as ONE set (see §0 Step 2 set-coherence): pin the set to its latest stable release and let the renderer follow its peer — do NOT use floating `"latest"` for the set, and do NOT split majors across it.

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

⚠️ **Blind Spot — Build emit polluting source tree:**

**Observation target**: For every `tsconfig*.json` in the project, verify: will `tsc` / `tsc -b` produce any output files (`.js`, `.d.ts`, `.map`) alongside source `.ts` files?

**Constraint**: Build commands must NOT deposit compiled artifacts in the source tree. If a tsconfig enables emit (explicitly or implicitly), output must be directed outside the source tree or suppressed entirely.

### Multi-package workspace: tsconfig composition

If your workspace is multi-package (a root workspace setup task **plus** per-package setup tasks — see §0), the single-package example above is not the whole picture: tsconfig is **composed** across a root base and per-package files. Author the half that matches your task's scope.

**Root base tsconfig** (root setup task): the shared `compilerOptions` baseline — `target` / `module` / `moduleResolution` / `strict` / `esModuleInterop` / `skipLibCheck`. It MAY also carry options that are inert where unused (a `jsx` setting does nothing for a member that compiles no JSX), so a baseline `jsx` is acceptable — the base is a shared baseline, not a "no member-specific options" rule.

**Per-package tsconfig** (per-package setup task): `extends` the root base via a relative path that **actually resolves** to it, then add or override only what this member needs beyond the baseline. Before authoring, observe the real base (`list_files` / `read_file` at the `codebase` root — the root setup runs first, so the base already exists) so you extend a path that exists and know which options are **actually inherited**; do not guess the path or assume an option is present.

⚠️ **Blind spot — the effective config must carry what the member compiles**: a member that compiles JSX / `.tsx` must end up with `jsx` set in its **effective** config (own + inherited) — inherited from a base that carries it, OR declared in the member when the base does not. The failure mode is `jsx` absent from **both** base and member because inheritance was assumed but never provided — then every JSX file errors. The same holds for the DOM `lib` a browser member needs. Verify the effective config; do not assume inheritance.

**Cross-package references**: when one member imports another workspace member, set `composite: true` on the **referenced** member's tsconfig and list it under the consumer's `references`. How to invoke the type-check/build for a referenced/composite layout is the verification phase's concern — author the config here, not the build command.

## 3. Build Tool Configuration

**Constraint**: Every build framework has a native config file. This config file MUST be created during setup -- it is not optional.

**Observation Target**: Check if `preview-setup` injection is present in the prompt. If so, its environment variable bindings (base path, API base URL) MUST be wired into the framework config file during setup.

## 4. Style/Linting Configuration

Configure as needed for project (styling framework, ESLint, etc).

**⚠️ Blind Spot — Styling framework source scan paths:**

**Principle**: CSS utility frameworks require source scan paths that cover every directory where source files with styling classes will exist.

**Constraint**: Do NOT assume existing scan paths are correct. Observe where the framework convention places source files, and ensure scan paths match.

## 5. .gitignore

**Principles:**
- Include common artifacts: `node_modules`, `dist`, `build`, `.env`, `*.log`
- Include framework/platform-specific build outputs and caches (e.g., Next.js → `.next`, Nuxt → `.nuxt`, etc.)
- Include IDE/editor-specific files if appropriate
- When uncertain about platform artifacts, research the framework's recommended gitignore patterns

## 6. Environment Files

**Principle**: When project requires environment variables, create both `.env.example` (committed template) and `.env` (active, gitignored).

**Constraints**:
- `.env.example` MUST use `@connection` annotations for service connection variables (see preview-env-contract). `.env` MUST contain the same variables with localhost/docker-compose default values.
- In monorepos with multiple packages, follow the layered placement from the platform runtime contract (Section 3.5) — shared infrastructure connections at root, service-specific config per package.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES:**

❌ Using npm workspaces instead of pnpm for monorepos
❌ Using `"*"` instead of `"workspace:*"` for monorepo package refs
❌ Using `"workspace:*"` for external packages not present in `pnpm-workspace.yaml` (same-org scope does NOT mean workspace-local)
❌ Inventing version numbers for design-prescribed packages (use `"latest"` — the package manager resolves it; a wrong guess causes install failure)
❌ Using the floating `"latest"` tag for the framework↔runtime set — pin its latest stable release instead; floating `latest` silently jumps majors on a later install and breaks the peer match
❌ Splitting a framework↔runtime set across version strategies (e.g. `"next": "latest"` + `"react": "^18.2.0"`) — a meta-framework and its renderer are ONE version decision; mixing `latest` with a fixed older range causes a peer mismatch that breaks at runtime
❌ Root `--filter` targets that do not match a member `package.json` `name` verbatim (placeholder scope, typo, or a scope the members don't use) — the filter silently matches nothing
❌ Emitting speculative `allowBuilds` placeholder entries (`pkg: set this to true or false`) — values must be booleans; list runtime-critical native deps `true`, otherwise omit the block
❌ Guessing function names or type signatures for unfamiliar packages (read `.d.ts` files from `node_modules` to observe the actual API first)
❌ Omitting private/organization packages from `package.json` based on assumptions about authentication (always include — the environment may have credentials configured)
❌ Running `pnpm` / `npm` commands without `working_directory: "codebase"` (default cwd is feature root, not codebase — `package.json` not found)
❌ Using `cd codebase &&` in commands instead of the `working_directory` parameter
❌ Forgetting `"moduleResolution": "node"` in tsconfig.json
❌ Missing `@types/` packages in devDependencies
❌ Wrong `"module"` setting (use "ESNext" not "CommonJS")
❌ Not setting `"type": "module"` in package.json
❌ tsconfig that emits compiled output (`.js`, `.d.ts`) into the source tree (verify every `tsconfig*.json` — implicit emit flags are easy to miss)
❌ Multi-package workspace with no root `build` / `dev` / production-serve script — forcing a manual per-package sequence (a monorepo MUST boot from one root command, and ship a build + serve path for deployment)
❌ A shared workspace library consumed as a build artifact with neither root build-ordering nor source consumption (`transpilePackages` / `exports`→src) — apps cannot start from a clean checkout until the library is hand-built first

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

