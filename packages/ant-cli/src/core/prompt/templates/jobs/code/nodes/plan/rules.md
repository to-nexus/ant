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

Per the Output Tag Contract, the first output token must be `<` of a registered tag, so do NOT write any prose before `<plan>` opens. Emit nothing after `</plan>` closes — the plan node terminates at that boundary and the next phase consumes the sealed JSON directly.

### Empty plan — when surface shows no work left (non-negotiable)

If your investigation (file reads / greps / list_files) shows your task's
own surface — every file, symbol, and module your task description claims
— has nothing left to do (the feature is already implemented, the bad
pattern is already absent, the missing module already exists with the
expected exports), you MUST emit the empty plan below and stop. This is
the same contract the variants (error / test-code / verification) follow;
it is a property of the plan node, not of any task type.

```
<plan>
{
  "task": { "id": "task-id", "goal": "Nothing to do" },
  "implementation": { "create": [], "modify": [], "delete": [] }
}
</plan>
```

Do NOT run a verification command (typecheck / build / lint / test) to
"double-check" before emitting the empty plan — emitting a verification-
only batch with no on-disk change is a slice violation. The downstream
verification task owns that gate. Do NOT scrape additional files looking
for work to justify continuing — if your own surface is clean, the task
is done.

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
        "name": "[REQUIRED — concise noun phrase identifying the module, e.g. \"firebase-web-singleton\". The framework uses this verbatim as a child task name when the plan is fanned out into sub-tasks. NOT a path, NOT a placeholder, NOT a verb phrase.]",
        "type": "[component | util | hook | api | service | class]",
        "location": "[semantic area - observe from directory tree]",
        "purpose": "[REQUIRED — what this module does, which packages it imports (with exact import path), and which observed API signatures it calls. Becomes the child task description.]"
      }
    ],
    "modify": [
      {
        "target": "[file path or semantic description]",
        "action": "[REQUIRED — short verb phrase that becomes the child task name when the plan is fanned out into sub-tasks, e.g. \"Add runtime dependencies for shared layer\". NOT a path, NOT a placeholder.]",
        "changes": ["[REQUIRED — array of specific changes, with any observed API signatures the change relies on quoted inline]", "[specific change 2]"]
      }
    ],
    "delete": [
      {
        "target": "[file path or semantic description]",
        "reason": "[REQUIRED — why this is being deleted, e.g. \"Replace with new module\". The framework uses this verbatim as a child task name when the plan is fanned out into sub-tasks.]"
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

⚠️ **Naming contract**: The framework uses your `create[].name` / `modify[].action` / `delete[].reason` (or `batches[].name` when you choose to fan out — see FAN-OUT AT PLAN TIME below) **verbatim** as the child task name and `create[].purpose` / `modify[].changes` (joined) / `delete[].reason` / `batches[].rationale` **verbatim** as the child task description. The system MUST NOT fabricate names — when these REQUIRED fields are missing on an explicit `batches[]` entry, fan-out is rejected and the plan call is re-issued with violation framing. Do NOT use paths-as-names, placeholders (`task-2`, `feature-batch`), or empty strings. Provide a 4-8 word noun/verb phrase that identifies the unit semantically.

Inside a `batches[]` entry, ONLY `name`, `rationale`, and (optional) `requiredFiles` are emitted — not the slice's internal `modify[]` / `create[]` / `delete[]`. The slice's implementation plan is the child plan node's responsibility, not the parent's. See FAN-OUT AT PLAN TIME below.

Design-prescribed package APIs (import paths + observed signatures) are carried inline in the `purpose`/`changes` of whichever `create`/`modify` entry uses them. No separate structured field — execute reads the natural-language description and implements from there.

{{#if (or (eq taskType "feature") (eq taskType "ui") (eq taskType "design-system") (eq taskType "test-code"))}}
────────────────────────────────────────────────────────────────────────────────
## 🌿 FAN-OUT AT PLAN TIME (feature / ui / design-system / test-code)
────────────────────────────────────────────────────────────────────────────────

Decomposition chose the task **set** blind to the code; that boundary stands — you do NOT re-decide which tasks exist. What you own now, having observed the actual codebase, is this one task's **internal unit structure**: whether it is a single unit or several. Your investigation can reveal either that the work resolves into multiple independent units, or that its involvement scope is too large for one execute cycle — neither of which decomposition could see. When **either** holds, fan out via `batches[]`. The two rubrics below are the test: the first (separability) decides whether the work is several independent units worth splitting; the second (single-session capacity) decides whether its involvement scope is too large for one cycle. A **split conclusion from either is sufficient** — capacity can mandate a split the separability rubric alone would bundle (small independent slices still bundle per the separability rubric, but an oversized scope splits regardless).

{{> jobs/code/shared/task-split-rubric }}

{{> jobs/code/shared/plan-batch-capacity }}

### Scheduling fields — REQUIRED per batch

Each `batches[]` entry MUST declare both of:

- **`parallelGroup: string`** — a short, meaningful lane name (e.g. `"ui-shared-comp"`, `"design-tokens"`, `"data-domain"`). Siblings sharing the same `parallelGroup` execute **serially** in the order set by `priorityInParallelGroup`. Siblings with **different** `parallelGroup` values run **concurrently**.
- **`priorityInParallelGroup: number`** — a non-negative integer. Within a lane, the batch with the smaller value dispatches first. Values within a single lane MUST be distinct (e.g. `0, 1, 2` — no duplicates).

**The runtime computes the sub-task's priority as `parentPriority + priorityInParallelGroup`** and uses the LLM-declared `parallelGroup` directly. There is no other channel for declaring the schedule — these two fields are the schedule.

**How to choose lanes.** Put two batches in the **same lane** when one consumes what the other produces (shared types, modules to import, directory layout the consumer expects). Put them in **different lanes** ONLY when you have verified that they are genuinely independent — same parent, no shared output, no shared cross-batch type, **and no shared structural namespace** (below). When in doubt, place them in one lane: the cost of serializing independent work is small; the cost of racing dependent work is large (the consumer is dispatched before the producer exists).

**Shared structural namespace (co-located outputs must agree on structure).** Two batches that write under the SAME dynamic path segment (a parameterized path position whose name both must agree on), OR where one establishes a parent structure the other directly populates, are NOT independent **even when their files do not overlap** — running concurrently they cannot observe each other's structural choice. Put them in the SAME lane, give the batch that ESTABLISHES the structure (the parent segment / directory-skeleton owner) `priorityInParallelGroup: 0`, and record the agreed segment name in `parentReasoning` so the later batch conforms to it. A sibling batch that names the same path position differently produces a structural collision that fails the build though no file is shared. Scope this NARROWLY: an arbitrary common ancestor directory is not a shared structural namespace — over-grouping collapses parallelism.

**How to choose within-lane order.** Set `priorityInParallelGroup` ascending from `0` along the producer → consumer chain inside the lane. The producer that other batches in the same lane depend on takes `0`; its dependents take `1, 2, …`.

The splitting rubric still applies: if two slices are independent *and* small enough to bundle, bundle them per the rubric rather than placing them in two single-batch lanes.

### What `batches[]` carries — slice declaration only

A `batches[]` entry **declares a slice**, it does NOT carry the slice's internal implementation plan. Each declared batch is dispatched as a child task whose own plan node re-investigates the codebase and emits its own flat `implementation` block. The parent's responsibility ends at the slice boundary.

This responsibility split is what keeps the parent's output bounded. Restating the implementation per batch here doubles parent output (every byte appears verbatim in the child's `prePlanText`) and forces a 30K+ token round that risks mid-stream `max_tokens` truncation — the silent failure mode the system recovers from by re-running the same plan call from scratch, billing the cost twice.

### Scope conservation across the split

**Constraint**: The union of children's declared responsibilities MUST equal the parent's responsibilities. Every responsibility the parent owns is either (a) absorbed into a named child's `rationale`, or (b) carried by a dedicated child. Uncovered responsibilities are a schema violation — the parent's scope cannot shrink just because the split fanned out.

**Constraint**: When the parent owns **cross-cutting responsibilities** (e.g. an integration/wiring task: framework root entries, route registries, dependency wiring, mandatory accompaniments of an adopted library/framework), at least one child's `rationale` MUST explicitly name those cross-cutting items. Zone-shaped or feature-shaped slices on their own do NOT cover cross-cutting work — that work is horizontal across the slices and falls into the gap unless explicitly placed.

⚠️ **Blind spot**: When the natural split axis is by zone, package, or feature area, cross-cutting responsibilities (root entry boundary, framework-required entrypoints, library accompaniments) are EASILY left out of every child's `rationale` — each child sees its zone as the whole job. State the cross-cutting items in the `rationale` of the child that absorbs them (or emit a dedicated child for them); do not assume they will surface in any single zone-shaped slice on their own.

### How to emit `batches[]`

The system does NOT auto-convert flat plans — the split-or-bundle call is yours, and it is a **required, explicit decision**, not a default to flat. Before you emit, resolve what the two rubrics above yield: a single investigation unit, or several. Whenever the symmetric-articulation rule applies (≥ 2 implementation entries spanning ≥ 2 distinct files), a flat `implementation` block is valid ONLY when you have articulated the single shared investigation footprint that rule demands (in `task.goal` / `bundleRationale`); a flat plan emitted *without* that articulation, where the rule applies, is the failure mode this section exists to prevent. Once resolved: emit `batches[]` to split, or a flat `implementation` block to bundle — which then executes as one task regardless of file count, package count, or domain count.

**Constraint**: `parentReasoning` MUST name the concrete benefit (failure isolation / scope boundary / cognitive mode separation) for this specific task AND record the **cross-batch contracts** the parent observed (shared export names, file paths the children must agree on, shared types). Children read this verbatim — it is the only channel for sibling-drift prevention.

**Constraint**: Each `batches[].name` is a **noun phrase** identifying the unit (e.g. `"firebase-web-singleton"`, `"axios-http-client-instance"`). Do NOT include framework verbs (`Fix`, `Create`, `Add`, `Update`, `Remove`) — verb-style framing is owned by the runtime UI. Do NOT include paths.

**Constraint**: Each `batches[].rationale` MUST be a complete sentence explaining why this batch is one isolated unit per the principle above. Becomes the child task description verbatim.

**Constraint**: Do NOT carry per-batch `modify[]` / `create[]` / `delete[]` arrays inside a `batches[]` entry. Internal implementation is the child plan's responsibility. The parent communicates **slice boundary** (via `name` + `rationale` + optional `requiredFiles`) and **cross-batch contracts** (via `parentReasoning`) — nothing else.

**Schema (when emitted)**:

```
<plan>
{
  "task": { "id": "{{taskId}}", "goal": "..." },
  "parentReasoning": "<concrete benefit + cross-batch contracts: shared export names, file paths children must agree on, shared types>",
  "batches": [
    {
      "name": "[REQUIRED — noun phrase identifying the unit, e.g. \"firebase-web-singleton\". Becomes the child task name verbatim. NOT a verb, NOT a path, NOT a placeholder.]",
      "rationale": "[REQUIRED — why this batch is one isolated unit. Becomes the child task description verbatim.]",
      "parallelGroup": "[REQUIRED — short, meaningful lane name, e.g. \"ui-shared-comp\". Same value across siblings ⇒ serial in this lane; different values ⇒ parallel across lanes.]",
      "priorityInParallelGroup": "[REQUIRED — non-negative integer. Lower runs first within the lane. MUST be distinct from other batches sharing the same parallelGroup.]",
      "requiredFiles": ["[OPTIONAL — files the child plan MUST observe before planning; e.g. interface contracts owned by a sibling. Omit when the child can discover them from the directory tree.]"]
    }
  ]
}
</plan>
```

⚠️ **Naming contract (same as the JSON SCHEMA above)**: The framework uses `batches[].name` and `batches[].rationale` **verbatim** as child task name + description, and routes `batches[].parallelGroup` + `batches[].priorityInParallelGroup` straight onto the runtime scheduling axes. The system MUST NOT fabricate any of these values. Missing or malformed `name` / `rationale` / `parallelGroup` / `priorityInParallelGroup`, or duplicate `priorityInParallelGroup` within the same lane = schema violation = the plan call is re-issued with framing.
{{/if}}

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

{{> jobs/code/base/injections/entry-point-ownership-rule}}

{{> jobs/code/base/injections/execution-context-discipline}}

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
## 🔌 EXISTING-IDENTIFIER CONTRACT
────────────────────────────────────────────────────────────────────────────────

**Principle**: For every identifier already defined in the codebase at the time this task runs — a factory, hook, interface, exported class, type alias, or constant created by an earlier task in this job or by the pre-existing codebase — the **defining file** is the single source of truth for its name, signature, and call shape. Task hierarchy (parent / sibling / foundation) is irrelevant; what matters is whether the file already exists when this task executes.

**Observation target**: Do your `create` / `modify` entries cite an identifier whose defining file already exists in the codebase? This includes outputs of earlier-priority tasks, sub-batches that ran before yours, and files present before this job started.

**Constraint**: When the plan cites such an identifier in `purpose` / `changes`, record the **defining file path** inline next to the citation. A bare identifier name with no defining-file hint forces execute into rediscovery via `search_code` and risks pointing execute at a drifted caller of the same identifier elsewhere in the codebase.

**Constraint** (fan-out / batches[] case): When your plan fans out via `batches[]` and a child batch will consume an existing identifier whose defining file is not in the directory tree your parent observed, list that defining file in the child batch's `requiredFiles` so the child's plan phase observes it before planning. This is the structured channel parallel to the inline `purpose` / `changes` path above — use whichever fits the plan shape.

**Constraint**: Do NOT implement (or plan implementation of) a consumed existing identifier from memory or inferred naming. Observe the defining file first — at plan time for path sketch, at execute time for exact signature verification.

⚠️ **Blind spot**: When a consumed identifier and its callers land in the codebase at different times (different tasks / different turns within one task), method names and signatures easily drift. The implementation author assumes a name like `subscribe(symbol, callback)` while the defining file declares `subscribe(symbol)` + `onUpdate(callback)` separately — or a factory `createApiPort(session)` is called as `createApiPort()` because the caller mimicked a drifted earlier caller in the codebase instead of reading the factory's defining file. Inline the defining file's path in your plan entry; execute will read that file as the SSOT and verify the exact shape, ignoring any drifted callers it may also encounter.

{{> jobs/code/base/injections/secure-coding}}

{{!--
  Service Virtualization SSOT — four orthogonal partials gated by
  helpers under `core/prompt/builder/serviceVirtualization/`:
    - contract: hasBusinessConnection
    - data:     hasBusinessConnection × (taskType ∈ feature|ui|design-system)
    - imagery:  hasFrontend × domain==='service' × (taskType ∈ feature|ui|design-system|setup|error|verification)
    - session:  hasBusinessConnection × (taskType ∈ feature|ui|design-system|setup)
  Domain-Branching Locality (I1): the gates are derived in code; the
  templates only see the resulting booleans.
--}}
{{#if serviceVirtualizationContractActive}}
{{> jobs/code/base/injections/service-virtualization-contract}}
{{/if}}

{{#if serviceVirtualizationDataActive}}
{{> jobs/code/base/injections/service-virtualization-data}}
{{/if}}

{{#if serviceVirtualizationImageryActive}}
{{> jobs/code/base/injections/service-virtualization-imagery}}
{{/if}}

{{#if serviceVirtualizationSessionActive}}
{{> jobs/code/base/injections/service-virtualization-session}}
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
- [ ] {{> jobs/code/base/injections/entry-point-ownership-checklist}}
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
- {{> jobs/code/base/injections/entry-point-ownership-checklist}}
- `location` must be derived from observed directory patterns
- `assets` must match EXACT paths from ui-assets.json
- Do NOT invent assets not in ui-assets.json

────────────────────────────────────────────────────────────────────────────────
