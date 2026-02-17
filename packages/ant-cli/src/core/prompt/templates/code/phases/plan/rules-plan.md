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

────────────────────────────────────────────────────────────────────────────────
## 📝 ANALYSIS SECTION GUIDE
────────────────────────────────────────────────────────────────────────────────

In your `<analysis>` section, cover:

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
{{/unless}}

────────────────────────────────────────────────────────────────────────────────
## ✅ FINAL CHECKLIST
────────────────────────────────────────────────────────────────────────────────

Before outputting, verify:

- [ ] `<analysis>` section contains thorough reasoning
- [ ] `<plan>` section contains valid JSON
- [ ] All files belong to YOUR task scope (no shared entry points)
- [ ] No duplicate modules (checked directory tree)
- [ ] For UI: assets are listed if needed
- [ ] For UI: design tokens are specified

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
