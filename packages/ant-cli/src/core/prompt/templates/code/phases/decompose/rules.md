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
    "type": "setup" | "feature" | "error",
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
    "priority": 200,
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
| `type` | Yes | `"setup"` (project config), `"feature"` (new capability), `"error"` (broken behavior fix), or `"verification"` (build & runtime check) |
| `priority` | Yes | 100: setup, 200-219: critical, 220-249: important, 250-899: nice-to-have, 1000: verification |
| `packages` | Yes | Which design documents to inject (see Package Tags below) |
| `exclusive` | Conditional | `true` if task must run alone. Determined ONLY by the task's `type` field and `priority` value — never by task name |
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
| `fe` | `fe-system-design.md` | Single frontend |
| `fe-{pkg}` | `fe-system-design-{pkg}.md` | Multi-package frontend |
| `be` | `be-system-design.md` | Single backend |
| `be-{svc}` | `be-system-design-{svc}.md` | MSA service |
| `shared` | api-contract.md only | Shared/utility (types, DTOs, configs) |

- `api-contract.md` is ALWAYS injected when any package is specified.
- `shared` tag: only `api-contract.md` is injected (no system design doc).

**How to choose:**
- Task touches frontend code -> `fe` (or `fe-{pkg}` for monorepo)
- Task touches backend code -> `be` (or `be-{svc}` for MSA)
- Task touches shared/common code -> `shared`
- Task touches both tiers -> combine (e.g., `["fe", "be"]`)
- Root workspace setup -> `["shared"]`

---

## Task Scope Constraint

**WHY this matters**: A task with multiple persistence boundaries forces repeated interactions that replay the full conversation history, causing disproportionate token consumption. A task below one persistence boundary cannot be verified independently and wastes per-task overhead.

**Observation target**: Count the number of independent persistence boundaries in each task.

| Checkpoint | What to observe |
|-----------|----------------|
| **Persistence boundaries** | How many independent data access interfaces does this task require? |
| **Endpoint groups** | How many logically independent API endpoint groups does this task expose? |

**Constraint**: If a task requires MORE THAN ONE independent persistence boundary with its own business logic and API layer, split into separate tasks — one per boundary.

**Constraint**: Entities that the design document groups in the same section but that have SEPARATE persistence boundaries MUST be separate tasks.

**Constraint**: Do NOT split below the persistence boundary level. An entity with its business logic and API layer is the minimum useful task unit. Splitting further (e.g., data access alone, business logic alone) creates tasks that cannot be verified independently and wastes per-task overhead.

**Blind spot**: Entities that reference each other are easily perceived as inseparable. The test is whether each has its own persistence boundary — if yes, they are independent and should be separate tasks.

⚠️ **Blind spot**: Entities with a parent-child or lifecycle relationship (e.g., "requests" that become "matches", "orders" that generate "invoices") appear tightly coupled but have INDEPENDENT persistence boundaries. The relationship between them is business logic, not a reason to merge tasks. Each entity with its own table/collection and API endpoints is a separate task.

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

## Shared Types Task

**Principle**: When parallel feature tasks will operate on entities defined in the same schema (database, API contract), the type definitions that multiple tasks depend on must be established before those tasks execute. Without this, parallel tasks independently create conflicting type definitions.

**Observation target**: Does the project have a shared type/model layer that multiple feature tasks will read or write?

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared schema** | Are there domain types (models, entities, DTOs) referenced by 2+ feature tasks? |
| **Parallel conflict risk** | Will 2+ parallel tasks need to define or extend types in the same package/module? |

**Constraint**: If 2+ parallel feature tasks depend on the same domain types, create a dedicated exclusive task (priority 150-199, after setup, before features) that defines ALL shared type definitions.

**Constraint**: This task defines types/interfaces ONLY. It does NOT implement business logic, API handlers, or data access.

**Constraint**: Feature tasks that depend on shared types MUST NOT redefine them. They import and use what the shared types task established.

⚠️ **Blind spot**: When a schema migration creates tables, the corresponding application-level type definitions are EASILY LEFT to individual feature tasks. If those feature tasks run in parallel, each creates its own version of the same type → compile errors. The shared types task prevents this.

---

## Setup & Task Structure

- Create setup task(s) ONLY for NEW projects (no existing codebase)
- Do NOT create setup task if fileList shows ANY files
- Do NOT create setup task to fix missing entry points (that is a feature task)
- Monorepo -> multiple setup tasks (root + each package), sequential priorities (100, 101, 102, ...)
- Monolithic -> single setup task
- Setup = infrastructure and configuration ONLY (dependency files, configs). Setup MUST NOT create application source code
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
- `docker-compose.yml` with service definitions — if external services are observed in the specification
- `.env.example` with `# @connection {category} {name}` annotation for each service connection endpoint URL (not individual components like host, port, user, password)
- `.env` with resolved localhost values matching `.env.example` variable keys
- Application configuration variables (secrets, API keys) observed in the specification — listed by name so feature tasks do not invent their own variable names
- Cross-project connections with `# @connection {category} {name} ant-project:{projectId}:{feature}` — if the specification names a specific external Ant project as a dependency (e.g., "uses sketch-be as backend")

**Constraint**: Do NOT omit infrastructure provisioning (`docker-compose.yml`) from setup task when the specification mentions external services. Do NOT omit `@connection` annotations — they are required for the platform to detect and manage service connections. Do NOT omit `ant-project:{projectId}:{feature}` modifier when the specification explicitly names a target project — without it, the platform cannot auto-resolve the cross-project proxy path.

**Blind spot**: `docker-compose.yml` is EASILY FORGOTTEN when specification mentions only service names (e.g., "PostgreSQL", "Redis") without an explicit infrastructure section. `@connection` annotations are EASILY FORGOTTEN. The `ant-project:{projectId}:{feature}` modifier for cross-project dependencies is EASILY FORGOTTEN when the specification mentions another project by name. `.env` is EASILY FORGOTTEN when `.env.example` is mentioned — both MUST appear together. Application configuration variables (secrets, API keys) are EASILY LEFT TO FEATURE TASKS — listing them in setup prevents variable name inconsistency across tasks. Verify all are included.

---

## Parallel Execution

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** -- Task MUST run alone. Determine by observing the task's `type` field and `priority` value:
- `type: "setup"` -> always exclusive (installs dependencies, modifies lock files)
- `type: "error"` -> always exclusive (may modify shared configs)
- `type: "verification"` (priority 1000) -> always exclusive
- Any task that installs packages or modifies shared build configs

⚠️ **CONSTRAINT**: `exclusive` is determined ONLY by the `type` field value and `priority` value. Do NOT infer `exclusive` from task name or description content.

**`parallelGroup: "<group-id>"`** -- Tasks with the SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

**Principle**: Maximize parallelism by assigning different group IDs to tasks that modify independent scopes (different directories, different modules, different layers).

**Constraint**: Only assign the SAME group ID when tasks are likely to modify the SAME source files.

**Observation target**: For each pair of feature tasks, check if they access the same persistence boundary.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared persistence boundary** | Do two tasks read/write the same database table, collection, or data store? |
| **Shared data-access module** | Will two tasks need to add operations to the same repository or data-access layer? |

**Constraint**: Tasks that access the SAME persistence boundary MUST share the same parallelGroup -- even if they expose different API endpoints or serve different features. In layered architectures, one persistence boundary maps to one data-access module; concurrent writes to that module cause conflicts.

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
- `type: "feature"`, `exclusive: true`, priority 800-899 (after all feature tasks, before verification)
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
  "language": "golang",
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
