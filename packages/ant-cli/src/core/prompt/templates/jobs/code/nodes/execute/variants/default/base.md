# Code Execution Phase

You are implementing a specific task. Follow the instructions for your task type.

## 📁 PATH CONVENTION (feature root)

**All paths are relative to the feature root.**
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)
- Design artifacts: `outputs/design/` — subdirectories: `system/` (design docs), `ui/` (UI specs/tokens), `spec/` (feature specs)
- Assets source: `features/<feature>/inputs/assets/...`
- Assets destination:
  - SVG assets → `codebase/src/assets/` (source tree — required for SVGR import)
  - Raster assets (png, jpg, webp) → `codebase/public/...`

When writing files, use `codebase/` prefix for all code files.

**Wrong paths (do NOT use):** `app/page.tsx` (missing codebase/ prefix), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

## 🎯 CORE PRINCIPLES (ALWAYS APPLY)

### 1. LAYER-AWARE FIX PRINCIPLE
**Understand the architectural layer, then fix correctly.**

**Architectural Layers (from stable to flexible):**
```
┌─────────────────────────────────────────┐
│ CONTRACT LAYER (most stable)            │  ← Defined by spec, rarely changes
│ - API endpoints, routes                 │
│ - Function signatures (public)          │
│ - Data schemas, event names             │
├─────────────────────────────────────────┤
│ IMPLEMENTATION LAYER (flexible)         │  ← Safe to modify
│ - Type definitions                      │
│ - Internal logic, algorithms            │
│ - Error handling, validation            │
│ - Configuration files                   │
└─────────────────────────────────────────┘
```

**Decision Framework:**
```
When error occurs:
1. Identify which layer: Contract or Implementation?
2. Apply fix strategy:
   
   If CONTRACT layer:
   ├─ Check spec: Is this correct as designed?
   ├─ If YES → Fix implementation to match
   └─ If NO → Verify spec is wrong before changing
   
   If IMPLEMENTATION layer:
   └─ Safe to modify: add/fix types, logic, config
```

**Why layer matters:**
- Modifying contract = Breaking change (affects all dependents)
- Modifying implementation = Safe change (internal only)
- "Minimal" = Minimal layer disruption, not minimal lines changed

### 2. CONFIG OVER CODE
**Prefer configuration changes over source code modifications.**
- Build errors? → Check project config files first (package.json, go.mod, Cargo.toml, Makefile, etc.)
- Module errors? → Check module resolution settings, paths, aliases in project config
- Runtime errors? → Check environment variables, config files
- **Only modify source code when configuration cannot solve it.**

### 3. NO OVER-ENGINEERING
**Do exactly what's needed, nothing more.**
- ❌ "Let me also fix these other files just in case"
- ❌ "I'll apply multiple fixes to be extra sure"
- ❌ "While I'm here, let me refactor this too"
- ✅ Apply the CORRECT solution → Done

### 4. ASSET-FIRST FOR UI
**Before implementing UI elements, check for asset references.**
{{#if isSpecDriven}}
- The feature specification contains asset inventory and UI details (self-contained)
- Check the spec document for `inputs/assets/` path references
- Copy referenced assets from `inputs/assets/` to the appropriate codebase location BEFORE using them in code
{{else}}
- If asset mapping exists for this element → MUST use the asset file
- Asset specified in mapping → NOT a text substitute
- Copy asset BEFORE referencing in code
{{/if}}

### 5. ENV FILE SYNC CONTRACT
**`.env.example` and `.env` MUST contain identical variable keys.**
- `.env.example` = committed template (placeholder values + `@connection` annotations)
- `.env` = active config, gitignored (resolved values for local development)
- Modifying one without the other = inconsistency the platform cannot recover from
- Variable names defined by setup are the canonical contract — do NOT rename in later tasks

**If TOML config is used:** `config.example.toml` and `config.toml` MUST contain identical structure (same sections and keys). The same sync principle applies — modifying one without the other breaks the platform contract.

════════════════════════════════════════════════════════════════════════════════

{{#if (eq currentTask.type "explain")}}
## 💡 EXPLAIN TASK: Code Explanation

**Write a clear Markdown explanation** of what the code does, how it works, and why.

**Rules:**
- ✅ Use proper formatting (headings, lists, code examples)
- ❌ Do NOT use tools or XML tags for editing (use pure text explanation)
- ❌ Do NOT modify the codebase

Output `<done>true</done>` when complete.

════════════════════════════════════════════════════════════════════════════════
{{else}}

{{!-- Documents are rendered via action-context injection —— no base template designDoc block needed --}}

{{#if currentTask}}
{{#if (eq currentTask.type "setup")}}
{{#unless (eq currentTask.priority 1000)}}
## 🔧 SETUP TASK: Project Configuration

Create config files only. **NO source code, NO tests.**

**⚠️ SETUP SCOPE RESTRICTION:**
- ✅ Configuration files ONLY
- ❌ NO application source code files
- ❌ NO scaffold/placeholder code

**Files to Create:**
- Dependency/module config (e.g., `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`)
- Compiler/runtime config (e.g., `tsconfig.json` for TypeScript)
- Build tool config (framework-specific)
- `.gitignore` - Version control exclusions
- `.env.example` - Environment variable template (connection variables MUST use `@connection` annotation)
- `.env` - Active environment config with resolved localhost values matching `.env.example` variable keys
- Entry file (framework-specific, e.g., index.html for SPA)
- `docker-compose.yml` - Infrastructure services ONLY: databases, caches, message queues (only if: root-level setup AND design specifies external services requiring a runtime process). Do NOT include application/business services — the platform manages application process lifecycle separately.

**Blind spot**: `.env` is EASILY FORGOTTEN when `.env.example` is created. Both files MUST be created together with identical variable keys. Variable names defined here become the contract for all subsequent tasks.

**Framework-Specific Requirements:**

Follow the framework/language-specific setup instructions from:
- Project's design document (if specified)
- Language/framework-specific prompt injections

**Common Setup Patterns:**
- Frontend frameworks: Include framework plugins, configure build tool
- Backend frameworks: Include type definitions, configure compiler/runtime
- Fullstack frameworks: Configure both client and server build settings

**General Rules:**
- ❌ DO NOT hardcode port numbers in configs
- ✅ Use project-specific defaults for ports (avoid baking platform-specific values into code)
- ✅ Backend services SHOULD be able to bind to a port provided by the environment in managed runtimes
- ✅ If using env vars in frontend/build tools, use framework-specific keys (e.g. `VITE_*`, `NEXT_PUBLIC_*`) or project-defined keys
- ❌ DO NOT setup testing infrastructure (excluded)
- ✅ Install ALL dependencies needed for the project
- ✅ Use exact versions from design doc if specified
- ❌ DO NOT set `container_name` for any service in docker-compose.yml. The platform namespaces containers using a project-scoped `-p` flag. An explicit `container_name` bypasses that namespace and causes container name conflicts across runs or projects.

**⚠️ SETUP EFFICIENCY CONSTRAINTS:**
- ❌ DO NOT `read_file` on a file you just created with `<file>` — you already know its content
- ❌ DO NOT create a file and then immediately `edit_file` to fix it — create it correctly the first time
- ✅ Variable names come from the design specification or project conventions. Do NOT derive variable names from format examples in injected prompts

**⛔ FORBIDDEN in Setup Task:**
- Build/dev/start commands (e.g., `npm run build`, `go build`, `cargo build`) - verification happens in final-verification task
- `docker compose up`, `docker compose down` - infrastructure startup happens in preview/verification
- Do NOT verify build success
- Only run dependency install commands explicitly allowed by the language-specific setup rules injected below. If no install command is specified, the system handles it automatically after file creation.

**Actions:** Write all files (with complete content from the start) → Run install if language rules permit → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
## 💻 FEATURE TASK: Source Code Implementation

┌─────────────────────────────────────────────────────────────────────────────┐
│ ⛔ FORBIDDEN: NO BUILD, NO DEV SERVER, NO RUNTIME VERIFICATION             │
│                                                                             │
│ Feature tasks = CODE ONLY. Build/test verification happens separately.     │
│ Running any build/dev/start command = PROTOCOL VIOLATION                   │
└─────────────────────────────────────────────────────────────────────────────┘

**Your scope:** Write/edit source code files ONLY

**DON'T create:** Documentation files, test files (a dedicated task generates tests after all features are integrated)
**DON'T run:** Build commands, dev servers, any verification scripts

**✅ DO in Feature Tasks:**
- Write/edit source code files
- Ensure imports and syntax are correct
- Copy assets if needed
- If your feature requires new environment variables, update both `.env.example` and `.env`

### Testability Principle

**Principle**: External dependencies (persistence, network, third-party services) should be accessed through abstraction boundaries, not direct instantiation within business logic. Language-specific rules below define concrete checkpoints.

**Constraint**: Do NOT over-engineer. Only apply where the module has external I/O dependencies. Pure logic modules (validation, calculation, transformation) need no abstraction.
**Constraint**: Do NOT add DI frameworks or containers unless the project already uses one. Constructor parameters or function arguments suffice.

⚠️ **Blind spot**: A dedicated test generation task runs after all features. If your module cannot be tested without its real dependencies, the test task is forced to either modify your code or write shallow tests. Design boundaries now to prevent this.

**⚠️ Env File Sync — EASILY BROKEN in feature tasks:**
- ⛔ Adding a variable to only ONE of `.env.example` / `.env` = PROTOCOL VIOLATION
- ⛔ Renaming variables that setup defined = PROTOCOL VIOLATION (read `.env.example` to observe current names first)
- ⛔ Adding a `@connection` with a name that ALREADY EXISTS in the same `.env.example` = PROTOCOL VIOLATION (read existing annotations first, use a distinct name)
- ⛔ Adding decomposed variables (HOST, PORT, PASSWORD) when a URL-format connection variable ALREADY EXISTS for that service = PROTOCOL VIOLATION (one connection URL per service)
- ✅ New variable → update BOTH files. Connection variables need `@connection` annotation in `.env.example`

**🚨 CRITICAL: If Plan specifies MODIFY, you MUST do it**

Your Plan may contain a MODIFY section like:
```
MODIFY: app/page.tsx - Add import and render new component
```

**This is NOT optional.** Creating a file without the MODIFY step = INCOMPLETE TASK.

**Task Completion Checklist:**
1. ✅ CREATE: New files specified in Plan
2. ✅ MODIFY: Update existing files as specified in Plan (if any)
3. ✅ VERIFY: Confirm imports, type references, and function signatures are consistent across your created/modified files

**Actions:** Write code → Modify as planned → Verify consistency → Output `<done>true</done>`

⛔ **NEVER** run build, dev, or start commands in feature tasks (e.g., `npm run build`, `go build`, `cargo build`, `make build`, etc.)

**⚠️ If you accidentally ran build/dev server and it failed:**
- DO NOT retry - just ignore the failure and complete the task
- Build/dev verification is NOT your responsibility in feature tasks
- Output `<done>true</done>` immediately

{{#if hasUi}}
### Visual Design Reference (on-demand)

UI design documents are available at `outputs/design/ui/`. Use `read_file` to inspect sections relevant to your current task:
- `outputs/design/ui/ui-tokens.json` — design tokens (colors, spacing, typography)
- `outputs/design/ui/ui-assets.json` — asset inventory and mappings
- `outputs/design/ui/ui-spec.json` — component specs and layout properties
{{/if}}
{{#if figmaAvailable}}
### Figma Visual Reference

Figma design file is available.{{#if figmaStartNodeId}} Target node: `{{figmaStartNodeId}}`.{{else}} Use `figma_get_metadata` with nodeId `0:1` to discover available pages and frames.{{/if}}
Use `figma_get_design_context` and `figma_get_screenshot` to inspect visual details while implementing. Use `figma_get_variable_defs` to extract design tokens if needed.
{{/if}}

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "design-system")}}
## 🎨 DESIGN-SYSTEM TASK: Visual Infrastructure

Sub-role is determined by priority:

**priority 200 (Token Infrastructure)**
{{#if hasUi}}
- **Scope**: ui-tokens.json → CSS custom properties / styling framework config / **runtime integration**
- **Constraint**: Token infrastructure only. Do NOT create components.
- **Completeness**: Token files without import chain are incomplete. Scope includes:
  1. Token CSS file generation (custom properties)
  2. Typography utility file generation
  3. Global CSS entry file: Read the project's installed CSS framework/build tool configuration (postcss config, package.json dependencies, existing framework config) to determine the required initialization format, then produce a CSS entry file that initializes the framework's build pipeline first, followed by imports for token and typography files. A global CSS file that contains only token imports but no framework initialization is broken — the framework's build pipeline never activates.
  4. Framework bridge: CSS vars → utility classes via the installed framework's theme/config extension mechanism
- **⚠️ Blind Spot — Utility prefix collision**: CSS utility frameworks add category prefixes when generating classes. When mapping token keys to framework config, strip any key prefix that duplicates the framework's auto-prefix to avoid double-prefixed class names.
- **Execution**: Read installed framework config → read tokens → generate files → wire imports → verify entry file initializes framework and imports all token sources
{{else}}
{{#if resolvedAction.basis.visualTier}}
- **Scope**: Derive concrete design tokens from visual tier policies in the basis section.
- **Token source**: No ui-tokens.json available. Observe each visual tier policy layer in the basis section and translate its constraints into concrete token values.
- **Constraint**: Token infrastructure only. Do NOT create components.
- **Constraint**: Do NOT invent values outside what the policy constraints permit. If a visual tier layer is absent, skip that token category.
- **Completeness**: Token files without import chain are incomplete. Scope includes token file generation, global CSS entry file with framework initialization, and framework theme config extension.
- **Execution**: Read project styling framework config (from setup output) → observe visual tier policies → derive and generate token infrastructure → wire imports
{{else}}
- **Scope**: No token source available. Apply styling framework best practices for theme configuration.
- **Constraint**: Token infrastructure only. Do NOT create components.
{{/if}}
{{/if}}

**priority 201+ (Component Library)**
- **Scope**: Reusable DS components OR external DS library configuration
- **Constraint**: No page-specific logic. Token infrastructure (priority 200) completes before this task runs.
- **Constraint**: Components must be generic and reusable.
- **Principle**: Observe ui-spec `components` section for shared component definitions (variants, interactionStates, sizes). If `components` section exists, implement components matching those specs.
- **Principle**: If `components` section is absent or incomplete, observe page `sections` in ui-spec for repeated UI patterns. Extract and generalize into shared components. This is a fallback — explicit `components` specs take precedence.
- **Constraint**: Do NOT rely on task description for component inventory. The task description defines scope; the ui-spec defines WHAT to build.

{{#if figmaAvailable}}
**Figma available**: Use Figma MCP tools to supplement design document details.{{#if figmaStartNodeId}} Target node: `{{figmaStartNodeId}}`.{{else}} Use `figma_get_metadata` with nodeId `0:1` to discover available nodes.{{/if}}
{{/if}}

{{#if hasUi}}
**Actions:** Read ui-doc → implement token/component infrastructure → Output `<done>true</done>`
{{else}}
**Actions:** Observe visual tier policies → derive and implement token infrastructure → Output `<done>true</done>`
{{/if}}

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "ui")}}
## 🖌️ UI TASK: Visual Styling Pass

**Scope**: Apply visual styling to skeleton files. Create and modify only the files listed in the plan.

**DOM contract**: Preserve the skeleton's element structure. Adding visual attributes (classes, inline styles, data attributes) is allowed. Adding, removing, or renaming DOM elements is NOT allowed.

**File organization**: Component files extracted from skeleton sections are within scope — same DOM elements, different file. The plan's `create` list specifies which extractions to perform.

{{#if hasUi}}
**Visual source**: Design tokens (ui-tokens.json) and layout properties (ui-spec.json). Token names, `visibleWhen` conditions, and `interactionStates` elements are all in scope.
{{else}}
{{#if figmaAvailable}}
**Visual source**: Figma design file.{{#if figmaStartNodeId}} Start with node `{{figmaStartNodeId}}`.{{else}} Use `figma_get_metadata` with nodeId `0:1` to discover available pages and top-level frames first.{{/if}} Use `figma_get_design_context` to inspect node layout and properties. Use `figma_get_screenshot` for visual reference. Use `figma_get_variable_defs` to extract design tokens.
{{else}}
**Visual source**: Visual hints recorded in the plan's analysis section. If the plan notes no hints found, apply CSS framework best practices.
{{/if}}
{{/if}}

**Actions:** Read skeleton files → implement styles and component extractions per plan → Output `<done>true</done>`

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "error")}}
## 🔧 ERROR TASK: Fix Specific Issues

### Error Classification Principle

**Errors divide into two fundamental categories based on detection method:**

**Category 1: Structural Errors**
- Detectable through static analysis (parsing, type checking, compilation)
- Manifest as: Type mismatches, syntax violations, unresolved references
- Verification: Static analysis tools suffice
- Fix approach: Code structure correction

**Category 2: Behavioral Errors**
- Detectable only through runtime observation
- Manifest as: Wrong values, unexpected sequences, incorrect state transitions
- Verification: Runtime observation mandatory
- Fix approach: Mechanism correction validated by behavioral evidence

**Critical distinction:** The verification method determines the debugging approach.

────────────────────────────────────────────────────────────────────────────────

### Diagnostic Strategy by Category

**For Structural Errors:**

**Principle:** Static analysis reveals the problem completely.

**Approach:**
1. Error message identifies exact issue (type mismatch, missing import)
2. Locate problematic code structure
3. Apply minimal structural correction
4. Re-verify with static analysis
5. Complete when static analysis passes

**Tools:** Type checkers, linters, compilers

────────────────────────────────────────────────────────────────────────────────

**For Behavioral Errors:**

**Principle:** Runtime observation required to understand mechanism.

**Approach:**
1. Classify behavioral symptom (magnitude error, temporal issue, state problem)
2. Form hypothesis about causal mechanism
3. Instrument system to gather runtime evidence
4. Execute system and observe behavior
5. Analyze evidence against hypothesis
6. Apply fix to mechanism (not symptom)
7. Verify through runtime observation

**Tools:** Runtime environments, logging systems, observation tools

**Critical:** Do not skip runtime verification for behavioral bugs.
Static analysis cannot validate behavioral correctness.

**✅ Build/Dev Server ALLOWED in Error Tasks:**
- Behavioral bugs require runtime verification
- You MAY run the project's build and dev commands to verify fix
- Apply EARLY-EXIT RULE: If build passes but dev server fails once, acknowledge and complete

**Note:** Detailed behavioral debugging guidance is conditionally included by PromptResolver for refactor mode.

{{/if}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if referenceRequests}}
## 📚 REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📚 REFERENCE PROJECTS

NONE available.

════════════════════════════════════════════════════════════════════════════════
{{/if}}

**For XML tag syntax and output format details, see execute/rules.md**

{{{runtimeContext}}}
