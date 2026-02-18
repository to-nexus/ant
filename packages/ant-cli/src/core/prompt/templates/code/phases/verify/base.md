# Build & Runtime Verification

You are verifying that the integrated codebase builds and starts without errors.

## Scope

**Build and startup errors ONLY.** Feature completeness is the responsibility of feature tasks, not this task.

## Constraints

| Constraint | Rule |
|-----------|------|
| **No feature work** | Do NOT review, add, complete, or improve feature implementations. Do NOT search for incomplete code or missing functionality. |
| **No over-engineering** | Fix only what prevents build or startup. Do NOT refactor, reorganize, or "improve" working code. |
| **Batch-fix** | Collect ALL errors from a single build output, then fix them ALL in one pass. Do NOT fix one error and re-run. |
| **Dev server behavior** | Dev servers do NOT terminate. Success = outputs a startup/ready message. Do NOT wait for exit. |

## Verification Protocol

### Step 1: Discover

Observe the project's configuration files to determine build, dev, and infrastructure commands.

| Checkpoint | What to observe |
|-----------|----------------|
| **Build/dev commands** | Read project config files to find build and start commands. Do NOT assume. |
| **Infrastructure definition** | Does `docker-compose.yml` (or `compose.yml`) exist? If yes, infrastructure is required. |
| **Environment requirements** | Read `.env.example`, config files, or entry point to identify required environment variables. |
| **Connection annotations** | Does `.env.example` annotate connection variables with `@connection`? If not, add them. Are same-project internal connections marked with `self`? |
| **Env file consistency** | Do `.env.example` and `.env` contain the same variable keys? If a variable exists in one but not the other, add it to the missing file. |

### Step 2: Environment & Infrastructure

An application cannot start without its environment configuration and dependent services. Resolve environment issues BEFORE attempting to build.

| Checkpoint | Action |
|-----------|--------|
| **Environment file** | If `.env.example` exists but `.env` does not, create `.env` from `.env.example`. If both exist, verify variable keys match. Map connection values to infrastructure service credentials and ports. |
| **Start services** | If infrastructure definition exists, run `docker compose up -d --wait` in the directory containing the compose file. |
| **Verify readiness** | Services must be healthy before proceeding. |

**Blind spot**: Environment variables are EASILY MISSED. If `.env.example` exists, the application almost certainly requires a `.env` file with resolved values.

### Step 3: Build

Run the project's build/compile command.

**Principle**: Build errors are concrete and finite. When the build fails:
1. Read the COMPLETE error output — scroll through ALL of it
2. List EVERY distinct error (file, line, message) before writing any fix
3. Fix ALL errors across ALL files in a single batch of edit_file calls
4. Only THEN re-run the build

**Constraint**: Do NOT fix-and-rebuild after each individual error. Each rebuild costs a full iteration. If the build reports 8 errors, fix all 8 before rebuilding. A single rebuild cycle that fixes 8 errors is 8x more efficient than 8 separate cycles.

### Common Build Error: Duplicate Symbols

**Principle**: When parallel tasks independently create the same type, function, or variable in a shared namespace, the compiler reports duplicate/redeclared symbol errors. These are NOT independent errors — they share a single root cause: the symbol exists in multiple files.

**Resolution strategy**:
1. Identify ALL files that declare the duplicated symbol (`search_code`)
2. Choose the ONE file that is the most complete or most appropriate owner
3. Delete or remove the duplicate declarations from all other files
4. Update imports in files that referenced the deleted declarations
5. Repeat for ALL duplicate symbols before rebuilding

**Constraint**: Resolve ALL duplicate symbols in a single batch before rebuilding. Each duplicate symbol may cascade into multiple compiler errors (unused imports, missing references). Fixing the root cause (removing duplicate declarations) resolves the cascading errors together.

⚠️ **Blind spot**: A single duplicate struct/type can produce 5-10 compiler errors (redeclaration + each method/usage). Count unique duplicate symbols, not error lines.

### Step 4: Runtime (if build succeeds)

Run the project's dev/start command to verify the application starts.

**Principle**: Runtime validates the full stack — build artifacts, infrastructure, and environment configuration. If startup fails due to environment or configuration issues, fix and retry.

**Constraint**: If `docker compose up` fails, still attempt build. Skip runtime.

## Completion

After completing all applicable steps, output `<done>true</done>`.

## PATH CONVENTION

All paths are relative to the feature root.
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see verify/rules.md**
