## Your Task

Generate a **concrete implementation plan** for this task.

────────────────────────────────────────────────────────────────────────────────
## 🎯 Responsibility Split: Plan vs CodeGen
────────────────────────────────────────────────────────────────────────────────

Plan and CodeGen handle **different levels of decisions**.

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

```
Plan: "Create [Module] in [area], used by [Consumer]"
       ↓
CodeGen: 
  1. list_files → finds existing directory pattern
  2. read_file → finds integration point in target file
  3. Creates file at correct path (matching existing conventions)
  4. Modifies target file (correct integration)
```

────────────────────────────────────────────────────────────────────────────────

### What to Include:

1. **API Integration** (if applicable):
   - EXACT endpoint paths from API Contract (copy verbatim)
   - EXACT request/response types
   - Example: "Call `POST /rooms/create` with `CreateRoomRequest { name, maxPlayers }`"

2. **Dependencies** (if new ones needed):
   - Library names and purpose

3. **Implementation Approach**:
   - Key components/functions
   - Data flow

### Rules:

- ✅ Copy API Contract specifications EXACTLY (endpoints, field names, types)
- ✅ Be specific about WHAT to create and WHY
- ✅ Describe WHERE semantically (not exact paths)
- ✅ Reference existing patterns from directory tree
- ❌ DO NOT hardcode exact paths (CodeGen verifies with tools)
- ❌ DO NOT assume directory structure without checking tree

────────────────────────────────────────────────────────────────────────────────
## 📋 MANDATORY OUTPUT: IMPLEMENTATION GUIDE
────────────────────────────────────────────────────────────────────────────────

**🚨 CRITICAL: EVERY plan MUST end with an IMPLEMENTATION GUIDE section.**

**A plan WITHOUT an IMPLEMENTATION GUIDE is INCOMPLETE and INVALID.**

CodeGen cannot execute properly without this structured guide. If you skip it,
the created modules will NOT be integrated into the codebase (not imported, not used).

```
═══════════════════════════════════════════════════════════════════════════════
## IMPLEMENTATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

### CREATE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. name: [ModuleName]                                                       │
│    type: component | util | hook | api | service | class | ...              │
│    location: [semantic area - e.g., "components", "utils", "services"]      │
│    purpose: [what this module does]                                         │
│    integrates_with: [file that MUST import/use this] ← REQUIRED!            │
└─────────────────────────────────────────────────────────────────────────────┘

### MODIFY:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. target: [semantic description - e.g., "AuthService module"]              │
│    action: [what to do]                                                     │
│    changes:                                                                 │
│      - [specific change 1]                                                  │
│      - [specific change 2]                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

### ASSET OPERATIONS (if any):
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. asset: [asset description]                                               │
│    source: [source path from ui-assets.json]                                │
│    destination: [EXACT dest path from ui-assets.json]  ← MUST match dest!   │
└─────────────────────────────────────────────────────────────────────────────┘

### DESIGN TOKEN CONFIGURATION (if ui-tokens.json provided):
┌─────────────────────────────────────────────────────────────────────────────┐
│ framework: [detected framework - Tailwind/CSS Variables/SCSS/etc.]          │
│ config_file: [semantic location - e.g., "tailwind config", "globals css"]   │
│ action: [create | update]                                                   │
│ tokens_to_apply:                                                            │
│   - colors: [list key color tokens]                                         │
│   - spacing: [list key spacing tokens]                                      │
│   - typography: [list key font tokens]                                      │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
```

────────────────────────────────────────────────────────────────────────────────
### 🔗 `integrates_with` + REPLACEMENT PRINCIPLE
────────────────────────────────────────────────────────────────────────────────

**Every module you CREATE must be USED and must REPLACE any existing inline code.**

| What you create | integrates_with | What gets REPLACED |
|-----------------|-----------------|-------------------|
| UI Component | Page, parent component | Inline JSX/HTML section |
| Utility function | Service/component | Inline logic/validation |
| Service class | Controller | Scattered fetch/API calls |
| Hook | Component | Inline state management |

**⚠️ `integrates_with` triggers TWO mandatory actions:**
1. **IMPORT**: CodeGen adds import statement to target file
2. **REPLACE**: CodeGen removes existing inline code and uses the new module

```
"Module file created" ≠ "Task complete"
"Module created + imported + REPLACES inline code" = "Task complete"
```

**Plan Pattern:**
```
CREATE:
  name: [ModuleName]
  integrates_with: [target file]  ← MUST import AND replace existing inline code

MODIFY:
  target: [same target file]
  action: REPLACE inline implementation with module
  changes:
    - Add import statement
    - REMOVE existing inline code for this functionality
    - ADD module usage in same position
```

**⚠️ Without MODIFY specifying REPLACE → inline code remains → TASK FAILURE**

────────────────────────────────────────────────────────────────────────────────
### 🚫 DUPLICATE PREVENTION
────────────────────────────────────────────────────────────────────────────────

**Before specifying CREATE, check the directory tree for existing similar modules.**

- ❌ DO NOT create new module if similar functionality already exists (different name, same purpose)
- ✅ If similar module exists, use MODIFY instead of CREATE

**Check for:**
- Same functionality with different names
- Existing utils/helpers that already do what you need
- Previously created modules in earlier tasks

────────────────────────────────────────────────────────────────────────────────

**GUIDE PRINCIPLES:**
- ✅ EVERY CREATE must have `integrates_with`
- ✅ Check directory tree for existing similar modules before CREATE
- ✅ Describe WHAT and WHY clearly
- ✅ Use semantic locations (CodeGen finds exact paths)
- ❌ DO NOT create duplicate modules
- ❌ DO NOT skip IMPLEMENTATION GUIDE section

────────────────────────────────────────────────────────────────────────────────

### Output Format:

{{#if hasUiDoc}}
**FOR UI TASKS - Your plan MUST include these sections IN ORDER:**

#### 1. 📂 DIRECTORY STRUCTURE ANALYSIS

**FIRST**, analyze the directory tree to understand existing patterns:

```
## Directory Structure Analysis

From directory tree:
- Source code pattern: [observed pattern from directory tree]
- Components pattern: [observed pattern]
- Utils pattern: [observed pattern]
- Existing similar modules: [list any that might overlap with this task]

**DECISION**: New files will follow the [pattern] convention
**REUSE**: [List existing modules to reuse instead of creating new ones]
```

**CRITICAL**: 
- Check `directoryTree` for existing structure AND existing similar modules
- If similar util/component already exists, DO NOT create duplicate
- Identify integration points (where new modules will be used)

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.json for assets related to this section/component
- List ALL assets with semantic mappings
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.json for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout intentions from ui-spec.json (arrangement, positioning, visual behaviors, responsive changes)
- List each component with visual properties, typography, interaction states
- Note design token references
- Interpret design intentions and decide implementation approach

#### 4. 📋 IMPLEMENTATION GUIDE (MANDATORY - DO NOT SKIP)

**🚨 This section is REQUIRED. A plan without IMPLEMENTATION GUIDE is INVALID.**

```
═══════════════════════════════════════════════════════════════════════════════
## IMPLEMENTATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

### CREATE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. name: [ComponentName]                                                    │
│    type: component                                                          │
│    location: components area                                                │
│    purpose: [what this component does]                                      │
│    integrates_with: [parent page/component that MUST use this] ← REQUIRED!  │
└─────────────────────────────────────────────────────────────────────────────┘

### MODIFY:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. target: [page/component that will use the new module]                    │
│    action: Import and render new component                                  │
│    changes:                                                                 │
│      - Add import statement                                                 │
│      - Add component to render tree                                         │
└─────────────────────────────────────────────────────────────────────────────┘

### ASSET OPERATIONS:
[List assets with semantic destinations, or "None required"]

═══════════════════════════════════════════════════════════════════════════════
```

────────────────────────────────────────────────────────────────────────────────
#### 5. 📋 FINAL CHECKLIST (MANDATORY)
────────────────────────────────────────────────────────────────────────────────

**Before completing your plan, verify:**

- [ ] IMPLEMENTATION GUIDE section exists
- [ ] Every CREATE has `integrates_with` field
- [ ] MODIFY section includes "REPLACE inline code" action
- [ ] For hierarchical modules: parent → entry point, children → parent
- [ ] No duplicate modules (checked directory tree)

**UI Component Hierarchy:**
```
[entry point]
  └── X.tsx (parent)  ← integrates_with: entry point, REPLACES inline section
        └── XCard.tsx (child)  ← integrates_with: X.tsx
```

{{/if}}

{{#unless hasUiDoc}}
**FOR NON-UI TASKS - Your plan MUST end with IMPLEMENTATION GUIDE:**

```
═══════════════════════════════════════════════════════════════════════════════
## IMPLEMENTATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

### CREATE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. name: [ModuleName]                                                       │
│    type: service | util | api | class | ...                                 │
│    location: [semantic area]                                                │
│    purpose: [what this module does]                                         │
│    integrates_with: [caller/consumer module] ← REQUIRED!                    │
└─────────────────────────────────────────────────────────────────────────────┘

### MODIFY:
[List targets that need to import/use new modules]

═══════════════════════════════════════════════════════════════════════════════
```

**⚠️ CHECKLIST:**
- [ ] IMPLEMENTATION GUIDE section exists
- [ ] Every CREATE has `integrates_with`
- [ ] Checked for existing similar modules in directory tree

{{/unless}}
