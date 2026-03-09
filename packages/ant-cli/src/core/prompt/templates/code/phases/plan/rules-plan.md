{{#if hasTools}}
{{> code/base/injections/plan-tools-batch}}
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

**Your response MUST follow this EXACT structure:**

```
<analysis>
(Your Chain-of-Thought reasoning here - analyze directory structure, 
existing modules, design specs, dependencies, etc.)
</analysis>

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

────────────────────────────────────────────────────────────────────────────────
## 📐 JSON SCHEMA FOR `<plan>`
────────────────────────────────────────────────────────────────────────────────

```json
{
  "task": {
    "id": "[task identifier from input]",
    "goal": "[one-line goal derived from analysis]"
  },
  "implementation": {
    "create": [
      {
        "name": "[module name]",
        "type": "[component | util | hook | api | service | class]",
        "location": "[semantic area - observe from directory tree]",
        "purpose": "[what this module does]"
      }
    ],
    "modify": [
      {
        "target": "[file path or semantic description]",
        "action": "[what to do]",
        "changes": ["[specific change 1]", "[specific change 2]"]
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
    "colors": ["[key color tokens to use]"],
    "typography": ["[key typography tokens]"],
    "spacing": ["[key spacing tokens]"]
  }
}
```

────────────────────────────────────────────────────────────────────────────────
## 📐 MODIFY FIELD CONSTRAINT
────────────────────────────────────────────────────────────────────────────────

**Principle**: `modify.action` and `modify.changes` describe WHAT to change, not HOW to execute it. CodeGen decides the operational steps.

**Constraint**: Do NOT include tool execution instructions in MODIFY fields (e.g., "Read existing content first", "Use read_file to check", "Run list_files"). State only the intended change.

────────────────────────────────────────────────────────────────────────────────
## 🔒 TASK SCOPE PRINCIPLE
────────────────────────────────────────────────────────────────────────────────

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

**Constraint**: Files created by a prior exclusive task (e.g., shared foundation) are a stable contract. Do NOT plan MODIFY on them. If the established types or interfaces are insufficient for your needs, define supplementary types within YOUR module's scope.

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

{{> code/base/injections/secure-coding}}

────────────────────────────────────────────────────────────────────────────────
## 📝 ANALYSIS SECTION GUIDE
────────────────────────────────────────────────────────────────────────────────

In your `<analysis>` section, cover:

### External Dependency Verification

**Observation target**: Does this task involve integrating an external SDK, library API, or third-party service?

**Constraint**: If yes, use `search_web` to verify current API patterns, required setup steps, or known constraints BEFORE finalizing the plan. Do NOT assume SDK interfaces from training data.

**Constraint**: Do NOT use `search_web` for internal architecture decisions or standard language features.

{{#if hasUiDoc}}
**FOR UI TASKS:**

1. **📂 DIRECTORY STRUCTURE ANALYSIS**
   - Observe existing patterns from directory tree
   - Identify existing similar modules (avoid duplicates)

2. **📦 ASSET INVENTORY**
   - Search ui-assets.json for assets related to this task
   - List ALL assets with source → destination mappings
   - If none found: note "No assets required"

3. **📐 LAYOUT & COMPONENT SPECS**
   - Extract layout intentions from ui-spec.json
   - List visual properties, typography, interaction states
   - Note design token references
{{/if}}

{{#unless hasUiDoc}}
**FOR NON-UI TASKS:**

1. **📂 DIRECTORY STRUCTURE ANALYSIS**
   - Observe existing patterns
   - Identify existing similar modules

2. **📋 REQUIREMENTS ANALYSIS**
   - Extract requirements from API Contract / specs
   - Identify dependencies

3. **📦 INSTALLED DEPENDENCY ANALYSIS**

**Observation target**: Does the design document reference specific packages or libraries? Is there a dependency manifest in the project (observe directory tree)?

**Protocol**:
1. Read the dependency manifest to identify installed packages
2. Cross-reference design document package references with installed dependencies
3. For each dependency referenced in the design document AND present in the manifest, discover its exported API before finalizing the plan
4. Include concrete API usage decisions (types, functions, patterns) in the plan

**Constraint**: If the design document prescribes a specific package and the manifest confirms it is installed, the plan MUST incorporate that package. Do NOT substitute with standard library or alternative packages.

**Constraint**: Do NOT assume or guess package APIs from naming conventions or training data. Observe the actual exported API first.

**Discrepancy recovery**: If the design document prescribes a specific package but the dependency manifest does NOT list it:

1. This indicates the setup task failed to install the package — do NOT silently substitute with alternatives
2. Observe the design document for the fully-qualified module path (literal import statements or backtick-quoted paths)
3. Attempt to install the missing dependency via `run_command` using the language's standard package installation command with the observed module path
4. If installation succeeds, proceed with API discovery (steps 3-4 above)
5. If installation fails, use the design document's code examples and usage patterns as the API reference — include the prescribed import paths in the plan so CodeGen writes the correct imports

**Constraint**: When the design document contains explicit code examples with import paths and usage patterns for a package, this constitutes sufficient API knowledge to plan with even if the package cannot be installed locally.

⚠️ **Blind spot**: Design documents often reference organization-internal or private packages whose API is unknown to LLMs. The instinct is to skip them and use familiar alternatives — especially when they are absent from the dependency manifest. These packages are prescribed by the design document for a reason. Attempt installation first; if that fails, the design document's own code examples are the authoritative API reference.
{{/unless}}

────────────────────────────────────────────────────────────────────────────────
## ✅ FINAL CHECKLIST
────────────────────────────────────────────────────────────────────────────────

Before outputting, verify:

- [ ] `<analysis>` section contains thorough reasoning
- [ ] `<plan>` section contains valid JSON
- [ ] All files belong to YOUR task scope (no shared entry points)
- [ ] No duplicate modules (checked directory tree)
- [ ] Cross-boundary deps use local interfaces, not full implementations
- [ ] Shared utilities in dedicated files, not inlined in multiple modules
- [ ] For UI: assets are listed if needed
- [ ] For UI: design tokens are specified
- [ ] Security: input validation boundaries, secrets management, error exposure considered

────────────────────────────────────────────────────────────────────────────────
## ⚠️ OUTPUT CONSTRAINTS
────────────────────────────────────────────────────────────────────────────────

### `<analysis>` Section

**Principle**: Free-form reasoning based on ACTUAL context you observe.

Cover these checkpoints:
1. **Directory patterns** - What structure exists? Where do similar modules live?
2. **Existing modules** - Does similar functionality already exist? → MODIFY, not CREATE
3. **Asset requirements** - What assets does ui-assets.json specify for this task?
4. **Task scope** - Are all planned files within YOUR task's responsibility?

**Constraint**: Do NOT copy example text. Analyze the ACTUAL project context provided.

### `<plan>` Section

**Principle**: Valid JSON following the schema above.

**Constraints**:
- All created files MUST belong to your task's scope (no shared entry points)
- `location` must be derived from observed directory patterns
- `assets` must match EXACT paths from ui-assets.json
- Do NOT invent assets not in ui-assets.json

────────────────────────────────────────────────────────────────────────────────
