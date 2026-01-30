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
| **Integration intent** | "used by X module", "called from Y service" |
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
existing modules, design specs, integration points, etc.)
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
        "purpose": "[what this module does]",
        "integrates_with": "[file that MUST import/use this - REQUIRED]"
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
## 🔗 INTEGRATION RULES
────────────────────────────────────────────────────────────────────────────────

**Every module you CREATE must be USED.**

| What you create | integrates_with | What gets REPLACED |
|-----------------|-----------------|-------------------|
| UI Component | Page, parent component | Inline JSX/HTML section |
| Utility function | Service/component | Inline logic/validation |
| Service class | Controller | Scattered fetch/API calls |
| Hook | Component | Inline state management |

**⚠️ `integrates_with` triggers TWO mandatory actions:**
1. **IMPORT**: CodeGen adds import statement to target file
2. **REPLACE**: CodeGen removes existing inline code and uses the new module

**Without proper `integrates_with` → module created but never used → TASK FAILURE**

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
   - Determine integration points

2. **📦 ASSET INVENTORY**
   - Search ui-assets.json for assets related to this task
   - List ALL assets with source → destination mappings
   - If none found: note "No assets required"

3. **📐 LAYOUT & COMPONENT SPECS**
   - Extract layout intentions from ui-spec.json
   - List visual properties, typography, interaction states
   - Note design token references

4. **🔗 INTEGRATION ANALYSIS**
   - Where will new modules be imported?
   - What existing code will be replaced?
{{/if}}

{{#unless hasUiDoc}}
**FOR NON-UI TASKS:**

1. **📂 DIRECTORY STRUCTURE ANALYSIS**
   - Observe existing patterns
   - Identify existing similar modules

2. **📋 REQUIREMENTS ANALYSIS**
   - Extract requirements from API Contract / specs
   - Identify dependencies

3. **🔗 INTEGRATION ANALYSIS**
   - Where will new modules be used?
{{/unless}}

────────────────────────────────────────────────────────────────────────────────
## ✅ FINAL CHECKLIST
────────────────────────────────────────────────────────────────────────────────

Before outputting, verify:

- [ ] `<analysis>` section contains thorough reasoning
- [ ] `<plan>` section contains valid JSON
- [ ] Every `create` item has `integrates_with` field
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
4. **Integration points** - Where will new modules be imported? What gets replaced?

**Constraint**: Do NOT copy example text. Analyze the ACTUAL project context provided.

### `<plan>` Section

**Principle**: Valid JSON following the schema above.

**Constraints**:
- Every `create` item MUST have `integrates_with` field
- `location` must be derived from observed directory patterns
- `assets` must match EXACT paths from ui-assets.json
- Do NOT invent assets not in ui-assets.json

────────────────────────────────────────────────────────────────────────────────
