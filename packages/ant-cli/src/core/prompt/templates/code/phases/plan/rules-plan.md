## Your Task

Generate a **concrete implementation plan** for this task.

────────────────────────────────────────────────────────────────────────────────
## 🎯 Responsibility Split: Plan vs CodeGen
────────────────────────────────────────────────────────────────────────────────

Plan and CodeGen handle different types of decisions.

### 📋 Plan Decides (Structural - CodeGen MUST follow)

| Decision Area | Why Plan Decides |
|---------------|------------------|
| **File paths/names** | Prevents duplicates, ensures consistency |
| **Integration points** | Requires holistic view of architecture |
| **Replacement targets** | Requires analysis of existing code |
| **Module separation** | Architecture-level decision |
| **Asset destinations** | Project structure consistency |

### 🔧 CodeGen Decides (Implementation - autonomy)

| Decision Area | Why CodeGen Decides |
|---------------|---------------------|
| **Variable/function names** | Context-dependent during implementation |
| **Type definitions** | Determined while writing actual code |
| **Styling details** | Implementation-level concern |
| **Error handling** | Requires runtime context |
| **Performance optimization** | Requires implementation context |
| **Import formats** | Follow existing code patterns |

### ⚠️ Boundary Cases: Plan hints, CodeGen decides

| Situation | Plan's Role | CodeGen's Role |
|-----------|-------------|----------------|
| **State management needed** | Hint: "may need state" | Choose specific approach |
| **Helper utilities needed** | Hint: "may need helpers" | Define inline or separate file |
| **Unlisted file needed** | - | Create and explicitly report |

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
- ✅ Be specific and concrete
- ✅ Reference existing code when modifying
- ✅ Follow existing directory structure (no duplicates)
- ❌ DO NOT simplify endpoint paths (`/rooms/create` → `/rooms`)
- ❌ DO NOT rename fields for "consistency"
- ❌ DO NOT apply "best practices" that differ from spec

────────────────────────────────────────────────────────────────────────────────
## 📋 MANDATORY OUTPUT: FILES CONTRACT
────────────────────────────────────────────────────────────────────────────────

**EVERY plan MUST end with a structured FILES CONTRACT section.**

This section is PARSED by the system and passed to CodeGen as binding instructions.

```
═══════════════════════════════════════════════════════════════════════════════
## FILES CONTRACT
═══════════════════════════════════════════════════════════════════════════════

### CREATE FILES:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. path: [exact/path/to/file]                                               │
│    purpose: [what this file does]                                           │
│    integrates_in: [entry point or consumer file]                            │
│    replaces: "[existing code to replace]" OR "nothing"                      │
└─────────────────────────────────────────────────────────────────────────────┘

### MODIFY FILES:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. path: [file to modify]                                                   │
│    action: [what to do]                                                     │
│    changes:                                                                 │
│      - [specific change 1]                                                  │
│      - [specific change 2]                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

### ASSET OPERATIONS (if any):
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. cp [source] → [destination]                                              │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
```

**CONTRACT RULES (CodeGen MUST follow):**
- ✅ Create files at EXACT paths/names specified
- ✅ Perform ALL integration steps specified
- ✅ Replace ALL targets specified
- ❌ DO NOT use different file names than specified

**CodeGen Autonomy (Plan does NOT dictate):**
- Implementation details (variable names, types, logic)
- Styling specifics (CSS classes, responsive handling)
- Auxiliary files not in Plan (helpers, types) - create if needed
- **Modularization**: If a file becomes too large, CodeGen may split into submodules

**Modularization Rule:**
Plan specifies **entry points** (paths that consumers import from).
CodeGen may create subdirectories/submodules, but the entry point MUST exist and re-export.

```
Plan: "Create src/utils/api.ts"

CodeGen finds implementation is large → Allowed to modularize:
src/utils/
├── api.ts              ← Entry point (MUST exist, re-exports)
└── api/
    ├── auth.ts         ← Submodule
    ├── users.ts        ← Submodule
    └── products.ts     ← Submodule

External imports unchanged: import { ... } from 'src/utils/api'
```

────────────────────────────────────────────────────────────────────────────────

### Output Format:

{{#if hasUiDoc}}
**FOR UI TASKS - Your plan MUST include these sections IN ORDER:**

#### 1. 📂 CODEBASE STRUCTURE ANALYSIS

**FIRST**, analyze the existing codebase structure to maintain consistency:

```
## Codebase Structure Analysis

Existing files found:
- [List key existing component files and their paths]

Pattern detected:
- Components location: `components/` or `app/components/` or `src/components/`
- Sections location: `components/sections/` or `app/sections/`

**DECISION**: New files for this task will follow [specify the exact pattern]
```

**CRITICAL**: 
- Check `projectCodeContext` to see existing file locations
- DO NOT create duplicate directory structures
- Follow the existing pattern for similar files

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.json for assets related to this section/component
- List ALL assets with exact paths: `asset-id: source → destination`
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.json for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout structure from ui-spec.json (grid/flex, responsive breakpoints)
- List each component with visual properties, typography, interactive states
- Note design token references

#### 4. 📋 FILES CONTRACT (MANDATORY)

**This is the BINDING CONTRACT for CodeGen. Use the exact format from above.**

```
═══════════════════════════════════════════════════════════════════════════════
## FILES CONTRACT
═══════════════════════════════════════════════════════════════════════════════

### CREATE FILES:
[List each file with: path, purpose, integrates_in, replaces]

### MODIFY FILES:
[List each file with: path, action, changes]

### ASSET OPERATIONS:
[List cp commands for each asset]

═══════════════════════════════════════════════════════════════════════════════
```

**⚠️ CRITICAL**: The FILES CONTRACT section is NOT optional. 
Every UI task plan MUST end with this structured contract.

{{/if}}
