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

---

### Type-Check Invocation

**Principle**: The type-check command must match the project's configured shape — the same shape you already observed in Build Order. A check that ignores that shape either misses code or conflates one upstream fault with its downstream cascade.

| Configured shape | Type-check invocation |
|---|---|
| **Single package** (default) | `tsc --noEmit` |
| **Project `references` / `composite`** | `tsc --build` — it type-checks the referenced graph in dependency order |
| **Multi-package workspace without `references`** | Check each package against its own `tsconfig` (e.g. `tsc -p <package>/tsconfig.json`) or run each package's configured type-check script. A single root `tsc --noEmit` does not represent the per-package configs and is not a substitute. |

**Constraint**: Prefer running the standalone type-check before the framework build — it reveals the full set of type errors, whereas a framework build CLI aborts after the first few. This ordering is an efficiency preference, NOT a license to skip the build: the build is a distinct required gate (see Build Invocation below). Type-check green does not discharge it.

⚠️ **Blind spot**: A single root `tsc --noEmit` in a workspace is the trap that drowns one upstream config fault under hundreds of cascaded leaf errors. Choose the invocation by the configured shape above, not by reflex.

### Build Invocation

**Constraint**: Once the type-check is green, run the project's actual build — a green type-check does NOT discharge the build gate (gate completeness is owned by rules.md "Verification Gate Ordering"). In a workspace, build via the recursive workspace build (the root build script / `<pm> -r build`) so every member assembles: each application's framework build AND each library's build (e.g. a bundler emitting `.d.ts`).

⚠️ **Blind spot**: The build performs checks `tsc --noEmit` never runs, so `tsc --noEmit` green + tests green does NOT imply the build is green. TS/JS build-time-only failures include a framework refusing to collect its route tree (e.g. a duplicate dynamic-route slug name) and a bundler declaration (`.d.ts`) config fault (e.g. `composite` colliding with the bundler's dts pass).

### Cascade Root Cause

**Principle**: In a configured TypeScript workspace, a large error count usually traces to a **single upstream config/contract fault** — a missing `compilerOptions` flag (e.g. `jsx`), a wrong `extends` path, or an absent `@types/*` — cascading across many files. The leaf errors are symptoms, not independent defects.

**Constraint**: Diagnose that upstream fault as the **single root-cause `batches[]` entry**. The cascaded count collapses after that sub-task lands and the gates re-run — do NOT enumerate the cascaded errors as separate fix entries.

---

### Config File Property Names

**Principle**: Test runner and framework config files use specific property names. Misspelled keys are silently ignored, causing hard-to-diagnose runtime failures.

**Constraint**: When a remediation plan modifies a config file, use ONLY documented property names from the list below. If uncertain, read the installed package's `.d.ts` type definition.

| Config File | Commonly Confused | Correct Property |
|-------------|-------------------|-----------------|
| `jest.config.*` | `setupFilesAfterSetup` | `setupFilesAfterEnv` |
| `jest.config.*` | `testMatch` vs `testRegex` | Both valid — observe which is already used |
| `vitest.config.*` | `setupFiles` | `setupFiles` (Vitest) or `setupFilesAfterEnv` (Jest) |
| `next.config.*` | `basepath` | `basePath` (camelCase) |

⚠️ **Blind spot**: `setupFilesAfterSetup` does NOT exist in any test framework. The correct Jest key is `setupFilesAfterEnv`. This mistake is silent — Jest ignores unknown keys, so the setup file never loads and tests fail with missing matchers or globals.
