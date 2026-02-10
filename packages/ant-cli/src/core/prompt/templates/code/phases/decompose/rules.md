OUTPUT FORMAT:

{{> code/base/injections/text-format-compact}}

**Text Formatting Rules:**
- Use inline code for file names, variables, and technical terms: `api.ts`, `VITE_BACKEND_URL`
- Write analysis in natural sentences without excessive line breaks
- Keep related information on the same line
- Example: "`api.ts` uses `VITE_BACKEND_URL` and `VITE_BACKEND_WSURL`"
- NOT: "api.ts\n는\nVITE_BACKEND_URL\n과..." (excessive line breaks)

First, analyze step by step (think through):
- Is this a new project or existing project?
  - ⚠️ If "EXISTING CODEBASE DETECTED" was shown → EXISTING PROJECT
  - ⚠️ If existing project → DO NOT create setup task (priority 100)
- Does it need setup/configuration tasks?
  - ⚠️ ONLY for NEW projects without any code
  - ⚠️ If ANY files exist → setup already done, skip setup task
- What are the main features to implement?
- What is the optimal task breakdown?

Then output the task list wrapped in <tasks> tags with valid JSON:

**Example 1: NEW PROJECT with both UI and backend tasks**
<tasks>
[
  {
    "id": "project-setup",
    "name": "Setup Project",
    "type": "setup",
    "priority": 100,
    "exclusive": true,
    "ui": true,
    "uiSections": ["tokens"],
    "description": "<ui> Create project structure, configure Tailwind with design tokens, and install dependencies"
  },
  {
    "id": "database-schema",
    "name": "Implement Database Schema & Models",
    "type": "feature",
    "priority": 200,
    "parallelGroup": "backend-db",
    "ui": false,
    "description": "Define database schema, ORM models, and migrations for user and content entities"
  },
  {
    "id": "api-endpoints",
    "name": "Implement API Endpoints",
    "type": "feature",
    "priority": 210,
    "parallelGroup": "backend-api",
    "ui": false,
    "description": "Create REST API for user authentication and data management"
  },
  {
    "id": "hero-section",
    "name": "Implement Hero Section",
    "type": "feature",
    "priority": 220,
    "parallelGroup": "frontend-hero",
    "ui": true,
    "uiSections": ["tokens", "assets", "hero", "layout", "responsive"],
    "description": "<ui> Implement Hero section based on design specifications"
  },
  {
    "id": "about-section",
    "name": "Implement About Section",
    "type": "feature",
    "priority": 230,
    "parallelGroup": "frontend-about",
    "ui": true,
    "uiSections": ["tokens", "about", "layout"],
    "description": "<ui> Implement About section based on design specifications"
  },
  {
    "id": "final-verification",
    "name": "Final Build & Startup Verification",
    "type": "feature",
    "priority": 1000,
    "exclusive": true,
    "ui": false,
    "description": "Run build/lint/type-check commands on EXISTING codebase. DO NOT write new code or create new projects. Only verify: npm run build, npm run lint, npm run dev."
  }
]
</tasks>

**Example 2: EXISTING PROJECT with feature request**
<tasks>
[
  {
    "id": "add-user-balance",
    "name": "Add Balance Field to User",
    "type": "feature",
    "priority": 200,
    "parallelGroup": "backend",
    "ui": false,
    "description": "Extend User entity with balance field and update related services"
  },
  {
    "id": "final-verification",
    "name": "Final Build & Startup Verification",
    "type": "feature",
    "priority": 1000,
    "exclusive": true,
    "ui": false,
    "description": "Run build/lint/type-check commands on EXISTING codebase. DO NOT write new code or create new projects. Only verify: npm run build, npm run lint, npm run dev."
  }
]
</tasks>

**Example 3: ERROR FIX (error message in directive)**
<tasks>
[
  {
    "id": "fix-module-error",
    "name": "Fix ERR_MODULE_NOT_FOUND for EventHandler",
    "type": "error",
    "priority": 200,
    "exclusive": true,
    "ui": false,
    "description": "Analyze and resolve: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module ./EventHandler'. Determine root cause (missing file, wrong path, or config issue) and apply fix."
  },
  {
    "id": "final-verification",
    "name": "Verify Error Resolution",
    "type": "feature",
    "priority": 1000,
    "exclusive": true,
    "ui": false,
    "description": "Run build/lint/type-check on EXISTING codebase to confirm fix. DO NOT write new code or create new projects. Fix remaining errors if build fails."
  }
]
</tasks>

**🚨 CRITICAL: Final Verification Task Principles**
The `final-verification` task has a SPECIFIC and LIMITED scope:
1. **ONLY run verification commands**: `npm run build`, `npm run lint`, `npm run dev`, `npm run type-check`
2. **DO NOT write new code** - only fix errors found by verification commands
3. **DO NOT create new projects** - never use `npx create-*`, `npm init`, `yarn create`
4. **DO NOT add new features** - only ensure existing code works
5. **If build fails**: fix the SPECIFIC error mentioned, then re-run build

**⚠️ Key differences:**
- NEW PROJECT: "Create", "Implement" + Setup task + type: "setup"/"feature"
- EXISTING PROJECT: "Add", "Extend" + NO setup task + type: "feature"
- ERROR FIX: **Broken behavior that needs fixing** + **type: "error"** (CRITICAL!)

**🚨 CRITICAL: Error vs Feature Distinction**

**Type: "error"** - Code is BROKEN, FAILING, or CRASHING:
- Core principle: **Expected behavior is not happening** due to bugs, build failures, or runtime errors
- Indicators:
  - Build failures, compilation errors
  - Runtime crashes, exceptions, MODULE_NOT_FOUND, ENOENT
  - Missing critical files that prevent execution
  - Broken imports, incorrect behavior, failed tests
- Action focus: **Fix** the broken code to restore expected behavior
- Examples: "Error: Cannot find module", "Build failed", "Server crashes on startup"

**Type: "feature"** - NEW functionality or IMPROVEMENT:
- Core principle: Adding capability that **didn't exist** or **enhancing** working code
- Indicators: New requirements, performance optimization, UX enhancement, new endpoints
- Action focus: **Extend** or **improve** capabilities
- Examples: "Add user authentication", "Optimize database queries", "Add new API endpoint"

**Decision framework:**
1. Is there an error message, crash, or build failure? → **error**
2. Does the code fail to run or compile? → **error**
3. Does the request add NEW capability to working code? → **feature**
4. Ambiguous "fix" without clear error/crash? → Default to **feature**

**CRITICAL: "worked before" is NOT required for error type!**
- First-time build failures ARE errors (broken code from the start)
- Missing entry points that prevent execution ARE errors
- Any crash or exception IS an error, regardless of history

**📦 Dependencies Management:**
- **Preferred:** Include all known dependencies in Setup Task (priority 100)
- **Allowed:** Feature tasks CAN add dependencies if absolutely necessary
- **Example:** If a feature needs `date-fns` library, the feature task description can mention: "Add date formatting using date-fns (install if missing)"

CRITICAL: 
- The JSON inside <tasks> tags MUST be valid JSON (no trailing commas, proper quotes)
- Use <tasks> wrapper so the JSON can be reliably extracted

**UI TASK FLAG (IMPORTANT):**
- Add `"ui": true|false` to EVERY task object.
{{#if hasUiDocs}}
- **Setup tasks (`type: "setup"`):**
  - **Frontend app/package setup → `ui: true`** with `uiSections: ["tokens"]` (needs design tokens for Tailwind/theme config)
  - **Backend app/package setup → `ui: false`**
  - **Root workspace setup (monorepo) → `ui: false`** (workspace config only, no styling)
{{else}}
- **Setup tasks (`type: "setup"`) → `ui: false`** (no UI docs available)
{{/if}}
- Set `"ui": true` when the task needs UI design context:
  - UI components (Button/Input/Modal/Table), layout, styling/CSS/Tailwind
  - Screen/page implementation, UI state (loading/empty/error), UX interactions
  - Theme/tokens/typography/colors, **project setup with Tailwind/theme configuration**
  - React/TSX view layer changes
- Otherwise set `"ui": false` (backend-only, infra, API contract, server fixes, dependency fixes).
- When `"ui": true`, **ALWAYS** prefix description with `<ui>` (applies to ALL task types including Setup).

**UI SECTIONS (SPLIT INJECTION - CRITICAL FOR TOKEN OPTIMIZATION):**
- When `"ui": true`, you MUST add `"uiSections": [...]` array specifying which UI doc sections are needed.
- This enables split injection - only the requested sections are loaded into the prompt (saves ~40-50K tokens per task).
- Available section IDs (see "Available UI Sections" above for full list):
  - Core: `"tokens"` (design tokens), `"assets"` (asset mappings)
  - Components: `"gnb"`, `"hero"`, `"about"`, `"ecosystem"`, `"token"`, `"technology"`, `"social"`, `"footer"`
  - Common: `"layout"`, `"responsive"`, `"accessibility"`
- **Best practice**: Include `"tokens"` for all UI tasks, then add specific component sections needed.
- Example:
  ```json
  {
    "id": "hero-section",
    "name": "Implement Hero Section",
    "type": "feature",
    "priority": 210,
    "ui": true,
    "uiSections": ["tokens", "assets", "hero", "layout", "responsive"],
    "description": "<ui> Implement Hero section based on design specifications"
  }
  ```
- If `uiSections` is omitted or empty, ALL UI docs are injected (fallback, not recommended for large docs).

**PACKAGE TAG (SPLIT DESIGN DOC INJECTION):**

**⚠️ REQUIRED: Every task MUST have `"packages": [...]`** to control which design documents are injected into the plan/codeGen prompt. This is mandatory for all task types (setup, feature, error).

**Tag Format:**

| Tag | Maps To | Description |
|-----|---------|-------------|
| `fe` | `fe-system-design.md` | Single frontend |
| `fe-{pkg}` | `fe-system-design-{pkg}.md` | Multi-frontend package (e.g., `fe-web`, `fe-admin`) |
| `be` | `be-system-design.md` | Single backend |
| `be-{svc}` | `be-system-design-{svc}.md` | MSA service (e.g., `be-auth`, `be-order`) |
| `shared` | api-contract.md only | Shared/utility package (types, DTOs, configs) |

- `api-contract.md` is **ALWAYS injected** when any package is specified
- `shared` tag: no system design doc is mapped — only `api-contract.md` is injected (sufficient for shared types/DTOs)

**Examples:**
```json
// Setup tasks
{ "packages": ["shared"], "type": "setup", "description": "Initialize monorepo workspace with root configuration" }
{ "packages": ["shared"], "type": "setup", "description": "Configure shared package for TypeScript type definitions" }
{ "packages": ["be"], "type": "setup", "description": "Initialize NestJS backend with dependencies" }
{ "packages": ["fe"], "type": "setup", "description": "Initialize React frontend with dependencies" }

// Shared package tasks (api-contract.md only)
{ "packages": ["shared"], "description": "Define TypeScript types and DTOs from API contract" }

// Single frontend task
{ "packages": ["fe"], "description": "Implement header component" }

// Multi-frontend task (monorepo)
{ "packages": ["fe-web"], "description": "Implement web app landing page" }
{ "packages": ["fe-admin"], "description": "Implement admin dashboard" }
{ "packages": ["fe-web", "fe-shared-ui"], "description": "Use shared UI library in web app" }

// Single backend task
{ "packages": ["be"], "description": "Implement user API endpoints" }

// MSA backend task
{ "packages": ["be-auth"], "description": "Implement auth service login endpoint" }
{ "packages": ["be-auth", "be-order"], "description": "Inter-service integration: order → auth" }

// Cross-tier integration
{ "packages": ["fe-web", "be-auth"], "description": "Frontend auth integration with auth service" }
```

**How to choose the right tag:**
- Task touches frontend code → `fe` (or `fe-{pkg}` for monorepo)
- Task touches backend code → `be` (or `be-{svc}` for MSA)
- Task touches shared/common code (types, DTOs, configs) → `shared`
- Task touches both frontend and backend → `["fe", "be"]`
- Root workspace setup (monorepo init) → `["shared"]`

**UI TASK DESCRIPTION GUIDELINES (CRITICAL):**

**For UI tasks, task description should provide DIRECTION, not DETAILS.**

The Plan stage will read design documents (ui-spec.json, ui-assets.json) to extract complete requirements.

**❌ BAD (too specific - constrains Plan stage):**
- "Create landing page with hero section, 3 feature cards, and footer"
- "Implement dashboard with sidebar, chart widget, and user table"
- "Add header with logo, 5 navigation links, and search bar"

**✅ GOOD (provides direction - lets Plan discover details):**
- "Implement landing page based on design specifications"
- "Implement dashboard UI per ui-spec.json"
- "Implement header component as specified in design documents"

**Why:**
- Task description = Starting point (what general area)
- Design documents = Complete specification (all components, assets, layouts)
- Plan stage = Reads docs and extracts EVERYTHING
- If you specify "3 cards" but docs say "5 cards" → Plan might miss 2 cards

**Template for UI task descriptions:**
```
"<ui> Implement [section/component name] based on design specifications"
```
- If the spec contains a "Runtime Assets Available (inputs/assets)" section (file list), those files are **NOT auto-copied**.
- **DO NOT create a separate task just for copying assets.** UI tasks should handle asset copying as part of their implementation.
- When implementing UI components, the task must:
  1) Decide the correct static asset root for the target app (monorepo-aware: e.g., `apps/<app>/public`, `packages/<app>/public`, etc.)
  2) Copy assets from `inputs/assets/**` into that static root, preserving relative paths
  3) Reference the copied assets in code (e.g. `/icons/...` or imported assets)
- Do NOT inline/encode binary assets into the prompt. Use file operations / shell copy in implementation.
- **⚠️ ANTI-PATTERN: TODO placeholders instead of actual implementation**
  - ❌ DO NOT leave `{/* TODO: Add logo image */}` comments
  - ✅ Actually copy the asset and reference it in code
- **Note**: Task description should NOT enumerate specific assets. Plan stage will read ui-assets.json to discover all required assets.

**🎨 DESIGN TOKENS INTEGRATION (when ui-tokens.json exists):**

When `ui-tokens.json` is provided in design outputs, design tokens MUST be integrated into the codebase:

| Project State | Where to Handle | Action |
|---------------|-----------------|--------|
| **NEW project** | Setup task | Include token configuration in framework setup |
| **EXISTING project** | First UI task | Update/create token configuration file |

**DO NOT create a separate "design tokens" task.** Token setup is part of:
- Setup task (new project): Configure theme/tokens alongside framework setup
- First UI task (existing project): Update existing theme/styling configuration

**How to indicate in task description:**
```json
// NEW project setup task
{
  "id": "setup-frontend",
  "description": "Configure Next.js with TypeScript, Tailwind. Apply design tokens from ui-tokens.json to theme configuration."
}

// EXISTING project first UI task
{
  "id": "implement-header",
  "description": "<ui> Implement Header based on design specifications. Integrate design tokens into existing styling system."
}
```

**Framework-agnostic principle:** The Plan/Execute stages will determine the correct token application method based on detected framework (Tailwind config, CSS variables, theme provider, etc.).

IMPORTANT:
- **Setup Task Decision (CRITICAL):**
  - ✅ Create setup task(s) ONLY if "NEW PROJECT (no existing codebase)" was shown above
  - ❌ DO NOT create setup task if "EXISTING CODEBASE DETECTED" was shown above
  - ❌ DO NOT create setup task if fileList shows ANY files
  - ❌ DO NOT create setup task to "fix" missing entry points (that's a feature task)
- **Repository Structure & Setup Tasks:**
  - FIRST: Decide monorepo vs monolithic based on project characteristics (see above)
  - Monorepo → Multiple setup tasks (root + each package/app)
  - Monolithic → Single setup task
  - Language-agnostic: Don't mention specific files
  - Assign sequential priorities (100, 101, 102, ...)
- **Task Granularity:**
  - Setup = infrastructure/configuration ONLY (dependency files, configs)
  - Setup MUST NOT create application source code
  - Features = user-facing functionality (source code)
  - Each task must have unique id (kebab-case)
- **Task Independence (CRITICAL):**
  - Each task creates its OWN files for its scope
  - DO NOT scaffold code for other tasks as placeholders
  - Later tasks will add their own code and integrate
- **Final Verification:**
  - ✅ Include if there are feature tasks
  - ❌ Skip if ALL tasks are error tasks

**PARALLEL EXECUTION HINTS (`exclusive` and `parallelGroup`):**

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"` to indicate whether it can run concurrently with other tasks.

**`exclusive: true`** — Task MUST run alone (no concurrent execution):
- `type: "setup"` → ALWAYS exclusive (installs dependencies, modifies lock files)
- `type: "error"` → ALWAYS exclusive (may install deps or modify shared configs)
- `priority: 1000` (final verification) → ALWAYS exclusive (validates entire project)
- Any task that installs packages, modifies shared build configs, or has global side effects

**`parallelGroup: "<group-id>"`** — Tasks with the SAME group ID conflict with each other (cannot run simultaneously). Tasks with DIFFERENT group IDs can run in parallel.

Group ID assignment principle: **Maximize parallelism by identifying independent scopes.**
- Tasks modifying different files/directories → different group IDs → can parallelize
- Tasks modifying the SAME files → same group ID → must serialize
- Within a single package, tasks targeting different layers or modules SHOULD have different group IDs

Group ID naming convention: `"<package>-<scope>"` where scope is the functional area.
- Monorepo with multiple packages:
  - `"backend-db"`, `"backend-api"`, `"backend-auth"` (different layers within backend)
  - `"frontend-hero"`, `"frontend-nav"`, `"frontend-auth"` (different sections within frontend)
  - `"admin-dashboard"`, `"admin-settings"` (different areas within admin)
- Single package with clear layers: `"app-db"`, `"app-api"`, `"app-ui"`
- Truly indivisible single module: `"main"` (only when ALL tasks genuinely touch the same files)

**⚠️ Constraint:** Only assign the SAME group ID when tasks are LIKELY to modify the SAME source files. Different API endpoints, different UI sections, different database tables — these are independent scopes that SHOULD get different group IDs for parallel execution.

**Output Format:**

1. Output tasks as JSON array in <tasks> tags (NO markdown code blocks!):

<tasks>
[
  {
    "id": "backend-db",
    "name": "Define Database Schema",
    "description": "Create database models, schema definitions, and migrations",
    "type": "feature",
    "priority": 200,
    "parallelGroup": "backend-db",
    "ui": false
  },
  {
    "id": "backend-api",
    "name": "Create API Endpoints",
    "description": "Implement REST API routes and controllers for data management",
    "type": "feature",
    "priority": 210,
    "parallelGroup": "backend-api",
    "ui": false
  },
  {
    "id": "header-component",
    "name": "Implement Header",
    "description": "<ui> Implement Header based on design specifications",
    "type": "feature",
    "priority": 220,
    "parallelGroup": "frontend-header",
    "ui": true,
    "uiSections": ["tokens", "assets", "gnb", "layout", "responsive"]
  }
]
</tasks>

2. **ALWAYS output <references> tags after <tasks> (REQUIRED, even if empty!):**

<references>
[
  { "project": "ant-pong-be", "branch": "feature/skeleton" }
]
</references>

**CRITICAL:**
- ⚠️ **ALWAYS output <references> tag, even if empty array**
- If no references → output `<references>[]</references>`
- Use XML tags directly, NOT inside markdown code blocks
- NO ```xml or ``` markers
- Just raw XML tags with JSON content inside

**Reference extraction rules:**
- If directive mentions: "ant-pong-be skeleton" → `{ "project": "ant-pong-be", "branch": "feature/skeleton" }`
- If directive mentions: "ant-pong-be main" → `{ "project": "ant-pong-be", "branch": "main" }`
- If directive mentions: "ant-pong-be" (no feature) → `{ "project": "ant-pong-be" }` (omit branch = use default)
- Feature names automatically become `feature/{name}` branches
- Common patterns:
  - "참고: ant-pong-be/skeleton" → project: ant-pong-be, branch: feature/skeleton
  - "@ref ant-pong-be skeleton" → project: ant-pong-be, branch: feature/skeleton
  - "백엔드(ant-pong-be)의 skeleton 피처" → project: ant-pong-be, branch: feature/skeleton

**Example output:**
```
<tasks>[...]</tasks>

<references>
[
  { "project": "ant-pong-be", "branch": "feature/skeleton" }
]
</references>
```


