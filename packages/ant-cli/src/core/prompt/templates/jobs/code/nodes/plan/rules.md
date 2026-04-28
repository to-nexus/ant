{{#if hasTools}}
{{> jobs/code/base/injections/plan-tools-batch}}
{{/if}}

## Your Task

Generate a **concrete implementation plan** for this task.

────────────────────────────────────────────────────────────────────────────────
## 🎯 Responsibility Split: Plan vs CodeGen
────────────────────────────────────────────────────────────────────────────────

### 📋 Plan Decides (Architecture & Intent)

| Decision Area | What Plan Provides |
|---------------|-------------------|
| **What to create** | Component/file names and purposes |
| **Semantic location** | "components area", "utils", "api layer" |
| **Module purpose** | "handles authentication", "validates input" |
| **Module relationships** | Which files interact with which |
| **Asset mappings** | Source → destination logic |

### 🔧 CodeGen Decides (Implementation & Paths)

| Decision Area | Why CodeGen Decides |
|---------------|---------------------|
| **Exact file paths** | Has `list_files` tool to check actual structure |
| **Directory patterns** | Can verify existing conventions |
| **Code changes** | Has `read_file` to see actual content |
| **Variable/function names** | Context-dependent during implementation |
| **Type definitions** | Determined while writing actual code |

### ⚠️ KEY PRINCIPLE: Plan guides, CodeGen verifies and executes

────────────────────────────────────────────────────────────────────────────────
## 📋 OUTPUT FORMAT (MANDATORY)
────────────────────────────────────────────────────────────────────────────────

**Your response MUST contain exactly one `<plan>` block with this structure:**

```
<plan>
{
  "task": {
    "id": "task-id",
    "goal": "One-line goal description"
  },
  "implementation": {
    "create": [...],
    "modify": [...],
    "assets": [...]
  }
}
</plan>
```

Do NOT wrap reasoning in any tag before `<plan>`. Any pre-`<plan>` text will be shown to the user verbatim — keep prose minimal and focused.

────────────────────────────────────────────────────────────────────────────────
## 📐 JSON SCHEMA FOR `<plan>`
────────────────────────────────────────────────────────────────────────────────

```json
{
  "task": {
    "id": "[task identifier from input]",
    "goal": "[one-line goal derived from your reasoning]"
  },
  "implementation": {
    "create": [
      {
        "name": "[module name]",
        "type": "[component | util | hook | api | service | class]",
        "location": "[semantic area - observe from directory tree]",
        "purpose": "[what this module does, which packages it imports (with exact import path), and which observed API signatures it calls — behavior + inline dependency wiring]"
      }
    ],
    "modify": [
      {
        "target": "[file path or semantic description]",
        "action": "[what to do]",
        "changes": ["[specific change 1, with any observed API signatures the change relies on, quoted inline]", "[specific change 2]"]
      }
    ],
    "assets": [
      {
        "source": "[source path from ui-assets.json]",
        "destination": "[destination path]"
      }
    ]
  },
  "tokens": {
    "colors": ["--color-bg-default: #1a1a2e", "--color-text-primary: #ffffff"],
    "typography": ["font-size-base: 16px"],
    "spacing": ["spacing-md: 16px"]
  }
}
```

Design-prescribed package APIs (import paths + observed signatures) are carried inline in the `purpose`/`changes` of whichever `create`/`modify` entry uses them. No separate structured field — execute reads the natural-language description and implements from there.

────────────────────────────────────────────────────────────────────────────────
## 📐 MODIFY FIELD CONSTRAINT
────────────────────────────────────────────────────────────────────────────────

**Principle**: `modify.action` and `modify.changes` describe WHAT to change, not HOW to execute it. CodeGen decides the operational steps.

**Constraint**: Do NOT include tool execution instructions in MODIFY fields (e.g., "Read existing content first", "Use read_file to check", "Run list_files"). State only the intended change.

**Principle**: When you have read the target file during tool exploration, `modify.action` and `modify.changes` MUST specify the modification point at function/class/block level. Vague descriptions force CodeGen to re-discover what you already know.

**Constraint**: Do NOT describe the modification target more abstractly than what you observed. If you read a file and identified the specific function, name that function — do not generalize to the file level.

⚠️ **Blind spot**: After tool exploration, the instinct is to write a short summary rather than preserving the specificity of what was observed. The observed specificity IS the value — losing it forces CodeGen into redundant exploration.

────────────────────────────────────────────────────────────────────────────────
## 📦 INLINE DEPENDENCY DISCIPLINE
────────────────────────────────────────────────────────────────────────────────

**Principle**: When a `create`/`modify` entry relies on a design-prescribed or otherwise non-obvious package, the entry's `purpose` or `changes` MUST record the observed import path and the exact function/type signatures the code will call. Execute cannot see your tool output — it sees ONLY these natural-language entries.

**Constraint**: Copy signatures exactly as observed via `search_code` / `read_file` on `node_modules/`. Parameter types AND return types. Names alone are insufficient.

**Constraint**: If a design-prescribed package provides the functionality a module needs, use it. Do NOT substitute with well-known alternatives. Record the import path inline in the entry that uses it so the substitution cannot happen silently.

⚠️ **Blind spot**: Discovering an API via tools but then omitting the signatures from the entry that uses the package — the discovery effort is wasted and the implementation phase falls back to well-known alternatives from training data. Inline the observed signatures at the exact `create`/`modify` entry that needs them.

⚠️ **Blind spot**: The same package used by several entries does not require duplicating the full signature in each one. Declare the full signatures in the first entry that introduces the package; later entries may reference it by name (e.g., "use `fn` as defined under create.Foo").

────────────────────────────────────────────────────────────────────────────────
## 🔒 TASK SCOPE PRINCIPLE
────────────────────────────────────────────────────────────────────────────────

**Constraint**: If `.env.example` appears in `create` or `modify`, `.env` MUST also appear in `create` or `modify`. Omitting `.env` when `.env.example` is planned = PROTOCOL VIOLATION.

**Constraint**: Create and modify ONLY files that belong to YOUR task's scope.

- Do NOT modify shared entry points, routers, or wiring files that another task is responsible for
- If your module needs to be registered in a shared integration point, the dedicated integration task will handle it
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own

────────────────────────────────────────────────────────────────────────────────
## 🚫 DUPLICATE PREVENTION
────────────────────────────────────────────────────────────────────────────────

**Before specifying CREATE, check the directory tree for existing similar modules.**

- ❌ DO NOT create new module if similar functionality already exists
- ✅ If similar module exists, use MODIFY instead of CREATE

**Constraint**: Files created by a prior foundation task (priority 200-299) are a stable contract. Do NOT plan MODIFY on them. If the established types or interfaces are insufficient for your needs, define supplementary types within YOUR module's scope.

────────────────────────────────────────────────────────────────────────────────
## 🔗 CROSS-BOUNDARY DEPENDENCIES (Parallel Execution)
────────────────────────────────────────────────────────────────────────────────

**Principle**: When your task needs to call into another task's domain (listed in
Remaining Tasks), define a **minimal local dependency interface** describing ONLY
what your module needs. Do NOT create or implement the other domain's component.

**Principle**: When multiple modules share a namespace scope (same package or
directory where declarations are visible to each other), a utility function MUST
exist in exactly one dedicated file. Do NOT inline identical helper functions in
multiple module files.

**Constraint**: If another task owns a persistence boundary (repository, store,
data access), your task MUST NOT create that component. Define a local interface
with only the methods your module consumes. The application wiring task connects
implementations to interfaces.

**Constraint**: Before creating a utility or helper function, check the directory
tree for an existing shared utility file in the same scope. If one exists, plan to
reuse it. If none exists and the utility is likely needed by sibling modules,
create it in a dedicated shared file — not inline in your module.

⚠️ **Blind spot**: Parallel tasks cannot see each other's code at execution time.
If two tasks independently create the same type, struct, class, or function in a
shared namespace scope, the build fails with duplicate symbol errors. Define ONLY
what YOU own; depend on interfaces for what others own.

────────────────────────────────────────────────────────────────────────────────
## 🔌 INTERFACE CONTRACT CONFORMANCE
────────────────────────────────────────────────────────────────────────────────

**Principle**: An implementation must conform to its interface contract. The interface definition is the single source of truth for method names, parameter types, and return types.

**Observation target**: Does this task create implementations for interfaces defined by a foundation task or another module?

**Constraint**: When the plan includes implementation files, the corresponding interface definition files MUST be listed in `requiredFiles`. Do NOT implement from memory or inferred naming — observe the actual interface first.

⚠️ **Blind spot**: When interface and implementation are created by different tasks (or at different times within the same task), method names and signatures easily drift. The implementation author assumes a name like `subscribe(symbol, callback)` while the interface defines `subscribe(symbol)` + `onUpdate(callback)` separately.

{{> jobs/code/base/injections/secure-coding}}

{{> jobs/code/base/injections/mock-adapter-contract}}

{{!--
  mock-content-imagery — companion to mock-adapter-contract for image
  slots fed by user-uploaded / DB-fetched content. Gate axis (SBS):
  service domain × frontend stack × feature task — derived in code by
  `isMockContentImageryActive` (core/prompt/builder/mockContentImageryGate)
  to satisfy Domain-Branching Locality I1. plan node injects the boolean
  via `mockContentImageryActive`.
--}}
{{#if mockContentImageryActive}}
{{> jobs/code/base/injections/mock-content-imagery}}
{{/if}}

────────────────────────────────────────────────────────────────────────────────
## 🧠 REASONING CHECKPOINTS
────────────────────────────────────────────────────────────────────────────────

Before emitting `<plan>`, internally consider the observations below. These are targets for your reasoning, NOT an output format — do NOT emit them as prose.

### External Dependency Verification

**Observation target**: Does this task involve integrating an external SDK, library API, or third-party service?

**Constraint**: If yes, use `search_web` to verify current API patterns, required setup steps, or known constraints BEFORE finalizing the plan. Do NOT assume SDK interfaces from training data.

**Constraint**: Do NOT use `search_web` for internal architecture decisions or standard language features.

{{#if (eq taskType "design-system")}}
{{#if hasUi}}
{{> jobs/code/nodes/plan/injections/ui-source-inventory}}
{{else}}
**FOR `design-system` TASKS (visualTier-driven):**

1. **VISUAL TIER OBSERVATION**
   - Observe the visual tier policies in the basis section
   - For each policy layer present, identify the concrete constraints it defines

2. **TOKEN DERIVATION**
   - For each visual tier layer, derive concrete token values that satisfy the layer's constraints
   - Token categories to derive: spacing scale, color palette, typography scale, surface treatments, interaction behaviors
   - Constraint: Do NOT invent values outside what the policy constraints permit
   - Constraint: If a layer is absent from the basis, do NOT derive tokens for that category

3. **INTEGRATION CHAIN**
   - Observe the styling framework from project config (installed by setup task)
   - Plan: framework theme config extension + global CSS entry point with token imports
   - Each file in `create` list with `purpose`
{{/if}}
{{/if}}

{{#if (eq taskType "ui")}}
**FOR `ui` TASKS:**

1. **SKELETON OBSERVATION** (required — regardless of ui-doc availability)
   - Read skeleton files: component structure, element hierarchy, existing classNames
   - Identify sections complex enough to warrant extraction into separate component files
   - Identify repeating patterns (cards, list items) that should become reusable styled components
   - The DOM elements in the skeleton are the contract — plan preserves them, only reorganizes by file

2. **COMPONENT BREAKDOWN DECISION**
   - **Principle**: Component extraction is a file organization choice — the same DOM elements move to a separate file. Extraction is warranted when inline styling would obscure code structure, or when a visual pattern repeats.
   - **Constraint**: Each planned extraction MUST appear in `create` (with `purpose` naming the skeleton section it extracts). Each skeleton file that imports extracted components MUST appear in `modify`.

3. **PARALLEL GROUP ASSIGNMENT**
   - **Principle**: ui tasks that modify disjoint file sets may run concurrently. Tasks with any file overlap must not.
   - **Constraint**: Assign `parallelGroup` to a label that identifies this task's exclusive file set (e.g., the skeleton file name or route). Tasks that share any output file MUST have the same `parallelGroup`; tasks with entirely disjoint files MUST have different values.
   - **Constraint**: When file ownership is ambiguous (e.g., a shared layout or barrel index), assign the same `parallelGroup` — conservative grouping reduces parallelism but prevents concurrent write conflicts.

{{#if hasUi}}
{{> jobs/code/nodes/plan/injections/ui-source-inventory}}

{{else}}
4. **VISUAL HINTS FROM SYSTEM DESIGN**
   - System design is provided as a **visual hint source only**
   - Extract: page layouts, component sizing, color/typography mentions, spacing constraints
   - IGNORE: functional requirements, API contracts, state management, business logic
   - If no visual hints found, fall back to CSS framework conventions
   - Extracted visual requirements drive the `implementation` entries below

{{/if}}
{{/if}}

{{#unless (or (eq taskType "ui") (eq taskType "design-system"))}}
**FOR NON-UI TASKS:**

1. **📂 DIRECTORY STRUCTURE ANALYSIS**
   - Observe existing patterns
   - Identify existing similar modules

2. **📋 REQUIREMENTS ANALYSIS**
   - Extract requirements from API Contract / specs
   - Identify dependencies

3. **📦 DEPENDENCY ANALYSIS**

**Observation target**: Does the design document reference specific packages or libraries that are NOT part of the standard library and NOT widely-known open-source packages? These are **design-prescribed dependencies** — packages the design document mandates for this project.

**Protocol**:
1. Identify packages referenced in the design document (import statements, backtick-quoted paths, code examples)
2. Classify each: well-known (in training data) vs design-prescribed (organization-internal, private, project-specific)
3. For design-prescribed dependencies present in the dependency manifest, discover their exported API via tools before finalizing the plan (see `plan-tools-batch` for the observation protocol — `search_code(include_dependencies:true)` on `node_modules/{pkg}/**/*.d.ts` for TS/JS, `go doc` for Go, etc.)
4. For design-prescribed dependencies NOT in the manifest, attempt installation via `run_command`, then discover the API
5. Record the observed import path and exact signatures **inline** in the relevant `implementation.modify`/`create` entry's `purpose` or `changes` — whichever entry uses the package. Execute reads from that natural-language description; there is no separate structured field.

**Constraint**: Design-prescribed dependencies MUST be used by the modules that need them. Do NOT substitute with standard library or alternative packages. Inline the import path in the entry so the substitution cannot happen silently.

**Constraint**: Do NOT assume or guess design-prescribed dependency APIs from naming conventions. Observe the actual exported API via tools first.

**Constraint**: If installation fails, use the design document's code examples and usage patterns as the API reference — inline the prescribed import paths in the `purpose`/`changes` of the entry that uses the package so CodeGen writes the correct imports.

⚠️ **Blind spot**: The instinct is to skip design-prescribed dependencies and use familiar alternatives — especially when they are absent from the dependency manifest. Design-prescribed packages exist for a reason. Attempt installation first; if that fails, the design document's own code examples are the authoritative API reference.
{{/unless}}

────────────────────────────────────────────────────────────────────────────────
## ✅ FINAL CHECKLIST
────────────────────────────────────────────────────────────────────────────────

Before outputting, verify:

- [ ] `<plan>` section contains valid JSON
- [ ] All files belong to YOUR task scope (no shared entry points)
- [ ] No duplicate modules (checked directory tree)
- [ ] Cross-boundary deps use local interfaces, not full implementations
- [ ] Shared utilities in dedicated files, not inlined in multiple modules
- [ ] Every design-prescribed package's import path and observed signatures appear inline in the `purpose`/`changes` of the `create`/`modify` entry that uses it
- [ ] For `design-system`: token inventory complete (keys + actual values)
- [ ] For `ui`: skeleton files in `modify` (to update imports after component extraction); extracted component files in `create`
- [ ] For `ui`: `parallelGroup` assigned — same value for tasks sharing files, different values for disjoint file sets
- [ ] For `ui` (no ui-doc): visual hints extracted from system design (or noted as absent)
- [ ] For `ui` (with ui-doc): assets listed if needed, design tokens specified with actual values
- [ ] Security: input validation boundaries, secrets management, error exposure considered
- [ ] Mock adapters: external service adapters include mock implementations with env var switching

────────────────────────────────────────────────────────────────────────────────
## ⚠️ OUTPUT CONSTRAINTS
────────────────────────────────────────────────────────────────────────────────

### Internal reasoning targets (do NOT emit as prose)

Before writing `<plan>`, internally cover:
1. **Directory patterns** — What structure exists? Where do similar modules live?
2. **Existing modules** — Does similar functionality already exist? → MODIFY, not CREATE
3. **Asset requirements** — What assets does ui-assets.json specify for this task?
4. **Task scope** — Are all planned files within YOUR task's responsibility?

**Constraint**: Do NOT copy example text. Reason about the ACTUAL project context provided.

### `<plan>` Section

**Principle**: Valid JSON following the schema above.

**Constraints**:
- All created files MUST belong to your task's scope (no shared entry points)
- `location` must be derived from observed directory patterns
- `assets` must match EXACT paths from ui-assets.json
- Do NOT invent assets not in ui-assets.json

────────────────────────────────────────────────────────────────────────────────
