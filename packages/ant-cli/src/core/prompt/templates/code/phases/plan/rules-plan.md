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
Plan: "Create UserValidator in utils/validation area, used by AuthService"
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

**EVERY plan MUST end with a structured IMPLEMENTATION GUIDE section.**

This section provides **semantic guidance** for CodeGen to execute with actual file system verification.

```
═══════════════════════════════════════════════════════════════════════════════
## IMPLEMENTATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

### CREATE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. name: [ComponentName]                                                    │
│    type: component | util | hook | api | page | ...                         │
│    location: [semantic area - e.g., "components", "utils", "api"]           │
│    purpose: [what this file does]                                           │
│    integrates_with: [file that MUST import/use this - TRIGGERS MODIFY]      │
└─────────────────────────────────────────────────────────────────────────────┘

**⚠️ `integrates_with` = MANDATORY modification.**
If you specify `integrates_with: X`, CodeGen MUST modify X to import and use the new module.
This is NOT optional metadata - it triggers a required MODIFY action.

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
│    source: [source path from ui-assets]                                     │
│    destination: [semantic destination - e.g., "public/images"]              │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
```

**GUIDE PRINCIPLES:**
- ✅ Describe WHAT and WHY clearly
- ✅ Use semantic locations (CodeGen finds exact paths)
- ✅ Specify integration relationships
- ❌ DO NOT hardcode exact file paths (CodeGen verifies)

**CodeGen Responsibilities (with tools):**
- Use `list_files` to find existing directory patterns
- Use `read_file` to understand integration points
- Determine exact paths based on existing conventions
- Ensure NO duplicate files/components created

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
- Pages pattern: [observed pattern]
- Utils pattern: [observed pattern]

**DECISION**: New files will follow the [pattern] convention
```

**CRITICAL**: 
- Check `directoryTree` to see existing structure
- Identify where similar files are located
- CodeGen will verify and use exact paths

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.json for assets related to this section/component
- List ALL assets with semantic mappings
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.json for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout structure from ui-spec.json (grid/flex, responsive breakpoints)
- List each component with visual properties, typography, interactive states
- Note design token references

#### 4. 📋 IMPLEMENTATION GUIDE (MANDATORY)

**This is the GUIDE for CodeGen. Use the format from above.**

```
═══════════════════════════════════════════════════════════════════════════════
## IMPLEMENTATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

### CREATE:
[List each file with: name, type, location (semantic), purpose, integrates_with]

### MODIFY:
[List each target with: target (semantic), action, changes]

### ASSET OPERATIONS:
[List assets with semantic destinations]

═══════════════════════════════════════════════════════════════════════════════
```

**⚠️ CRITICAL**: The IMPLEMENTATION GUIDE section is NOT optional. 
Every UI task plan MUST end with this structured guide.

{{/if}}
