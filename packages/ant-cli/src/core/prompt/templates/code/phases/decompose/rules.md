OUTPUT FORMAT:

{{> code/base/injections/text-format-compact}}

**Text Formatting Rules:**
- Use inline code for file names, variables, and technical terms: `api.ts`, `BASE_URL`
- Write analysis in natural sentences without excessive line breaks
- Keep related information on the same line

First, analyze step by step (think through):
- Is this a new project or existing project?
  - If "EXISTING CODEBASE DETECTED" was shown above, it is an existing project
  - If existing project, do NOT create setup task (priority 100)
- Does it need setup/configuration tasks?
  - ONLY for NEW projects without any code
  - If ANY files exist, setup is already done
- What are the main features to implement?
- What is the optimal task breakdown?
- Does test-code apply? (setup task exists OR codebase has test files → MUST include test-code tasks)
- Does doc apply? (setup task exists OR 3+ feature tasks → MUST include doc tasks)

Then output the results in order: `<profile>`, `<tasks>`, `<references>`, `<prescribedDependencies>`.

---

## Task Schema

Each task object MUST follow this schema:

<tasks>
[
  {
    "id": "kebab-case-id",
    "name": "Human-readable task name",
    "type": "setup" | "feature" | "design-system" | "ui" | "test-code" | "doc" | "error",
    "priority": 100,
    "packages": ["<tier>-<name>"],
    "exclusive": true,
    "description": "What to do"
  },
  {
    "id": "another-task",
    "name": "Another Task",
    "type": "feature",
    "priority": 300,
    "packages": ["<tier>-<name>"],
    "parallelGroup": "scope-id",
    "description": "What to do"
  }
]
</tasks>

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique kebab-case identifier |
| `name` | Yes | Human-readable task name |
| `type` | Yes | `"setup"`, `"feature"`, `"design-system"`, `"ui"`, `"test-code"`, `"doc"`, `"error"`, or `"verification"` |
| `priority` | Yes | 100–189: setup, 200–299: feature or design-system (shared foundation / design-system token infra + wiring), 300–649: feature, 650–699: ui, 700: test-code, 800: doc, 900–980: error, 1000: verification |
| `packages` | Yes | Which design documents to inject (see Package Tags below) |
| `exclusive` | Conditional | `true` if task must run alone. Determined by `type` and structural role — never by task name or description |
| `parallelGroup` | Conditional | Group ID for serialization. Tasks with different IDs can run in parallel. Mutually exclusive with `exclusive` |
| `uiSections` | When type is 'ui' or 'design-system' | Array of UI doc section IDs to inject (see specification for available sections) |
| `description` | Yes | Scope boundary + design doc section reference |

CRITICAL:
- The JSON inside `<tasks>` tags MUST be valid JSON (no trailing commas, proper quotes)
- Use `<tasks>` wrapper so the JSON can be reliably extracted

---

## Task Type Rules

**Principle**: `type` is determined by whether the directive describes broken behavior, new capability, or visual implementation.

| Type | Principle | When to use |
|------|-----------|-------------|
| `"error"` | Something is **broken** | Directive contains error messages, crashes, build failures, or runtime exceptions |
| `"feature"` | Something **new** — headless | Source code, logic, APIs. Always unstyled structure (skeleton only) |
| `"setup"` | Project **initialization** | New project infrastructure and configuration (generate mode only) |
| `"design-system"` | Visual **infrastructure** | ui-doc exists: 200 = token → CSS infrastructure (token variables, runtime import); 201+ = shared UI components + framework wiring (import chain, framework bridge, component library). Both share `parallelGroup: "design-system"` for serial ordering. |
| `"ui"` | Visual **implementation** | Apply styles to skeleton. Always created, even without ui-doc (priority 650–699) |

**Constraint**: If the directive contains ANY error message, stack trace, or crash report, the task type MUST be `"error"`.

**Constraint**: Default to `"feature"` when ambiguous (e.g., "fix" without a clear error/crash).

**Constraint**: `"feature"` tasks are ALWAYS headless — unstyled structure only. A corresponding `"ui"` task handles visual styling.

**Constraint**: `"design-system"` at priority 200–299 covers visual infrastructure only: framework wiring (import chain, framework bridge) AND shared UI component development (reusable component library from ui-spec). Entity models, API clients, ports, and shared domain logic are `"feature"` type — NEVER `"design-system"`. If there is no design system to wire or build, priority 200–299 tasks are always `"feature"`.

**Constraint**: `"design-system"` at priority 200–299 description MUST NOT enumerate specific component names (e.g., "Button, Input, Modal, Toast"). The executor observes ui-spec at runtime to determine which shared components to create. Description should define SCOPE (e.g., "shared component library from ui-spec observation") not a component inventory.

**Blind spot**: First-time build failures ARE errors. A crash does not require "it worked before" to qualify as `"error"`.

---

## Verification Task

**Principle**: A verification task (`type: "verification"`, priority 1000) validates the entire project by running build and startup commands. It verifies ONLY that the integrated result builds and runs without errors.

**Constraint**: The verification task fixes build and runtime errors ONLY. It MUST NOT review, add, complete, or improve feature implementations. Feature completeness is the responsibility of individual feature tasks.

**Constraint**: Include verification task if there are any feature tasks. Skip ONLY if ALL tasks are error tasks.

---

## Test Generation Task

**Principle**: A test generation task (`type: "test-code"`, priority 700) creates or updates tests that verify implemented functionality. It runs after all feature and integration tasks, before documentation and verification.

**Observation target**: Does the task set require test generation?

| Checkpoint | Condition |
|-----------|-----------|
| **Existing test files observed in codebase** | Project maintains test coverage — test-code needed to cover new features |
| **Setup task exists** | New project — test-code needed for initial coverage |
| **No existing tests, no setup** | No established testing pattern — skip test-code |

**Constraint**: When a setup task exists, test-code task(s) are MANDATORY — do NOT omit. When the codebase has existing test files, test-code task(s) are MANDATORY — do NOT omit.

**Constraint**: Do NOT skip test-code solely based on feature task count. When the codebase already maintains tests, any feature addition warrants test updates to maintain coverage.

**Constraint**: Do NOT create a test-code task when no feature tasks exist (error-only jobs).

⚠️ **Blind spot**: An existing codebase with test files indicates a testing practice that must be maintained. Adding functionality without updating tests breaks coverage consistency — easily missed when the feature count is small.

**Constraint**: The test-code task writes test files ONLY. It does NOT execute tests — verification handles that.

**Constraint**: Description references the implemented features by scope (not by file path). The executor observes actual code to determine test targets.

### Per-Package Test Splitting

**Observation target**: Does the project contain multiple independently buildable packages or services?

| Checkpoint | Strategy |
|-----------|----------|
| **Multiple packages/services observed** | Create one test-code task per package (same priority, distinct `parallelGroup` per package). Each task targets a single package scope. |
| **Single package** | Create one test-code task (`exclusive: true`). |

**Principle**: Each test-code task operates on a single package boundary. This keeps test context scoped and prevents token growth proportional to total project size.

**Constraint**: Per-package test-code tasks target independent scopes — assign them the same priority and a **distinct `parallelGroup` per package** so they can run in parallel.

⚠️ **Blind spot**: Same `parallelGroup` = serialized (cannot run simultaneously). Distinct `parallelGroup` = parallel. Per-package test-code tasks modify independent directories — they MUST have different group IDs.

**Constraint**: Each per-package test-code task MUST specify its target package in the `packages` field. The description states the package scope — the executor observes actual code within that scope to determine test targets.

**Constraint**: Do NOT create a single test-code task that spans all packages in a multi-package project.

---

## Documentation Task

**Principle**: A documentation task (`type: "doc"`, priority 800) generates or updates project documentation after all feature and test generation tasks complete, observing the complete codebase.

**Observation target**: Does this task set require documentation?

| Checkpoint | Condition |
|-----------|-----------|
| **Setup task exists** | New project — documentation needed |
| **3+ feature tasks with structural changes** | Substantial additions — documentation needed |
| **Neither** | Simple fix or minor change — skip documentation |

**Constraint**: When a setup task exists, doc task(s) are MANDATORY — do NOT omit. When 3+ feature tasks with structural changes exist, doc task(s) are MANDATORY — do NOT omit.

### Per-Package Doc Splitting

**Observation target**: Does the project contain multiple independently buildable packages or services?

| Checkpoint | Strategy |
|-----------|----------|
| **Multiple packages/services observed** | Create one root doc task (priority 800, `parallelGroup: "doc-root"`) for project-level documentation + one doc task per package (priority 800, distinct `parallelGroup` per package) for package-scoped documentation |
| **Single package** | Create one doc task (priority 800, `parallelGroup: "doc-root"`) covering all documentation |

**Principle**: Root documentation task covers project-wide scope (root operational docs + architecture documentation). Each package documentation task covers only that package's operational docs. This separation keeps context scoped per task and prevents token growth proportional to total project size.

**Principle**: All doc tasks are non-exclusive and use distinct `parallelGroup` values. They write to independent directory scopes, so they can run fully in parallel after the doc barrier clears.

⚠️ **Blind spot**: Doc tasks with the SAME `parallelGroup` are serialized. Each doc task (root and every package) MUST have a DIFFERENT `parallelGroup`.

**Constraint**: Description defines the SCOPE of documentation (which packages/files to document and whether new or update), NOT content placement. Do NOT instruct where specific content types should be written — content placement is governed by the docgen template rules.

**Constraint**: Description MUST state whether this is "new project documentation" or "update existing documentation for [scope of changes]". Package-level descriptions MUST identify the target package scope.

**Constraint**: `packages` field of each doc task should cover the tier(s) that task documents. Root doc uses all relevant tiers. Package doc uses only its package's tier tag.

---

## Dependencies Management

**Preferred:** Include all known dependencies in Setup Task (priority 100).
**Allowed:** Feature tasks CAN add dependencies if absolutely necessary.

**Dependency Version Consistency (Monorepo/MSA):**

**Principle**: When multiple packages share the same dependency, the version MUST be
decided once and referenced consistently.

**Observation target**: Does the project have multiple packages/services that use
overlapping dependencies?

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared libraries** | Are there libraries used by 2+ packages? |
| **Version source** | Which Setup task defines the canonical version? |

**Constraint**: If a library appears in multiple packages, its version MUST be specified
in the root Setup task description. Subsequent package-level Setup tasks MUST reference
the same version -- do NOT independently select versions.

**Constraint**: Do NOT mix deprecated and current versions of the same library
across packages.

**Blind spot**: Package-level Setup tasks are generated independently.
Without explicit version specification in root Setup, each may pick different versions
of the same dependency.

### Design-Document-Prescribed Package Paths

**Observation target**: Does the design document contain literal import paths or
module declarations for organization-internal or private packages?

**Constraint**: When the design document contains explicit import paths for packages
whose version is NOT known from public registries or training data, the Setup task
description MUST include the VERBATIM fully-qualified module path as it appears in
the design document. Do NOT abbreviate, paraphrase, or reconstruct the path.

**Constraint**: If the design document references subpackages of a single module
(e.g., `org/lib/sub-a`, `org/lib/sub-b`), the Setup description MUST include the
base module path that encompasses all subpackages — not each subpackage individually.

⚠️ **Blind spot**: Setup descriptions that mention only the short name or alias of
a private package (without the fully-qualified module path) force the Setup executor
to reconstruct the path — a frequent source of hallucinated module names. Include
the full path so the executor can copy it directly into the install command.

### Design-Prescribed Dependency Extraction

**Observation target**: Does the design document reference packages that are NOT part of the language standard library and NOT widely-known open-source packages? These are **design-prescribed dependencies** — packages the design document mandates for this project (organization-internal repos, private packages, project-specific libraries).

**Protocol**:
1. Scan the design document for import paths, module declarations, backtick-quoted package references, and section headings that name packages
2. For each design-prescribed dependency (not standard library, not widely-known open-source), include its fully-qualified import path in the `<prescribedDependencies>` output
3. If only a shorthand is given (e.g., `packages/router`), reconstruct the full import path from context (e.g., nearby full-path references, module path prefix, or org prefix in the design document)

**Constraint**: Include ONLY design-prescribed dependencies. Do NOT include well-known open-source packages or standard library packages.

**Constraint**: Output the fully-qualified import path (e.g., `github.com/org/repo/sub/pkg`), not shorthand.

**Constraint**: List each subpackage individually — the plan phase needs to know which specific subpackages to discover via tools.

**Constraint**: If no design-prescribed dependencies exist, output an empty array `[]`.

---

## UI Sections (split injection)

When `type` is `"ui"` or `"design-system"`, add `"uiSections": [...]` to specify which UI doc sections are needed. This enables split injection — only requested sections are loaded into the prompt.

- `"design-system"` tasks (priority 200, token infrastructure): `"uiSections": ["tokens"]` (always fixed)
- `"design-system"` tasks (priority 201+, wiring): `"uiSections": ["tokens", "<component-section>"]` (framework bridge, import chain, component library integration)
- `"ui"` tasks: `"uiSections": ["tokens", "<component-section>"]`
  If omitted, ALL UI docs are injected (not recommended for large docs).

{{#if hasUiDocs}}
**Constraint**: When ui-docs exist, create a `"design-system"` task (priority 200, `parallelGroup: "design-system"`) for token infrastructure. If the design system also requires framework-level wiring (import chain setup, component library integration into app shell), create a second `"design-system"` task (priority 201, `parallelGroup: "design-system"`) for wiring. The shared parallelGroup ensures token infra runs before wiring; both run in parallel with shared foundation tasks. Do NOT embed token setup in Setup or UI tasks.
{{else}}
**Constraint**: ui-docs not available → do NOT create `"design-system"` tasks.
`"ui"` tasks are still created — CSS framework + visual hints from system design provide styling guidance.
{{/if}}

---

## Package Tags (Split Design Doc Injection)

**Constraint**: Every task MUST have `"packages": [...]` to control which design documents are injected.

**Tag mapping:**

| Tag | Maps To | Description |
|-----|---------|-------------|
| `fe-main` | `fe-system-main.md` | Single frontend |
| `fe-{pkg}` | `fe-system-{pkg}.md` | Multi-package frontend |
| `be-main` | `be-system-main.md` | Single backend |
| `be-{svc}` | `be-system-{svc}.md` | MSA service |
| `shared` | api-contract-main.md only | Shared/utility (types, DTOs, configs) |

**Principle**: Tags always follow `{tier}-{name}` pattern. Single-package projects use `main` as the name.

- `api-contract-main.md` is ALWAYS injected when any package is specified.
- `shared` tag: only `api-contract-main.md` is injected (no system design doc).

**How to choose:**
- Task touches frontend code -> `fe-main` (or `fe-{pkg}` for monorepo)
- Task touches backend code -> `be-main` (or `be-{svc}` for MSA)
- Task touches shared/common code -> `shared`
- Task touches both tiers -> combine relevant `{tier}-{name}` tags
- Root workspace setup -> all tier tags in the project, combined with `"shared"`

⚠️ **Blind spot**: `shared` alone injects ONLY api-contract-main.md — no system design documents. Root setup and shared foundation tasks MUST combine all relevant tier tags. Without tier-specific system design documents, the plan phase cannot observe tech stack versions or infrastructure requirements.

---

## Task Scope Constraint

**WHY this matters**: A task with multiple persistence boundaries forces repeated interactions that replay the full conversation history, causing disproportionate token consumption. A task below one persistence boundary cannot be verified independently and wastes per-task overhead.

**Observation target**: Count the number of independent persistence boundaries in each task.

| Checkpoint | What to observe |
|-----------|----------------|
| **Persistence boundaries** | How many independent data access interfaces does this task require? |
| **Endpoint groups** | How many logically independent API endpoint groups does this task expose? |

**Constraint**: If a task requires MORE THAN ONE independent persistence boundary with its own business logic and API layer, split into separate tasks — one per boundary.

**Exception — shared implementation modules**: When multiple persistence boundaries will be implemented in the SAME output files (same handler, service, or repository file), merge them into a SINGLE task. A second task re-reading, extending, and fixing files the first task created multiplies token cost disproportionately.

**Constraint**: Cross-entity dependency via imported interface does NOT constitute shared implementation. If a service for boundary A calls a repository for boundary B through an interface defined by a shared foundation task, A and B produce separate output files — do NOT merge.

**Observation target**: For entities that appear separable by persistence boundary, check whether they share implementation modules.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared code files** | Will two entities be implemented in the same handler/service/repository files? |
| **Architecture grouping** | Does the project group by layer (handler/, service/, repository/) rather than by domain? |
| **Shared foundation coverage** | Does a shared foundation task (priority 200-299) define the cross-boundary types and interfaces? If yes, does file overlap persist even with shared definitions in place? |

**Constraint**: In layer-grouped architectures, entities in the same domain section share the same files per layer. Merge them into one task.

**Constraint**: Do NOT split below the persistence boundary level. An entity with its business logic and API layer is the minimum useful task unit. Splitting further (e.g., data access alone, business logic alone) creates tasks that cannot be verified independently and wastes per-task overhead.

⚠️ **Blind spot**: Entities with separate database tables appear independent, but in layer-grouped projects they produce OVERLAPPING implementation files. The second task must read, understand, and extend files the first task created — each interaction replays the full conversation, multiplying token cost. Observe the architecture pattern to decide split vs. merge.

⚠️ **Blind spot**: Entities in the same domain appear tightly coupled when one operation spans both persistence boundaries. Cross-entity transactions do NOT require shared output files when a shared foundation task provides the interfaces. Evaluate file overlap based on the output files each task PRODUCES — not on the interfaces each task IMPORTS.

---

## Feature Task Descriptions

**Principle**: Description defines the scope boundary — WHAT the task delivers, not HOW it implements. The Plan phase determines implementation details using available context (design documents, existing codebase, directive).

**Constraint**: Description states WHICH persistence boundary and WHICH endpoints/functionality the task covers. It does NOT state HOW they are implemented (method signatures, parameters, return types, error code strings, transaction steps).

**Constraint**: When design documents are available, reference the relevant sections. Do NOT duplicate content from those sections into the description.

**Constraint**: Do NOT include concrete file paths, directory names, or language-specific directory conventions in descriptions. Reference design document sections instead.

⚠️ **Blind spot**: Design documents use directory-like names (`app/`, `handlers/`, `internal/`) to describe architectural layers. Copying these into task descriptions creates a path specification that bypasses the Plan phase — where the language/framework profile determines actual filesystem paths. Use section references: "route definitions (fe-system §2.1)" not "route definitions in app/ directory".

**Blind spot**: Copying implementation details into descriptions — whether from design documents, PRD, or directive — creates a parallel specification. When parallel tasks reference the same copied details, they generate conflicting implementations. The description marks scope; the Plan phase extracts implementation details from available sources.

---

## UI Task Descriptions

**Principle**: Task descriptions for UI tasks should provide DIRECTION, not DETAILS. The Plan stage reads design documents to extract complete requirements.

**Constraint**: Do NOT enumerate specific components, counts, or layout details in the description. Use: `"<ui> Implement [section/area] based on design specifications"`.

**Constraint**: Do NOT create a separate task for copying assets. UI tasks handle asset integration as part of their implementation.

**Constraint**: `"feature"` tasks (frontend components) MUST always be headless — unstyled structure only. A corresponding `"ui"` task provides the visual pass.

---

## Shared Foundation Task

**Principle**: When parallel feature tasks will define symbols in the same language-level namespace scope, those shared symbols must be established before the parallel tasks execute. Without this, parallel tasks independently create conflicting definitions of the same symbol.

**Observation target**: Will 2+ parallel tasks define symbols in the same namespace scope?

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared infrastructure symbols** | Will 2+ parallel tasks need middleware types, error/response utilities, or shared definitions in the same namespace scope? |
| **Cross-cutting utilities** | Will 2+ parallel tasks define helper functions that serve the same purpose in the same namespace scope? |
| **Shared schema types** | Are there domain types (models, entities, response DTOs, input structs) referenced by 2+ feature tasks? |
| **Cross-boundary coordination** | Will 2+ feature tasks need atomic operations spanning multiple persistence boundaries? |

**Constraint**: If 2+ parallel feature tasks would define symbols in the same namespace scope, create dedicated foundation tasks (`type: "feature"`, priority 200-299, after setup, before regular features) following the Shared Foundation Splitting rules below. Foundation tasks complete before any feature task begins (enforced by a runtime barrier).

**Constraint**: This task defines types, interfaces, response DTOs, and shared utility functions ONLY. It does NOT implement business logic, API handlers, or data access queries.

**Constraint**: When the observation above identifies cross-boundary atomic coordination needs, the coordination contract is shared infrastructure — the foundation task MUST define it. Without this contract, feature tasks bypass shared interfaces and independently implement coordination logic, causing architectural inconsistency.

**Constraint**: The `packages` field MUST include all tier tags that parallel feature tasks span, combined with `"shared"`. `"shared"` alone provides only API contract — system design documents are required for the plan phase to identify infrastructure symbols. Always combine the relevant `{tier}-{name}` tags with `"shared"`.

**Constraint**: Feature tasks that depend on shared foundation symbols MUST NOT redefine them. They import and use what the shared foundation task established.

⚠️ **Blind spot**: Domain types are easily identified as shared, but response DTOs (enriched types that combine entity data with joined fields) and infrastructure symbols (middleware types, error/response helpers, context extractors) are EASILY LEFT to individual feature tasks — causing feature tasks to MODIFY shared files or create duplicate types. Cross-boundary coordination contracts (how atomic operations compose multiple persistence interfaces) are ESPECIALLY EASY TO OMIT — the foundation defines individual persistence interfaces but not how they compose atomically, forcing feature tasks to bypass those interfaces entirely. Additionally, if `packages` is set to `["shared"]` alone, the plan phase receives NO system design documents and cannot identify infrastructure patterns. Always combine tier tags with `"shared"`.

### Shared Foundation Splitting

#### Step 1: Split by concern group

**Observation target**: Does the shared foundation scope span more than one functional concern group?

| Group | Principle | Priority |
|-------|-----------|----------|
| **Declarations** | Symbols with no executable behavior (types, interfaces, constants, contracts) | 200 |
| **Schema** | Persistence structure definitions (not runtime code) | 201 |
| **Implementations** | Symbols with executable behavior (adapters, utilities, handlers) | 202 |

**Constraint**: If the shared foundation scope spans 2+ groups from the table above, split into sub-tasks at the listed priorities. Each sub-task follows all other shared foundation rules. Later sub-tasks may import from earlier ones.

⚠️ **Blind spot**: Persistence structure definitions (migrations, DDL scripts) appear to be "just files" and are easily merged into a declarations task. They are persistence structure — a separate concern from runtime type declarations. If both exist, split them.

#### Step 2: Split within a group by independent output scope

**Observation target**: For each concern group from Step 1, count the number of independent output directory scopes.

| Checkpoint | What to observe |
|-----------|----------------|
| **Independent directories** | Does the group span multiple distinct output directories that share no files? Count them: `domain/` = 1, `repository/` = 2, `adapter/` = 3, `cache/` = 4, `ws/` = 5, etc. |
| **Scope size** | Does the group define symbols across 3+ persistence boundaries or adapter types? |

**Constraint**: When a single concern group spans 3+ independent output directory scopes, it MUST be split into sub-tasks — one per scope cluster — at the SAME priority as the group. Each sub-task receives a distinct `parallelGroup` (NOT `exclusive`).

**Constraint**: Do NOT split a concern group into more than 4 sub-tasks. When many small scopes exist, cluster related scopes (e.g., all adapter and cache interfaces into one sub-task, all repository interfaces into another).

**Constraint**: Do NOT split below the output-directory level. A single directory scope is the minimum foundation sub-task unit.

⚠️ **Blind spot**: Declarations groups that define domain models + repository interfaces + adapter interfaces + cache interfaces span 4+ independent directories — this is ALWAYS above the 3-directory threshold and MUST be split. A single Declarations task covering ALL shared interfaces is the most common violation. Count the output directories before deciding.

#### Inter-group and intra-group ordering

**Principle**: Concern groups execute in priority order (Declarations 200 → Schema 201 → Implementations 202). Within each group, sub-tasks with different `parallelGroup` values execute in parallel.

**Constraint — Declarations/Implementations sub-tasks use parallelGroup, NOT exclusive**: Sub-tasks within the Declarations group or the Implementations group MUST have `parallelGroup` (NOT `exclusive: true`). Use naming convention `"sf-<group>-<scope>"` (e.g., `"sf-decl-domain"`, `"sf-decl-repo"`, `"sf-impl-cache"`, `"sf-impl-adapter"`). ONLY the Schema group sub-task uses `exclusive: true`.

**Constraint — inter-group barrier via Schema**: Between concern groups, the Schema group sub-task with `exclusive: true` naturally blocks until all Declarations sub-tasks complete, then blocks Implementations until Schema finishes. If Schema group does NOT exist: the first Implementations sub-task MUST be `exclusive: true` to serve as the inter-group barrier; remaining Implementations sub-tasks use `parallelGroup`.

⚠️ **Blind spot**: Defaulting to `exclusive: true` for ALL foundation sub-tasks eliminates parallelism entirely — this defeats the purpose of splitting. Only Schema needs `exclusive` (as a barrier). Declarations and Implementations sub-tasks MUST use `parallelGroup`.

---

## Setup & Task Structure

- Create setup task(s) ONLY for NEW projects (no existing codebase)
- Do NOT create setup task if fileList shows ANY files
- Do NOT create setup task to fix missing entry points (that is a feature task)
- Monorepo -> multiple setup tasks (root + each package), ascending priorities (100, 101, 102, ...)
- Monolithic -> single setup task
- Setup = infrastructure and configuration (dependency manifests, build tool config, environment files). Setup MUST NOT create application source code (handlers, services, business logic)
- Features = user-facing functionality (source code)
- Each task must have a unique id (kebab-case)

**Task Independence**: Each task creates its OWN files for its scope. Do NOT scaffold placeholder code for other tasks. Later tasks will add their own code and integrate.

### Setup Task Description Requirements

**Principle**: Setup tasks must produce a project the platform can start. The platform discovers dev commands from build tool config and detects service connections from `.env.example` annotations.

**Observation targets** — before writing setup task descriptions, observe the specification:

| Checkpoint | What to observe |
|-----------|----------------|
| **External services** | Does the specification mention databases, caches, queues, or other infrastructure requiring a runtime process? |
| **Service connections** | Are there connection URLs between the application and external services? |
| **Application configuration** | Does the specification mention secrets, API keys, or configuration that must be provided via environment variables? |

**Setup task description MUST mention (when applicable):**
- `docker-compose.yml` with **infrastructure** service definitions ONLY (databases, caches, message queues) — if external services are observed in the specification. Do NOT include application/business services (API servers, web servers) in docker-compose — the platform manages application process lifecycle separately.
- `.env.example` / `.env` with `# @connection {category} {name}` annotation for connection endpoint URLs — the platform runtime contract defines placement (root for shared infrastructure, per-service for service-specific configuration)
- Application configuration variables (secrets, API keys) observed in the specification — mention their purpose so the setup task provisions them
- Cross-project connections with `# @connection {category} {name} ant-project:{projectId}:{feature}[:{serviceName}]` — if the specification names a specific external Ant project as a dependency (e.g., "uses sketch-be as backend"). The optional `:{serviceName}` suffix targets a specific service within a multi-package project

**Constraint**: Task descriptions describe INTENT and SCOPE, not implementation-specific variable names or default values. Port binding, environment variable naming, and configuration structure are governed by the platform runtime contract and language-specific setup templates. Do NOT invent or prescribe specific variable names in task descriptions.

**Constraint**: Do NOT omit infrastructure provisioning (`docker-compose.yml`) from setup task when the specification mentions external services. Do NOT omit `@connection` annotations — they are required for the platform to detect and manage service connections. Do NOT omit `ant-project:{projectId}:{feature}[:{serviceName}]` modifier when the specification explicitly names a target project — without it, the platform cannot auto-resolve the cross-project proxy path.

**Blind spot**: `docker-compose.yml` is EASILY FORGOTTEN when specification mentions only service names (e.g., "PostgreSQL", "Redis") without an explicit infrastructure section. `@connection` annotations are EASILY FORGOTTEN. The `ant-project:{projectId}:{feature}[:{serviceName}]` modifier for cross-project dependencies is EASILY FORGOTTEN when the specification mentions another project by name. `.env` is EASILY FORGOTTEN when `.env.example` is mentioned — both MUST appear together. Application configuration variables (secrets, API keys) are EASILY LEFT TO FEATURE TASKS — listing them in setup prevents variable name inconsistency across tasks. Verify all are included.

---

## Parallel Execution

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** -- Task MUST run alone. Determine by observing the task's `type` and structural role:
- `type: "setup"` (root, priority 100) -> `exclusive: true`
- `type: "setup"` (package-level, priority 101+) -> `exclusive: false`, distinct `parallelGroup` per package
- `type: "design-system"` (priority 200, token infra) -> `exclusive: false`, `parallelGroup: "design-system"`
- `type: "design-system"` (priority 201+, wiring) -> `exclusive: false`, `parallelGroup: "design-system"` (shared group serializes token→wiring; foundation barrier ensures 300+ tasks wait)
- `type: "feature"` (priority 200–299 shared foundation) -> `parallelGroup` (foundation barrier ensures 300+ tasks wait; Schema sub-task is `exclusive`)
- `type: "ui"` (priority 650–699) -> `parallelGroup` (group with corresponding skeleton task)
- `type: "error"` -> always exclusive
- `type: "verification"` -> always exclusive
- `type: "test-code"` (single package) -> exclusive
- `type: "test-code"` (multiple packages) -> distinct `parallelGroup` per package
- `type: "doc"` -> always `exclusive: false`, distinct `parallelGroup` per task (root and each package)
- **Shared foundation** (priority 200-299) -> see "Shared Foundation Splitting" section for `exclusive` vs `parallelGroup` rules. Schema sub-tasks are exclusive (inter-group barrier); other sub-tasks within the same concern group use distinct `parallelGroup` values.

**Constraint**: Root setup (priority 100) establishes workspace configuration that subsequent tasks depend on — it MUST be exclusive. Package-level setup tasks (priority 101+) operate on independent directory scopes — assign `exclusive: false` with a distinct `parallelGroup` per package.

**Constraint**: Shared foundation tasks (priority 200-299) always complete before any feature task (priority 300+) begins — enforced by a runtime barrier. Within the foundation, inter-group ordering uses an `exclusive` Schema sub-task as a barrier; intra-group parallelism uses distinct `parallelGroup` values. ONLY the Schema sub-task is `exclusive`; Declarations and Implementations sub-tasks MUST use `parallelGroup`.

⚠️ **Blind spot**: Setting ALL foundation sub-tasks to `exclusive: true` is a common mistake. This eliminates all parallelism within the foundation and makes execution very slow. Only Schema needs `exclusive` — verify that Declarations and Implementations sub-tasks use `parallelGroup`.

⚠️ **Blind spot**: Package-level setup tasks with the SAME `parallelGroup` are serialized. Each package-level setup MUST have a DIFFERENT `parallelGroup`.

⚠️ **CONSTRAINT**: Do NOT infer `exclusive` from task name or description content.

**`parallelGroup: "<group-id>"`** -- Tasks with the SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

**Principle**: Maximize parallelism by assigning different group IDs to tasks that modify independent scopes (different directories, different modules, different layers).

**Constraint**: Only assign the SAME group ID when tasks are likely to modify the SAME source files.

**Observation target**: For each pair of feature tasks, check if they share a persistence boundary.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared persistence boundary** | Do two tasks read/write the same database table, collection, or data store? |
| **Shared data-access module** | Will two tasks need to add operations to the same repository or data-access layer? |

**Constraint**: Tasks that access the SAME persistence boundary MUST share the same parallelGroup -- even if they expose different API endpoints or serve different features. In layered architectures, one persistence boundary maps to one data-access module; concurrent writes to that module cause conflicts.

**Constraint**: If tasks share a namespace scope but NO shared foundation task (see Shared Foundation Task section) covers that namespace, they MUST share the same parallelGroup.

⚠️ **Blind spot**: Tasks that appear logically independent (different features, different endpoints) may share the same underlying persistence boundary. Task names suggest independence but the data layer reveals coupling. Observe the design document's schema section to determine overlap.

**Observation target**: For each pair of feature tasks in DIFFERENT parallel groups, check if they will create or modify any shared utility, helper, or infrastructure module.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared infrastructure module** | Will two tasks both need to create the same helper file, adapter implementation, or utility module? |
| **Shared data-access implementation** | Will two tasks both need to create the same repository implementation file (not just interface)? |

**Constraint**: Tasks that will CREATE the same source file MUST share the same parallelGroup. A cross-worker file conflict occurs when two parallel tasks attempt to create an identical file path — the second task's write is rejected, triggering an unresolvable retry loop.

⚠️ **Blind spot**: Shared infrastructure files are EASILY MISSED during decomposition. When a design specifies common patterns (event deduplication, caching, message queue adapters, response formatters), multiple feature tasks may independently need to create the same implementation file. If two feature tasks reference the same internal module that does not yet exist, they MUST be in the same parallelGroup OR a shared foundation task must create the module first.

**Naming convention**: `"<package>-<scope>"` where scope is the functional area within the package.

---

## Shared Integration Points

**Principle**: When multiple parallel tasks produce components that must be registered in a shared integration point (application entry point, route registry, dependency wiring), a dedicated integration task must consolidate them. This is divide-and-conquer: integration itself is a task.

**Observation target**: Does the project have a single entry point that must import and wire components from multiple feature tasks?

| Checkpoint | What to observe |
|-----------|----------------|
| **Entry point** | Will multiple feature tasks produce handlers, routes, or modules that must be registered in one place? |
| **Parallel conflict risk** | Are feature tasks in different `parallelGroup` IDs, meaning they run concurrently and cannot see each other's outputs? |

**Constraint**: If multiple parallel feature tasks produce components for a shared entry point, create a dedicated integration task:
- `type: "feature"`, `exclusive: true`, priority 600 (after all feature tasks, before test-code/doc/verification)
- Description: wire all feature outputs into the application entry point
- Feature tasks MUST NOT create or modify the entry point file themselves

**Constraint**: Do NOT assign entry point responsibility to setup tasks (setup does not know which features will be implemented) or to final verification (verification does not create functionality).

**Blind spot**: Entry point conflicts are EASILY CAUSED when parallel feature tasks independently create their own entry point files. If the project has 2+ parallel groups contributing to the same application, an integration task is almost certainly needed.

---

{{#if needsBoundaryClassification}}
## Boundary Classification

Observe the scope and complexity of the specification.
Classify this job's execution boundary:

- **heavyweight**: Multiple independent concerns where isolated task execution benefits quality
- **lightweight**: Cohesive work where preserving full context aids subsequent iterations

Output in `<boundary>` tags before `<tasks>`:
`<boundary>heavyweight</boundary>` or `<boundary>lightweight</boundary>`

Constraint: If uncertain, default to lightweight.
{{/if}}

## Output Sequence

Output in this exact order:

{{#if needsBoundaryClassification}}
**0. `<boundary>` tag** (see Boundary Classification above)

**1. `<profile>` tag** (project profile -- see Step 1 above):
{{else}}
**0. `<profile>` tag** (project profile -- see Step 1 above):
{{/if}}

<profile>
{
  "environment": "backend",
  "environmentReasoning": "Only be-system- documents present, no fe- documents",
  "language": "go",
  "framework": "gin"
}
</profile>

**{{#if needsBoundaryClassification}}2{{else}}1{{/if}}. `<tasks>` tag** (task array -- see Task Schema above)

**{{#if needsBoundaryClassification}}3{{else}}2{{/if}}. `<references>` tag** (REQUIRED, even if empty):

<references>
[]
</references>

**Constraint**: ALWAYS output `<references>` tag, even if the array is empty.

**Reference extraction**: If the directive mentions another project (by name, optionally with a branch or feature name), extract it as a reference object with `project` and optional `branch` fields. Feature names become `feature/{name}` branches.

**{{#if needsBoundaryClassification}}4{{else}}3{{/if}}. `<prescribedDependencies>` tag** (REQUIRED, even if empty):

<prescribedDependencies>
["github.com/org/repo/sub/pkg-a", "github.com/org/repo/sub/pkg-b"]
</prescribedDependencies>

**Constraint**: ALWAYS output `<prescribedDependencies>` tag, even if the array is empty. See "Design-Prescribed Dependency Extraction" section above for extraction rules.

**CRITICAL:**
- Use XML tags directly, NOT inside markdown code blocks
- NO ```xml or ``` markers
- Just raw XML tags with JSON content inside
