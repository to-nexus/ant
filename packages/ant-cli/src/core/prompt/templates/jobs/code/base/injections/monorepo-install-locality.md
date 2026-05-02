{{#if monorepoActive}}
## Monorepo Install Locality

**Principle**: When the codebase contains a workspace marker, the lockfile and the dependency authority belong to the **workspace root**, not to a member directory. Dependency mutations issued from inside a member directory either produce a duplicate dependency tree or stall behind the package-manager's global mutex.

**Observed workspace topology** (from `analyzeWorkspace`):
- Root: `{{monorepoRootPath}}` (relative to feature directory)
- Marker: `{{monorepoRootMarker}}` (`{{monorepoManagerLabel}}`)
{{#if monorepoMembersSummary}}- Members — {{monorepoMembersSummary}}{{/if}}

**Constraint**: Issue install / add / remove commands with `working_directory` set to the workspace root, OR use the manager's member-targeting flag from the workspace root. Do NOT `cd` into a member directory and run a bare install verb.

**Constraint**: A new lockfile appearing inside a member directory is a regression signal — that signals the install ran outside the workspace and produced a duplicate dependency tree.

**Constraint**: Read-only commands (`ls`, `cat`, `<manager> why`, `<binary> --version`) have no locality requirement — only mutating commands (install / add / remove and the workspace-sync equivalents) are scoped.

⚠️ **Blind spot**: A member directory often has its own `package.json` / `Cargo.toml` / `pyproject.toml` — its presence does NOT make it the install root. The workspace marker at the actual root is the SSOT.

**Invocation form for `{{monorepoManagerLabel}}`** (issue from `{{monorepoRootPath}}` unless noted):
{{#if (eq monorepoManagerLabel "pnpm-workspace")}}
- Workspace-root devDep: `pnpm add -Dw <pkg>`
- Single member: `pnpm --filter <member-name> add <pkg>` (run from root)
- A bare `pnpm add <pkg>` inside a member directory ALSO mutates the workspace lockfile, but only the member's `package.json` records the dep — prefer the explicit `--filter` form so reviewer + LLM agree on the intent.
{{/if}}
{{#if (eq monorepoManagerLabel "npm-workspaces")}}
- Workspace-root devDep: `npm install -D <pkg>` (run from root)
- Single member: `npm install <pkg> --workspace=<member-name>` (run from root)
- Do NOT `cd <member>` and run `npm install <pkg>` — npm 7+ resolves relative to the nearest `package.json` and may bypass the root lockfile in older toolchains.
{{/if}}
{{#if (eq monorepoManagerLabel "yarn-workspaces")}}
- Workspace-root devDep: `yarn add -D -W <pkg>` (Yarn classic) | `yarn add -D <pkg>` (Yarn Berry; `-W` is rejected)
- Single member: `yarn workspace <member-name> add <pkg>` (run from root)
{{/if}}
{{#if (eq monorepoManagerLabel "bun-workspaces")}}
- Workspace-root devDep: `bun add -d <pkg>` (run from root)
- Single member: `bun add <pkg> --filter <member-name>` (run from root)
{{/if}}
{{#if (eq monorepoManagerLabel "cargo-workspace")}}
- Workspace-wide dep: `cargo add --workspace <pkg>` (Cargo 1.74+; run from root)
- Single member: `cargo add <pkg> -p <member-name>` (run from root) — `Cargo.lock` is workspace-scoped, so even per-member additions update the root lockfile.
{{/if}}
{{#if (eq monorepoManagerLabel "go-workspace")}}
- Go workspaces do NOT share a single dependency graph — each module keeps its own `go.mod` / `go.sum`. Issue `go get <pkg>` inside the member module's directory; this is the documented per-member flow and is NOT a locality violation.
- Use `go work sync` from the workspace root after per-member changes to align replace directives.
{{/if}}
{{#if (eq monorepoManagerLabel "uv-workspace")}}
- Workspace-root dep: `uv add <pkg>` (run from root)
- Single member: `uv add <pkg> --package <member-name>` (run from root)
{{/if}}
{{/if}}
