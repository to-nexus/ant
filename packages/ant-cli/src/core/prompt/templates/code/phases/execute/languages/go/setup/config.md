━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GO PROJECT SETUP - CRITICAL CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ codebase/go.mod
✅ codebase/Makefile
✅ codebase/.gitignore

❌ go.mod (WRONG - missing codebase/ prefix)
```

---

## 0. Project Structure Decision

**Observe the design document for service boundary indicators.**

**Single service (default):**
```
codebase/
├── cmd/
│   └── server/          # Entry point (main.go)
├── internal/            # Private application code
│   ├── handler/         # HTTP handlers (or controller/)
│   ├── service/         # Business logic
│   ├── repository/      # Data access
│   └── model/           # Domain types and structs
├── pkg/                 # Public reusable packages (if any)
├── go.mod
├── go.sum
├── Makefile
├── .gitignore
└── .env.example
```

**Principle**: `internal/` enforces Go's built-in access control — packages under `internal/` cannot be imported by external modules. Use this for application-specific code.

**Principle**: `cmd/{name}/` is the standard entry point convention. Each subdirectory contains a `main.go` that wires dependencies and starts the application.

**Constraint**: If design document specifies architecture boundaries (e.g., handler/service/repository layers), each boundary MUST correspond to a directory under `internal/`.

**Multi-service (MSA — when multiple backend design documents exist):**
```
codebase/
├── go.work                     # Go workspace declaration
├── shared/                     # Shared library module (if cross-service types exist)
│   ├── go.mod
│   └── types/
├── services/
│   ├── {svc-a}/
│   │   ├── go.mod              # Independent module
│   │   ├── cmd/server/         # Entry point (main.go)
│   │   ├── internal/           # Private application code
│   │   ├── Makefile            # Service-level build targets
│   │   ├── .env.example        # Service-specific config (PORT, API keys)
│   │   └── .env
│   └── {svc-b}/
│       ├── go.mod
│       ├── cmd/server/
│       ├── internal/
│       ├── Makefile
│       ├── .env.example
│       └── .env
├── docker-compose.yml
├── Makefile                    # Root-level orchestration
├── .gitignore
├── .env.example                # Shared infrastructure connections
└── .env
```

**Principle**: `go.work` declares all modules via `use` directives. Go 1.18+ workspace mode resolves cross-module imports locally without publishing modules.

**Principle**: Each service under `services/` is an independent Go module with its own `go.mod`. Module path follows `github.com/{org}/{project}/services/{svc}`.

**Principle**: The `shared/` module (if needed) contains cross-service types, DTOs, and utility packages. Module path: `github.com/{org}/{project}/shared`. Only create this when 2+ services share domain types.

**Constraint**: Root setup task (priority 100) creates `go.work`, root `Makefile`, `docker-compose.yml`, `.gitignore`, and root `.env.example` / `.env` with shared infrastructure connections. Service-level setup tasks (priority 101, 102, ...) create `services/{svc}/go.mod`, `services/{svc}/Makefile`, and `services/{svc}/.env.example` / `.env` with service-specific configuration (PORT default, API keys, connections used by that service only). See the platform runtime contract (Section 3.5) for the layered placement principle.

---

## 1. go.mod (and go.work for MSA)

### Version Selection Protocol

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Workspace root file** | Does `go.work` already exist? If so, observe its declared `go` version. |
| **Version selection** | Use the observed workspace version for ALL `go.mod` files. If no workspace file exists, use the latest stable Go version. |

⚠️ **Constraint**: Do NOT assume or hardcode a specific Go version. Observe the existing workspace version first.

**Single service:**
```
module github.com/{org}/{project}

go {observed-version}
```

**Multi-service — root `go.work`:**
```
go {version}

use (
    ./shared
    ./services/{svc-a}
    ./services/{svc-b}
)
```

**Multi-service — each `services/{svc}/go.mod`:**
```
module github.com/{org}/{project}/services/{svc}

go {same-version-as-go.work}

require (
    github.com/{org}/{project}/shared v0.0.0
)

replace (
    github.com/{org}/{project}/shared => ../../shared
)
```

**Multi-service — `shared/go.mod`:**
```
module github.com/{org}/{project}/shared

go {same-version-as-go.work}
```

**Key points:**
- Module path should match the intended repository path
- If the task description requires declaring dependencies, list them in the `require` block
- The `go` version directive in `go.work` and every `go.mod` MUST be identical. A mismatch causes toolchain resolution failures that are invisible until build time

### Dependency Classification — `replace` Directive Protocol

For each `require` entry, observe whether the module source directory is physically present in this workspace:

| Module physically present in workspace? | `require` version | `replace` directive |
|-----------------------------------------|-------------------|---------------------|
| **YES** — listed in `go.work` or confirmed as sibling directory | `v0.0.0` | REQUIRED — relative path to local directory |
| **NO** — not in workspace filesystem | Real version from design doc or known tag | FORBIDDEN — do NOT add |

**Constraint**: Do NOT infer workspace-local status from module path prefix, organization name, or terminology in the design document ("shared packages", "common libraries", "internal packages"). A module is workspace-local ONLY if its source directory is physically present in this workspace.

**Constraint**: A `replace` directive pointing to a non-existent directory always causes build failure. If the target directory does not exist, the module is external.

⚠️ **Blind spot**: Packages published by the same organization (e.g., `github.com/{org}/other-repo`) are easily confused with workspace-local sibling modules. They are external dependencies — treat them identically to any third-party package unless their source directory is confirmed present.

**⛔ Do NOT run any `go` commands (`go mod tidy`, `go mod download`, `go get`, `go get ./...`) during setup.**

**Principle**: All Go dependency commands resolve against `.go` source files or the `require` block. Setup creates no `.go` files, so:
- `go mod tidy` scans imports → finds none → **deletes all require entries**
- `go mod download` with an empty require block → "no module dependencies to download"
- `go get ./...` resolves package imports → finds none → "matched no packages"

Each of these produces a warning or destructive side-effect that triggers unnecessary file re-creation.

**What to do instead**: Declare all dependencies directly in go.mod's `require` block when creating the file. The system handles dependency download automatically after file creation — you do not need to run any command.

---

## 2. Makefile

**Principle**: Provide standard development commands at the project root.

**Single service — required targets:**

```makefile
.PHONY: build run test lint clean

# Build binary
build:
	go build -o bin/server ./cmd/server

# Run in development
run:
	go run ./cmd/server

# Run tests
test:
	go test ./...

# Run linter (if golangci-lint available)
lint:
	golangci-lint run ./...

# Clean build artifacts
clean:
	rm -rf bin/
```

**Constraint**: `run` target MUST use `go run ./cmd/...` — NOT a pre-built binary path. The `build` target produces binaries for deployment; the `run` target compiles and executes in one step for development.

**Constraint**: `make run` must be the standard way to start the dev server. Adjust the entry point path in `build` and `run` targets to match `cmd/` structure.

**Multi-service — root Makefile (orchestration):**

```makefile
SERVICES := {svc-a} {svc-b}

.PHONY: build run test lint clean $(SERVICES)

# Build all services
build:
	@for svc in $(SERVICES); do $(MAKE) -C services/$$svc build; done

# Run a specific service: make run-{svc}
run-%:
	$(MAKE) -C services/$* run

# Run tests across all modules
test:
	@for svc in $(SERVICES); do $(MAKE) -C services/$$svc test; done

# Clean all
clean:
	@for svc in $(SERVICES); do $(MAKE) -C services/$$svc clean; done
```

**Multi-service — each `services/{svc}/Makefile`:**

```makefile
.PHONY: build run test clean

build:
	go build -o bin/server ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./...

clean:
	rm -rf bin/
```

**Constraint**: In MSA, `make run-{svc}` at the root must start a specific service. Each service Makefile must be self-contained with `build`, `run`, `test`, `clean` targets.

**Constraint**: Each service `run` target MUST use `go run ./cmd/...` — NOT a pre-built binary path. Parallel setup tasks generate Makefiles independently; `go run` ensures consistent behavior without requiring a prior `build` step.

---

## 3. .gitignore

**Required entries:**
```
# Binary output
bin/
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test output
*.test
*.out
coverage.txt

# Dependency directory (if vendored)
vendor/

# Environment
.env
.env.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

---

## 4. .env.example AND .env

**Principle**: Document all required environment variables with placeholder values. Connection variables MUST use `@connection` annotation (see preview-env-contract Section 4).

**Constraint**: When creating `.env.example`, ALWAYS also create `.env` with the same variables. Use localhost/docker-compose default values for connection strings in `.env`.

```env
# Plain configuration (no annotation)
PORT=8080
ENV=development

# Connection endpoint URLs only — annotate with @connection
# Do NOT annotate individual components (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD)
# @connection {category} {name}                                -- external / infrastructure
# @connection {category} {name} self                           -- same-project internal
# @connection {category} {name} ant-project:{projectId}:{feature}[:{serviceName}] -- cross-project (serviceName optional)
# {CONNECTION_URL}={url_pointing_to_localhost_with_compose_port}
```

**Constraint**: Do NOT hardcode connection URLs in application code. Use environment variables with `@connection` annotation.

---

## Infrastructure Services (Observe Design Document)

| Checkpoint | Observation Target |
|------------|-------------------|
| **External services** | Does the design document specify services that require a running server process? |

**If external services observed** (database, Redis, message queue, etc.):

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
- `.env.example` MUST use `# @connection {category} {name}` annotation for every service connection variable.

**Blind spot reminder — include these when creating files:**
- `dev-infra` / `dev-infra-down` Makefile targets are EASILY FORGOTTEN. Include them when creating the Makefile.
- `@connection` annotations in `.env.example` are EASILY FORGOTTEN. Include annotation for every connection variable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**COMMON MISTAKES:**

❌ Putting application code (handlers, services) in setup task
❌ Forgetting `cmd/` entry point directory
❌ Using `pkg/` for private application code (use `internal/` instead)
❌ Hardcoding ports or connection strings instead of using environment variables
❌ Forgetting Makefile targets for infrastructure services
❌ Setting `container_name` in docker-compose.yml (breaks platform namespace isolation, causes conflicts)
❌ MSA: Forgetting `go.work` at the root (services cannot resolve cross-module imports)
❌ MSA: Creating `docker-compose.yml` inside service directories (root only)
❌ MSA: Putting shared infrastructure connections in per-service `.env.example` instead of root (causes duplication)
❌ MSA: Using a single `go.mod` for all services (each service needs its own module)
❌ MSA: Adding `require` for a sibling module without a `replace` directive (build fails with "module not found")
❌ MSA: Mismatched `go` version between `go.work` and `go.mod` files (causes toolchain resolution failure)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
