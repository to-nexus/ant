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
├── cmd/server/           # Entry point (main.go)
├── internal/             # Private application code (sub-packages per design doc)
├── go.mod
├── go.sum
├── Makefile
├── .gitignore
├── .env.example          # Environment config (default)
└── config.example.toml   # TOML config (alternative, when design specifies TOML)
```

**Principle**: `internal/` enforces Go's built-in access control — packages under `internal/` cannot be imported by external modules. Use this for application-specific code.

**Principle**: `cmd/{name}/` is the standard entry point convention. Each subdirectory contains a `main.go` that wires dependencies and starts the application.

**Principle**: Sub-package structure within `internal/` is determined by the architecture boundaries specified in the design document. Do NOT assume a fixed set of sub-directories — observe the design document's architecture layers and map each boundary to a package under `internal/`.

**Constraint**: If design document specifies architecture boundaries, each boundary MUST correspond to a directory under `internal/`. If no boundaries are specified, use a flat structure under `internal/` until complexity demands separation.

**Multi-service (MSA — when multiple backend design documents exist):**
```
codebase/
├── go.work                     # Go workspace declaration
├── shared/                     # Shared library module (if cross-service types exist)
│   └── go.mod
├── services/
│   ├── {svc-a}/
│   │   ├── go.mod              # Independent module
│   │   ├── cmd/server/         # Entry point (main.go)
│   │   ├── internal/           # Private application code (per design doc)
│   │   ├── Makefile
│   │   ├── .env.example
│   │   └── .env
│   └── {svc-b}/
│       └── ...                 # Same structure as svc-a
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
- If the task description requires declaring dependencies, list them in the `require` block — but only if you know the exact version. For dependencies with unknown versions, use `go get package@latest` to resolve them (see Dependency Classification below)
- The `go` version directive in `go.work` and every `go.mod` MUST be identical. A mismatch causes toolchain resolution failures that are invisible until build time

### Dependency Classification Protocol

For each dependency, two decisions must be made in order: (1) local vs external, (2) version.

#### Step 1 — Local or External?

| Module physically present in workspace? | `replace` directive |
|-----------------------------------------|---------------------|
| **YES** — listed in `go.work` or confirmed as sibling directory | REQUIRED — relative path to local directory |
| **NO** — not in workspace filesystem | FORBIDDEN — do NOT add |

**Constraints**:
- Do NOT infer workspace-local status from module path prefix, organization name, or terminology in the design document ("shared packages", "common libraries", "internal packages"). A module is workspace-local ONLY if its source directory is physically present in this workspace.
- A `replace` directive pointing to a non-existent directory always causes build failure. If the target directory does not exist, the module is external.

⚠️ **Blind spot**: Packages published by the same organization (e.g., `github.com/{org}/other-repo`) are easily confused with workspace-local sibling modules. They are external dependencies — treat them identically to any third-party package unless their source directory is confirmed present.

#### Step 2 — Version in `require`

| Category | Version known? | Action |
|----------|---------------|--------|
| **Workspace-local** (Step 1 = YES) | N/A | `v0.0.0` (Go workspace resolves locally) |
| **External** — version in design doc or LLM training data | YES | Exact version (e.g., `v1.10.1`) |
| **External** — version unknown | NO | Run `go get package@latest` via `run_command` |

**Principle**: Go `go.mod` does not support `latest` or `*`. The ONLY valid version is an exact semver tag. `go get package@latest` resolves the module's latest published version, downloads the source, and updates `go.mod` + `go.sum` automatically.

**Constraint**: `v0.0.0` in `require` is reserved exclusively for workspace-local modules (where `go.work` or `replace` resolves the path locally). Using `v0.0.0` for an external module locks it to the oldest tag — `go mod tidy` does NOT upgrade existing versions.

⚠️ **Blind spot**: The workspace-local example (`v0.0.0` + `replace`) is easily copied for external packages. External packages have no `replace`, so `v0.0.0` is fetched literally and never upgraded.

#### Setup Command Restriction

**⛔ Do NOT run bulk dependency commands during setup:**
- `go mod tidy` — scans imports → finds none (no `.go` files yet) → **deletes all require entries**
- `go mod download` — with an empty require block → "no module dependencies to download"
- `go get ./...` — resolves package imports → finds none → "matched no packages"

**✅ ALLOWED exceptions** (targeted, per-package commands — always use `working_directory: "codebase"`):

| Command | Purpose | When to use |
|---------|---------|-------------|
| `go get package@latest` | Resolve unknown version + download source + update `go.mod` | External dependency with unknown version (Step 2 above) |
| `go doc -all package` | Read exported API signatures (read-only, no side effects) | Unfamiliar package — need to understand available functions/types before writing code |
| `go doc package.TypeOrFunc` | Read specific type/function documentation | `go doc -all` output was truncated — narrow the scope and re-query |

**Principle**: `go get package@latest` and `go doc` operate on a single named package. They do not scan `.go` files, so they are safe to run before source code exists.

**Constraints**:
- All `go` commands MUST use `working_directory: "codebase"`. The default working directory is the feature root (parent of `codebase/`), where no `go.mod` exists. Do NOT use `cd codebase &&` — use the `working_directory` parameter.
- `go get` requires `go.mod` to exist in `codebase/`. Create `go.mod` first (via `<file>` tag), THEN run `go get` for packages with unknown versions.

#### Design-Prescribed Dependency API Discovery

**Principle**: If the design document specifies a dependency, the execution environment is expected to have the necessary access credentials. A package appearing in the design document is evidence that the user has — or intends to have — access to it. Do NOT preemptively assume authentication will fail.

**Constraint**: For EVERY external dependency with an unknown version — including private or organization-scoped packages — you MUST attempt `go get package@latest`. Do NOT skip based on assumptions about package accessibility, authentication requirements, or registry configuration. Observe the actual result.

**Protocol** (via `run_command` with `working_directory: "codebase"`):

1. Create `go.mod` via `<file>` tag with ONLY packages whose version you know (from training data or design doc). Do NOT include packages with unknown versions — `go get` will add them with the correct version automatically.
2. For each package with an unknown version:
   a. **Observe**: Search the design document for the literal import path — look for `import "github.com/..."` statements or backtick-quoted module paths in usage examples.
   b. **Extract**: Quote the observed import path verbatim. If the import contains subpackages (e.g., `github.com/org/lib/sub/pkg`), the base Go module is the path up to the repository name (e.g., `github.com/org/lib`).
   c. **Execute**: Run `go get {extracted-base-module}@latest` — one package per command. A single unresolvable entry poisons subsequent calls if batched.

   **Constraint**: Do NOT infer or reconstruct module paths from project names, organization names, or reference project names. The module path MUST come from a literal import or module declaration observed in the design document or task description.
3. `go doc package` — package overview with one-line summary of each exported symbol (index)
4. `go doc package.TypeName` — drill into specific types referenced by the design document or needed for the task
5. `go doc package.TypeName.Method` — drill into specific methods when signatures are needed
6. Repeat steps 4-5 for each type/function you need until you have sufficient API knowledge to write correct code

**Constraint**: Do NOT start with `go doc -all` — it outputs the entire package documentation and is easily truncated. Start with the package index (step 3) and drill into specific symbols.

**Constraint — go get failure terminal state**: If `go get` fails (authentication error, module not found, network issue):
1. Report the failure to the user: which package, the error message, likely cause, suggested resolution
2. Do NOT manually add the package to `go.mod` with any version (`v0.0.0`, pseudo-versions, placeholders). Go requires an exact resolvable semver — manual insertion causes cascading build failures.
3. Do NOT make further attempts to include the package (no `edit_file` on `go.mod`, no alternative `go get` with guessed paths)
4. Complete the remaining config files normally and output `<done>true</done>`. The setup task is NOT blocked by an unresolvable dependency.
5. Feature tasks will still write `import` statements for the package — the dependency intent is preserved in code even though `go.mod` cannot list it yet.

⚠️ **Blind spot — pre-failure**: Private or organization-scoped packages are easily skipped with the assumption "this will fail without auth." The execution environment often has credentials pre-configured (GOPRIVATE, GOAUTH, netrc, git credential helpers). Always attempt first — only report failure after an actual failed attempt.

⚠️ **Blind spot — post-failure spiraling**: After `go get` fails, the instinct to "fix" `go.mod` by manually inserting the package with an invented version creates a worse problem than leaving it out. Every manual insertion (`v0.0.0`, `v0.0.0-latest`, etc.) poisons subsequent `go get` calls for other packages and triggers a cascade of fix attempts. The correct terminal state is: report → stop → continue with other files.

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

**Constraints**:
- `run` target MUST use `go run ./cmd/...` — NOT a pre-built binary path. The `build` target produces binaries for deployment; the `run` target compiles and executes in one step for development.
- `make run` must be the standard way to start the dev server. Adjust the entry point path in `build` and `run` targets to match `cmd/` structure.

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

**Constraints**:
- In MSA, `make run-{svc}` at the root must start a specific service. Each service Makefile must be self-contained with `build`, `run`, `test`, `clean` targets.
- Each service `run` target MUST use `go run ./cmd/...` — NOT a pre-built binary path. Parallel setup tasks generate Makefiles independently; `go run` ensures consistent behavior without requiring a prior `build` step.

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

## 4b. config.example.toml AND config.toml (TOML Alternative)

**Principle**: Go projects MAY use `config.example.toml` instead of (or alongside) `.env.example` for service connections when the design document specifies TOML-based configuration (e.g., using viper or koanf).

**Constraint**: If using `config.example.toml`, ALWAYS also create `config.toml` with the same structure and localhost default values. Add `config.toml` to `.gitignore`.

**Constraint**: TOML annotations require `env:VAR_NAME` — the environment variable the platform injects at runtime. This is REQUIRED because TOML keys (e.g., `database.url`) don't map to flat env var names.

```toml
# Plain configuration (no annotation)
[server]
port = 8080
env = "development"

# @connection infrastructure postgres env:DATABASE_URL
[database]
url = "postgresql://localhost:5432/mydb"

# @connection infrastructure redis env:REDIS_URL
[cache]
url = "redis://localhost:6379/0"

# @connection business backend-api self env:API_BASE_URL
[api]
base_url = ""
```

**Constraint**: The Go application MUST bind TOML keys to env vars so that platform-injected values override file defaults:

```go
viper.SetConfigName("config")
viper.SetConfigType("toml")
viper.AddConfigPath(".")
viper.AutomaticEnv()
// Or explicit binding:
viper.BindEnv("database.url", "DATABASE_URL")
```

**Constraint**: Do NOT declare the same connection in both `.env.example` and `config.example.toml`. Choose one format per project.

**Blind spot**: `env:VAR_NAME` in TOML annotations is EASILY FORGOTTEN. Every `@connection` line in `config.example.toml` MUST include `env:VAR_NAME` as the last token.

**Blind spot**: `config.toml` is EASILY FORGOTTEN when `config.example.toml` is created. Both files MUST be created together with identical structure.

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
❌ MSA: Adding `require` for a workspace-local sibling module without a `replace` directive (build fails with "module not found")
❌ Adding `replace` for modules not physically present in this workspace (same-org packages are external dependencies, not workspace siblings — `replace` to a non-existent path causes build failure)
❌ Using `v0.0.0` for external packages whose version is unknown (locks to oldest tag; `go mod tidy` never upgrades — use `go get package@latest` to resolve the real version)
❌ Guessing function names or type signatures for unfamiliar packages (use `go doc` to observe the actual API first)
❌ Skipping `go get` for private/organization packages based on assumptions about authentication (always attempt — the environment may have credentials configured)
❌ Running `go get` before `go.mod` exists (create `go.mod` first, then resolve unknown versions)
❌ Running `go` commands without `working_directory: "codebase"` (default cwd is feature root, not codebase — `go.mod` not found)
❌ Using `cd codebase &&` in commands instead of the `working_directory` parameter
❌ MSA: Mismatched `go` version between `go.work` and `go.mod` files (causes toolchain resolution failure)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
