## TypeScript Verification Hints

### Package Manager Detection

**Principle**: The lockfile determines the correct package manager. Using the wrong one corrupts dependency resolution.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Lockfile** | Which lockfile exists? This dictates all install and run commands. |
| **Workspace config** | Does `pnpm-workspace.yaml`, `workspaces` in package.json, or similar exist? If yes, dependency installation is workspace-scoped. |

**Constraint**: Do NOT run `npm install` when a non-npm lockfile is present. Observe the lockfile type before any install command.

⚠️ **Blind spot**: Monorepo projects with workspace configuration require a single install at the root. Running install inside individual packages creates duplicate `node_modules` and version conflicts.

---

### Compilation Strictness

**Principle**: `tsconfig.json` `strict` mode elevates patterns to compile errors that are silently ignored in non-strict mode.

| Pattern | Strict Mode Behavior |
|---------|---------------------|
| **Implicit any** | Compile error — explicit type annotation required |
| **Null/undefined access** | Compile error — narrowing or optional chaining required |
| **Unused locals/parameters** | Compile error if `noUnusedLocals`/`noUnusedParameters` enabled |

**Constraint**: Before attempting source code fixes for type errors, observe `tsconfig.json` strict-related flags. The fix strategy depends on which checks are enabled.

---

### Build Order

**Principle**: In monorepo projects, packages with cross-package dependencies must be built in dependency order.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Project references** | Does `tsconfig.json` contain `references`? If yes, `tsc --build` handles ordering automatically. |
| **Package dependencies** | Do workspace packages reference each other in their `dependencies`? Build shared packages first. |

**Constraint**: Do NOT attempt to build a package that imports from another workspace package until that dependency package compiles successfully.

⚠️ **Blind spot**: TypeScript project references (`references` in tsconfig) require `composite: true` in referenced projects. A missing `composite` flag causes silent build failures with unhelpful error messages.
