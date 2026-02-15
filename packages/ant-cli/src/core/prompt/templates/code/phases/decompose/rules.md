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
| `type` | Yes | `"setup"` (new project config), `"feature"` (new capability), or `"error"` (broken behavior fix) |
| `priority` | Yes | 100: setup, 200-219: critical, 220-249: important, 250-899: nice-to-have, 1000: final verification |
| `packages` | Yes | Which design documents to inject (see Package Tags below) |
| `exclusive` | Conditional | `true` if task must run alone. Use for setup, error, and final verification tasks |
| `parallelGroup` | Conditional | Group ID for serialization. Tasks with different IDs can run in parallel. Mutually exclusive with `exclusive` |
| `ui` | Yes | `true` if task involves the visual presentation layer |
| `uiSections` | When ui=true | Array of UI doc section IDs to inject (see specification for available sections) |
| `description` | Yes | What to do. Prefix with `<ui>` when `ui: true` |

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

## Final Verification Task

**Principle**: A final verification task (priority 1000) validates the entire project by running build, lint, and startup commands discovered from the project configuration.

**Constraint**: The final verification task MUST NOT write new code, create new projects, or add new features. It only runs existing verification commands and fixes errors they reveal.

**Constraint**: Include final verification if there are any feature tasks. Skip ONLY if ALL tasks are error tasks.

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

## UI Task Descriptions

**Principle**: Task descriptions for UI tasks should provide DIRECTION, not DETAILS. The Plan stage reads design documents to extract complete requirements.

**Constraint**: Do NOT enumerate specific components, counts, or layout details in the description. Use: `"<ui> Implement [section/area] based on design specifications"`.

**Constraint**: Do NOT create a separate task for copying assets. UI tasks handle asset integration as part of their implementation.

**Constraint**: Do NOT create a separate design tokens task. Include token configuration in the Setup task (new project) or the first UI task (existing project).

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

---

## Parallel Execution

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** -- Task MUST run alone:
- `type: "setup"` -> always exclusive (installs dependencies, modifies lock files)
- `type: "error"` -> always exclusive (may modify shared configs)
- `priority: 1000` (final verification) -> always exclusive
- Any task that installs packages or modifies shared build configs

**`parallelGroup: "<group-id>"`** -- Tasks with the SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

**Principle**: Maximize parallelism by assigning different group IDs to tasks that modify independent scopes (different directories, different modules, different layers).

**Constraint**: Only assign the SAME group ID when tasks are likely to modify the SAME source files.

**Naming convention**: `"<package>-<scope>"` where scope is the functional area within the package.

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
