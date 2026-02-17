## Go Setup Task Constraints

**CRITICAL: Configuration files ONLY - No application code**

## PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ CORRECT:
  codebase/go.mod
  codebase/Makefile
  codebase/.gitignore

❌ WRONG:
  go.mod          ← Missing codebase/ prefix!
  Makefile        ← Missing codebase/ prefix!
```

**Setup Task Scope:**
```
PHASE 1 (Setup):    Config files in codebase/ → go mod tidy → Ready for code
PHASE 2 (Feature):  Application code in codebase/ → Build → Done
```

### File Categories:

**✅ CREATE (Configuration layer)**
- Module: go.mod
- Build: Makefile
- Ignore: .gitignore
- Environment: `.env.example` (template with `@connection` annotations) AND `.env` (active copy with localhost/docker defaults)
- Infrastructure: docker-compose.yml (see Infrastructure Services below)
- Documentation: README.md

**❌ DON'T CREATE (Application layer)**
- Source directories: cmd/*, internal/*, pkg/*
- Application files: main.go, handler.go, service.go, repository.go
- Any .go source files

**Validation Rule:**
```
Before output, check each file:
  Application code directory? → DELETE
  Application entry/source file? → DELETE
  Config/build file? → KEEP
```

**Critical Requirements:**
1. `go.mod` must have correct module path
2. `Makefile` must include `build`, `run`, `test` targets
3. Next task will create ALL application code - don't do it now
4. Include ALL infrastructure services in docker-compose.yml if design doc specifies them

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
- `.env.example` MUST use `# @connection {category} {name}` annotation for each service connection endpoint (URL or address). Do NOT annotate individual components (host, port, user, password) — only the connection URL variable.
- Same-project internal connections (e.g., frontend → backend in fullstack) MUST add `self`: `# @connection business {name} self`
- Cross-project connections (e.g., frontend project referencing a separate backend project) MUST use `ant-project:{projectId}:{feature}`: `# @connection business {name} ant-project:{projectId}:{feature}`

**Blind spot reminder**:
- `dev-infra` / `dev-infra-down` Makefile targets are EASILY FORGOTTEN. Verify they exist.
- `@connection` annotations in `.env.example` are EASILY FORGOTTEN. Verify every connection endpoint URL has one (but not individual components like host, port, user, password).
- The `self` keyword for internal connections is EASILY FORGOTTEN in fullstack/monorepo projects.
- The `ant-project:{projectId}:{feature}` modifier for cross-project connections is EASILY FORGOTTEN when the specification names a specific external project as a dependency.
