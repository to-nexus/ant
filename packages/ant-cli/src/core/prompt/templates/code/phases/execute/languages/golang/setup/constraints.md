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
- Environment: .env.example
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

**Principle**: Infrastructure provisioning belongs to the project root level.

**If external services observed** (database, Redis, message queue, etc.):

| Required Output | Purpose |
|----------------|---------|
| `docker-compose.yml` | Local development environment for each observed service |
| Makefile targets: `dev-infra`, `dev-infra-down` | Start/stop infrastructure services |
| `.env.example` | Connection URLs for each service |

**Constraints**:
- Do NOT hardcode connection URLs in application code. Use environment variables.
- Do NOT omit healthcheck for any service in docker-compose.yml.
- Do NOT omit volume mounts for stateful services (data must survive container restart).
- Do NOT run `docker compose up` in setup tasks. Only create the files.

**Blind spot reminder**:
- `dev-infra` / `dev-infra-down` Makefile targets are EASILY FORGOTTEN. Verify they exist.
- `.env.example` must include ALL service connection URLs.
