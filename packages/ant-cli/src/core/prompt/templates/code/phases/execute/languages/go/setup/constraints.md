## Go Setup Task Constraints

**CRITICAL: Configuration files ONLY - No application code**

## PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ CORRECT (single service):
  codebase/go.mod
  codebase/Makefile
  codebase/.gitignore

✅ CORRECT (MSA root setup):
  codebase/go.work
  codebase/Makefile
  codebase/docker-compose.yml
  codebase/.gitignore
  codebase/.env.example

✅ CORRECT (MSA service setup):
  codebase/services/{svc}/go.mod
  codebase/services/{svc}/Makefile

❌ WRONG:
  go.mod          ← Missing codebase/ prefix!
  Makefile        ← Missing codebase/ prefix!
```

**Setup Task Scope:**
```
PHASE 1 (Setup):    Config files in codebase/ → Done (system handles dependency download)
PHASE 2 (Feature):  Application code in codebase/ → Build → Done
```

### File Categories:

**✅ CREATE (Configuration layer — single service OR MSA root setup)**
- Module: go.mod (single service) OR go.work (MSA root)
- Build: Makefile
- Ignore: .gitignore
- Environment: `.env.example` (template with `@connection` annotations) AND `.env` (active copy with localhost/docker defaults)
- Infrastructure: docker-compose.yml (see Infrastructure Services below)
- Documentation: README.md

**✅ CREATE (Configuration layer — MSA service setup)**
- Module: services/{svc}/go.mod
- Build: services/{svc}/Makefile

**❌ DON'T CREATE (Application layer)**
- Source directories: cmd/*, internal/*, pkg/*
- Application files: main.go, handler.go, service.go, repository.go
- Any .go source files

**Constraint**: Only create configuration-layer files. Do NOT create application code directories (cmd/*, internal/*, pkg/*) or .go source files.

**MSA Root vs Service Setup Constraint**: In multi-service projects, the root setup task creates workspace-level files (`go.work`, root `Makefile`, `docker-compose.yml`, `.gitignore`, `.env.example`, `.env`). Service-level setup tasks create ONLY `services/{svc}/go.mod` and `services/{svc}/Makefile`. Do NOT create `docker-compose.yml`, `.env.example`, or `.gitignore` inside service directories.

### Workspace Version Consistency (Multi-Module Projects)

**Principle**: In multi-module workspaces, all module definition files must declare the same language/runtime version. A mismatch between the workspace root and individual modules causes silent toolchain resolution failures.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Version alignment** | Does the workspace-level version declaration match every module's version declaration? |
| **Dependency floor** | Do declared versions satisfy the minimum required by all transitive dependencies? |

**Constraint**: Do NOT assume a default version is safe. Observe the highest minimum version required by any dependency, and declare that version consistently across all module files.

⚠️ **Blind spot**: Version mismatches between workspace root and module files are invisible until build or toolchain resolution fails. Verify alignment at creation time.

**Critical Requirements:**
1. `go.mod` (or `go.work` for MSA) must have correct module path(s)
2. `Makefile` must include `build`, `run`, `test` targets
3. Next task will create ALL application code - don't do it now
4. Include ALL infrastructure services in docker-compose.yml if design doc specifies them
5. In MSA, every service `go.mod` that `require`s a workspace-local sibling module (source directory physically present in this workspace) MUST also have a `replace` directive pointing to its relative local path. Do NOT add `replace` for modules whose source is not in this workspace — regardless of organization name or module path prefix. For external modules whose version is unknown, omit them from `require` entirely — do NOT use `v0.0.0`. The verification phase's `go mod tidy` resolves omitted modules from import statements automatically

**Constraint**: `docker-compose.yml` MUST contain ONLY infrastructure services (databases, caches, message queues). Do NOT add application services (API servers, web servers, redirect services) — even if the design document describes them as Docker containers. The platform manages application process lifecycle separately.

## Infrastructure Services (Observe Design Document)

| Checkpoint | Observation Target |
|------------|-------------------|
| **External services** | Does the design document specify services that require a running server process? |
| **Environment** | Is this project frontend-only (no backend in this workspace)? |

**Principle**: Infrastructure provisioning belongs to the project root level.

**Environment Constraint**:
- If this project is **frontend-only** (detected environment is `BROWSER` without a backend package in the same workspace): Do NOT create `docker-compose.yml`, `dev-infra` Makefile targets, or `.env.example` for external services — even if the design document mentions databases, caches, or queues. Infrastructure provisioning is the responsibility of the separate backend project.
- Only create infrastructure files when **this project itself** runs the external services.

**If external services observed** (database, Redis, message queue, etc.) **AND project runs them**:

| Required Output | Purpose |
|----------------|---------|
| `docker-compose.yml` | Local development environment for each observed service |
| Makefile targets: `dev-infra`, `dev-infra-down` | Start/stop infrastructure services |
| `.env.example` AND `.env` | Template with `@connection` annotations AND active copy with localhost/docker defaults (see preview-env-contract) |

**Constraints**:
- Do NOT hardcode connection URLs in application code. Use environment variables.
- Do NOT omit healthcheck for any service in docker-compose.yml.
- Do NOT omit volume mounts for stateful services (data must survive container restart).
- Do NOT run `docker compose up` in setup tasks. Only create the files.
- Do NOT set `container_name` for any service in docker-compose.yml. The platform namespaces containers using a project-scoped `-p` flag. An explicit `container_name` bypasses that namespace and causes container name conflicts across runs or projects.
- `.env.example` MUST use `# @connection {category} {name}` annotation for each service connection endpoint (URL or address). Do NOT annotate individual components (host, port, user, password) — only the connection URL variable.
- Same-project internal connections (e.g., frontend → backend in fullstack) MUST add `self`: `# @connection business {name} self`
- Cross-project connections (e.g., frontend project referencing a separate backend project) MUST use `ant-project:{projectId}:{feature}[:{serviceName}]`: `# @connection business {name} ant-project:{projectId}:{feature}`. Optionally append `:{serviceName}` to target a specific service in a multi-package project

**Blind spot reminder — include these when creating files:**
- `dev-infra` / `dev-infra-down` Makefile targets are EASILY FORGOTTEN. Include them when creating the Makefile.
- `@connection` annotations in `.env.example` are EASILY FORGOTTEN. Include annotation for every connection endpoint URL (but not individual components like host, port, user, password).
- The `self` keyword for internal connections is EASILY FORGOTTEN in fullstack/monorepo projects.
- The `ant-project:{projectId}:{feature}[:{serviceName}]` modifier for cross-project connections is EASILY FORGOTTEN when the specification names a specific external project as a dependency.
