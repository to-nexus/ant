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
│   │   └── Makefile            # Service-level build targets
│   └── {svc-b}/
│       ├── go.mod
│       ├── cmd/server/
│       ├── internal/
│       └── Makefile
├── docker-compose.yml
├── Makefile                    # Root-level orchestration
├── .gitignore
└── .env.example
```

**Principle**: `go.work` declares all modules via `use` directives. Go 1.18+ workspace mode resolves cross-module imports locally without publishing modules.

**Principle**: Each service under `services/` is an independent Go module with its own `go.mod`. Module path follows `github.com/{org}/{project}/services/{svc}`.

**Principle**: The `shared/` module (if needed) contains cross-service types, DTOs, and utility packages. Module path: `github.com/{org}/{project}/shared`. Only create this when 2+ services share domain types.

**Constraint**: Root setup task (priority 100) creates `go.work`, root `Makefile`, `docker-compose.yml`, `.gitignore`, `.env.example`, and `.env`. Service-level setup tasks (priority 101, 102, ...) create `services/{svc}/go.mod` and `services/{svc}/Makefile`. Do NOT create `docker-compose.yml` or `.env.example` in service directories.

---

## 1. go.mod (and go.work for MSA)

**Single service:**
```
module github.com/{org}/{project}

go 1.22
```

**Multi-service — root `go.work`:**
```
go 1.22

use (
    ./shared
    ./services/{svc-a}
    ./services/{svc-b}
)
```

**Multi-service — each `services/{svc}/go.mod`:**
```
module github.com/{org}/{project}/services/{svc}

go 1.22

require (
    github.com/{org}/{project}/shared v0.0.0
)
```

**Multi-service — `shared/go.mod`:**
```
module github.com/{org}/{project}/shared

go 1.22
```

**Key points:**
- Module path should match the intended repository path
- Use the latest stable Go version unless design doc specifies otherwise
- If the task description requires declaring dependencies, list them in the `require` block
- In MSA, cross-module dependencies (e.g., service → shared) use `require` with `v0.0.0` — `go.work` resolves them locally

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

**Constraint**: `make run` must be the standard way to start the dev server. Adjust the binary path in `build` and `run` targets to match `cmd/` structure.

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
# @connection {category} {name} ant-project:{projectId}:{feature} -- cross-project
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
❌ MSA: Creating `docker-compose.yml` or `.env.example` inside service directories (root only)
❌ MSA: Using a single `go.mod` for all services (each service needs its own module)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
