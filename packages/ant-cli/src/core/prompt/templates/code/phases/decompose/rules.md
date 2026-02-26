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

Then output the results in order: `<profile>`, `<tasks>`, `<references>`.

---

## Task Schema

Each task object MUST follow this schema:

<tasks>
[
  {
    "id": "kebab-case-id",
    "name": "Human-readable task name",
    "type": "setup" | "feature" | "testgen" | "doc" | "error",
    "priority": 100,
    "packages": ["fe", "be-auth"],
    "exclusive": true,
    "ui": false,
    "description": "What to do"
  },
  {
    "id": "another-task",
    "name": "Another Task",
    "type": "feature",
    "priority": 300,
    "packages": ["be"],
    "parallelGroup": "scope-id",
    "ui": false,
    "description": "What to do"
  }
]
</tasks>

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique kebab-case identifier |
| `name` | Yes | Human-readable task name |
| `type` | Yes | `"setup"`, `"feature"`, `"testgen"`, `"doc"`, `"error"`, or `"verification"` |
| `priority` | Yes | 100: setup, 200: shared foundation, 300-500: feature, 600: integration, 700: testgen, 800: doc, 900-980: error, 1000: verification |
| `packages` | Yes | Which design documents to inject (see Package Tags below) |
| `exclusive` | Conditional | `true` if task must run alone. Determined by `type` and structural role — never by task name or description |
| `parallelGroup` | Conditional | Group ID for serialization. Tasks with different IDs can run in parallel. Mutually exclusive with `exclusive` |
| `ui` | Yes | `true` if task involves the visual presentation layer |
| `uiSections` | When ui=true | Array of UI doc section IDs to inject (see specification for available sections) |
  | `description` | Yes | Scope boundary + design doc section reference. Prefix with `<ui>` when `ui: true` |

CRITICAL:
- The JSON inside `<tasks>` tags MUST be valid JSON (no trailing commas, proper quotes)
- Use `<tasks>` wrapper so the JSON can be reliably extracted

---

## Task Type Rules

**Principle**: `type` is determined by whether the directive describes broken behavior or new capability.

| Type | Principle | When to use |
|------|-----------|-------------|
| `"error"` | Something is **broken** | Directive contains error messages, crashes, build failures, or runtime exceptions |
| `"feature"` | Something **new or improved** | Directive requests new functionality, optimization, or enhancement |
| `"setup"` | Project **initialization** | New project needs infrastructure and configuration (generate mode only) |

**Constraint**: If the directive contains ANY error message, stack trace, or crash report, the task type MUST be `"error"`.

**Constraint**: Default to `"feature"` when ambiguous (e.g., "fix" without a clear error/crash).

**Blind spot**: First-time build failures ARE errors. A crash does not require "it worked before" to qualify as `"error"`.

---

## Verification Task

**Principle**: A verification task (`type: "verification"`, priority 1000) validates the entire project by running build and startup commands. It verifies ONLY that the integrated result builds and runs without errors.

**Constraint**: The verification task fixes build and runtime errors ONLY. It MUST NOT review, add, complete, or improve feature implementations. Feature completeness is the responsibility of individual feature tasks.

**Constraint**: Include verification task if there are any feature tasks. Skip ONLY if ALL tasks are error tasks.

---

## Test Generation Task

**Principle**: A test generation task (`type: "testgen"`, priority 700) creates or updates tests that verify implemented functionality. It runs after all feature and integration tasks, before documentation and verification.

**Observation target**: Does the task set require test generation?

| Checkpoint | Condition |
|-----------|-----------|
| **Existing test files observed in codebase** | Project maintains test coverage — testgen needed to cover new features |
| **Setup task exists** | New project — testgen needed for initial coverage |
| **No existing tests, no setup** | No established testing pattern — skip testgen |

**Constraint**: Do NOT skip testgen solely based on feature task count. When the codebase already maintains tests, any feature addition warrants test updates to maintain coverage.

**Constraint**: Do NOT create a testgen task when no feature tasks exist (error-only jobs).

⚠️ **Blind spot**: An existing codebase with test files indicates a testing practice that must be maintained. Adding functionality without updating tests breaks coverage consistency — easily missed when the feature count is small.

**Constraint**: The testgen task writes test files ONLY. It does NOT execute tests — verification handles that.

**Constraint**: Description references the implemented features by scope (not by file path). The executor observes actual code to determine test targets.

### Per-Package Test Splitting

**Observation target**: Does the project contain multiple independently buildable packages or services?

| Checkpoint | Strategy |
|-----------|----------|
| **Multiple packages/services observed** | Create one testgen task per package (same priority, distinct `parallelGroup` per package). Each task targets a single package scope. |
| **Single package** | Create one testgen task (`exclusive: true`). |

**Principle**: Each testgen task operates on a single package boundary. This keeps test context scoped and prevents token growth proportional to total project size.

**Constraint**: Per-package testgen tasks target independent scopes — assign them the same priority and a **distinct `parallelGroup` per package** so they can run in parallel.

⚠️ **Blind spot**: Same `parallelGroup` = serialized (cannot run simultaneously). Distinct `parallelGroup` = parallel. Per-package testgen tasks modify independent directories — they MUST have different group IDs.

**Constraint**: Each per-package testgen task MUST specify its target package in the `packages` field. The description states the package scope — the executor observes actual code within that scope to determine test targets.

**Constraint**: Do NOT create a single testgen task that spans all packages in a multi-package project.

---

## Documentation Task

**Principle**: A documentation task (`type: "doc"`, priority 800) generates or updates project documentation after all feature and test generation tasks complete, observing the complete codebase.

**Observation target**: Does this task set require documentation?

| Checkpoint | Condition |
|-----------|-----------|
| **Setup task exists** | New project — documentation needed |
| **3+ feature tasks with structural changes** | Substantial additions — documentation needed |
| **Neither** | Simple fix or minor change — skip documentation |

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

---

## UI Flag

- Add `"ui": true|false` to EVERY task object.
{{#if hasUiDocs}}
- **Setup tasks**: Frontend app/package setup that needs design tokens -> `ui: true` with `uiSections: ["tokens"]`. Backend or root workspace setup -> `ui: false`.
{{else}}
- **Setup tasks** -> `ui: false` (no UI docs available)
{{/if}}

**Principle**: Set `"ui": true` when the task involves the visual presentation layer (components, layout, styling, theming, screen implementation). Otherwise `"ui": false`.

**Constraint**: When `"ui": true`, ALWAYS prefix the description with `<ui>`.

**UI Sections (split injection):**
When `"ui": true`, add `"uiSections": [...]` specifying which UI doc sections are needed. This enables split injection -- only requested sections are loaded into the prompt. Refer to the "Available UI Sections" in the specification above for valid section IDs. Always include `"tokens"` for UI tasks, then add sections relevant to the task scope. If `uiSections` is omitted, ALL UI docs are injected (not recommended for large docs).

---

## Package Tags (Split Design Doc Injection)

**Constraint**: Every task MUST have `"packages": [...]` to control which design documents are injected.

**Tag mapping:**

| Tag | Maps To | Description |
|-----|---------|-------------|
| `fe` | `fe-system-design-main.md` | Single frontend |
| `fe-{pkg}` | `fe-system-design-{pkg}.md` | Multi-package frontend |
| `be` | `be-system-design-main.md` | Single backend |
| `be-{svc}` | `be-system-design-{svc}.md` | MSA service |
| `shared` | api-contract-main.md only | Shared/utility (types, DTOs, configs) |

- `api-contract-main.md` is ALWAYS injected when any package is specified.
- `shared` tag: only `api-contract-main.md` is injected (no system design doc).

**How to choose:**
- Task touches frontend code -> `fe` (or `fe-{pkg}` for monorepo)
- Task touches backend code -> `be` (or `be-{svc}` for MSA)
- Task touches shared/common code -> `shared`
- Task touches both tiers -> combine (e.g., `["fe", "be"]`)
- Root workspace setup -> all tier tags in the project (e.g., `["shared", "be-api", "be-redirect"]`)

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

**Constraint**: Do NOT include concrete file paths, directory names, or language-specific directory conventions in descriptions.

**Blind spot**: Copying implementation details into descriptions — whether from design documents, PRD, or directive — creates a parallel specification. When parallel tasks reference the same copied details, they generate conflicting implementations. The description marks scope; the Plan phase extracts implementation details from available sources.

---

## UI Task Descriptions

**Principle**: Task descriptions for UI tasks should provide DIRECTION, not DETAILS. The Plan stage reads design documents to extract complete requirements.

**Constraint**: Do NOT enumerate specific components, counts, or layout details in the description. Use: `"<ui> Implement [section/area] based on design specifications"`.

**Constraint**: Do NOT create a separate task for copying assets. UI tasks handle asset integration as part of their implementation.

**Constraint**: Do NOT create a separate design tokens task. Include token configuration in the Setup task (new project) or the first UI task (existing project).

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

**Constraint**: If 2+ parallel feature tasks would define symbols in the same namespace scope, create a dedicated exclusive task (priority 200-299, after setup, before features) that defines ALL shared symbols for that scope.

**Constraint**: This task defines types, interfaces, response DTOs, and shared utility functions ONLY. It does NOT implement business logic, API handlers, or data access queries.

**Constraint**: When the observation above identifies cross-boundary atomic coordination needs, the coordination contract is shared infrastructure — the foundation task MUST define it. Without this contract, feature tasks bypass shared interfaces and independently implement coordination logic, causing architectural inconsistency.

**Constraint**: The `packages` field MUST include all tier tags that parallel feature tasks span, combined with `"shared"`. Example: if parallel tasks use `["be"]`, the foundation task uses `["shared", "be"]`. `"shared"` alone provides only API contract — system design documents are required for the plan phase to identify infrastructure symbols.

**Constraint**: Feature tasks that depend on shared foundation symbols MUST NOT redefine them. They import and use what the shared foundation task established.

⚠️ **Blind spot**: Domain types are easily identified as shared, but response DTOs (enriched types that combine entity data with joined fields) and infrastructure symbols (middleware types, error/response helpers, context extractors) are EASILY LEFT to individual feature tasks — causing feature tasks to MODIFY shared files or create duplicate types. Cross-boundary coordination contracts (how atomic operations compose multiple persistence interfaces) are ESPECIALLY EASY TO OMIT — the foundation defines individual persistence interfaces but not how they compose atomically, forcing feature tasks to bypass those interfaces entirely. Additionally, if `packages` is set to `["shared"]` alone, the plan phase receives NO system design documents and cannot identify infrastructure patterns. Always combine tier tags with `"shared"`.

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
- `type: "error"` -> always exclusive
- `type: "verification"` -> always exclusive
- `type: "testgen"` (single package) -> exclusive
- `type: "testgen"` (multiple packages) -> distinct `parallelGroup` per package
- `type: "doc"` -> always `exclusive: false`, distinct `parallelGroup` per task (root and each package)

**Constraint**: Root setup (priority 100) establishes workspace configuration that subsequent tasks depend on — it MUST be exclusive. Package-level setup tasks (priority 101+) operate on independent directory scopes — assign `exclusive: false` with a distinct `parallelGroup` per package.

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
- `type: "feature"`, `exclusive: true`, priority 600 (after all feature tasks, before testgen/doc/verification)
- Description: wire all feature outputs into the application entry point
- Feature tasks MUST NOT create or modify the entry point file themselves

**Constraint**: Do NOT assign entry point responsibility to setup tasks (setup does not know which features will be implemented) or to final verification (verification does not create functionality).

**Blind spot**: Entry point conflicts are EASILY CAUSED when parallel feature tasks independently create their own entry point files. If the project has 2+ parallel groups contributing to the same application, an integration task is almost certainly needed.

---

## Output Sequence

Output in this exact order:

**0. `<profile>` tag** (project profile -- see Step 1 above):

<profile>
{
  "environment": "backend",
  "environmentReasoning": "Only be-system-design documents present, no fe- documents",
  "language": "go",
  "framework": "gin"
}
</profile>

**1. `<tasks>` tag** (task array -- see Task Schema above)

**2. `<references>` tag** (REQUIRED, even if empty):

<references>
[]
</references>

**Constraint**: ALWAYS output `<references>` tag, even if the array is empty.

**Reference extraction**: If the directive mentions another project (by name, optionally with a branch or feature name), extract it as a reference object with `project` and optional `branch` fields. Feature names become `feature/{name}` branches.

**CRITICAL:**
- Use XML tags directly, NOT inside markdown code blocks
- NO ```xml or ``` markers
- Just raw XML tags with JSON content inside
