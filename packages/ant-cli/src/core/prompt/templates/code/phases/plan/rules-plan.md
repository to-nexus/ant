## Your Task

Generate a **concrete implementation plan** for this task.

### What to Include:

1. **API Integration** (if applicable):
   - EXACT endpoint paths from API Contract (copy verbatim)
   - EXACT request/response types
   - Example: "Call `POST /rooms/create` with `CreateRoomRequest { name, maxPlayers }`"

2. **Files to Create/Modify**:
   - Specific file paths
   - Purpose of each file
   - **Integration points**: New files must be connected to their consumers (imported/registered/called)

3. **Implementation Approach**:
   - Key components/functions
   - Data flow
   - Integration points

4. **Dependencies** (if new ones needed):
   - Library names
   - Purpose

### Rules:

- ✅ Copy API Contract specifications EXACTLY (endpoints, field names, types)
- ✅ Be specific and concrete
- ✅ Reference existing code when modifying
- ✅ New files must include integration (import/register in consumer)
- ✅ If creating new file, plan to REPLACE any existing inline code (not add alongside)
- ✅ Follow existing directory structure (no duplicates)
- ❌ DO NOT simplify endpoint paths (`/rooms/create` → `/rooms`)
- ❌ DO NOT rename fields for "consistency"
- ❌ DO NOT apply "best practices" that differ from spec
- ❌ DO NOT create files without planning where they are used
- ❌ DO NOT create new file if similar inline code exists without replacing it

### Output Format:

{{#if hasUiDoc}}
**FOR UI TASKS:**

Your plan MUST include these sections:

#### 1. 📂 CODEBASE STRUCTURE ANALYSIS

**FIRST**, analyze the existing codebase structure to maintain consistency:

```
## Codebase Structure Analysis

Existing files found:
- [List key existing component files and their paths]

Pattern detected:
- Components location: `components/` or `app/components/` or `src/components/`
- Sections location: `components/sections/` or `app/sections/`
- Other patterns: [any other relevant patterns]

**DECISION**: New files for this task will follow [specify the exact pattern]
```

**CRITICAL**: 
- Check `projectCodeContext` to see existing file locations
- DO NOT create duplicate directory structures
- Follow the existing pattern for similar files

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.json for assets related to this section/component
- List ALL assets with exact paths: `asset-id: source → destination`
- Provide `cp` commands for each asset
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.json for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout structure from ui-spec.json (grid/flex, responsive breakpoints)
- List each component with:
  - Visual properties (background, border, padding, etc.)
  - Typography (size, weight, color)
  - Interactive states (if applicable)
  - Asset usage (which assets go where)
- Note design token references

#### 4. 📋 IMPLEMENTATION PLAN

List files to create/modify with integration points.

**For each component file:**
- Path to create
- What it implements
- **Where it will be imported/rendered**
- **If replacing inline code: specify which file and section to DELETE**

Keep it actionable and precise.

{{/if}}
