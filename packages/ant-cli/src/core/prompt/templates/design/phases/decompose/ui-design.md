# UI Design Task Decomposition (Chapter-Based)

## Your Role

Analyze UI complexity and break **EACH document** (ui-tokens.md, ui-assets.md, ui-spec.md) into **chapter-based tasks**.

**Same philosophy as System Design**: Multiple tasks append to the SAME file sequentially.

## Input Context

{{#if uiContext}}
{{{uiContext}}}
{{/if}}

**Available Resources**:
- Reference screens: {{screenCount}}
- Component snapshots: {{componentCount}}
- Asset files: {{assetCount}}

---

## Task Strategy Decision

### Strategy 1: Simple (3 tasks - for simple UIs)

**Use when**:
- Single page or 2-3 simple screens
- < 10 components, < 20 assets
- **EACH document** fits in ~600 lines (~7K tokens, safe for Sonnet 8K limit)

**Tasks**:
1. `ui-tokens` (priority 100) → **ui-tokens.md** (complete, MAX 200 lines)
2. `ui-assets` (priority 200) → **ui-assets.md** (complete, MAX 150 lines)
3. `ui-spec` (priority 300) → **ui-spec.md** (complete spec, MAX 600 lines)

---

### Strategy 2: Chapter-Based (6+ tasks - for complex UIs)

**Use when**:
- Multiple pages/screens (5+), many components (10+), many assets (20+)
- **ANY document** would exceed ~600 lines

**Tasks** (sequential chapters, append to SAME file):

#### ui-tokens.md (multi-chapter)
1. `ui-tokens-ch1` (priority 100) → **ui-tokens.md** - Colors (MAX 150 lines)
2. `ui-tokens-ch2` (priority 110) → **ui-tokens.md** - Typography (MAX 150 lines)
3. `ui-tokens-ch3` (priority 120) → **ui-tokens.md** - Spacing & Effects (MAX 100 lines)

#### ui-assets.md (multi-chapter)
4. `ui-assets-ch1` (priority 200) → **ui-assets.md** - Images & Backgrounds (MAX 200 lines)
5. `ui-assets-ch2` (priority 210) → **ui-assets.md** - Icons & Graphics (MAX 150 lines)

#### ui-spec.md (multi-chapter)
6. `ui-spec-ch1` (priority 300) → **ui-spec.md** - Layout & Navigation (MAX 300 lines)
7. `ui-spec-ch2` (priority 310) → **ui-spec.md** - Components (MAX 400 lines)
8. `ui-spec-ch3` (priority 320) → **ui-spec.md** - Interactions & States (MAX 300 lines)

**Optional additional chapters**:
- `ui-spec-ch4` (priority 330) → **ui-spec.md** - Responsive & Accessibility (MAX 200 lines)

---

## Critical Rules

1. **Token Limit Safety (MOST IMPORTANT)**
   - **Claude Sonnet max output: 8,192 tokens**
   - **~600 lines = ~7,200 tokens** (safe threshold)
   - **Each TASK output must stay under 600 lines**
   - Split into chapters if ANY document exceeds this

2. **Chapter-Based = Sequential Append**
   - `ui-tokens-ch1` → writes to **ui-tokens.md**
   - `ui-tokens-ch2` → **appends** to **ui-tokens.md**
   - All chapters of same document share same `targetFile`

3. **Line budgets per TASK**
   - Simple strategy: ui-tokens ≤200, ui-assets ≤150, ui-spec ≤600
   - Chapter strategy: each chapter ≤400 lines (safe margin)
   - Add "MAX N lines!" to ALL descriptions

4. **Dependencies**
   - ui-assets chapters depend on ALL ui-tokens chapters
   - ui-spec chapters depend on ALL ui-tokens + ui-assets chapters
   - Chapters within same document are sequential (ch2 after ch1)

5. **Priority ranges**
   - ui-tokens chapters: 100-149
   - ui-assets chapters: 200-249
   - ui-spec chapters: 300-349

---

## Output Format

```json
{
  "strategy": "simple" | "chapter-based",
  "targetFiles": string[],  // Unique files (ui-tokens.md, ui-assets.md, ui-spec.md)
  "tasks": Array<{
    id: string;        // e.g., "ui-tokens", "ui-tokens-ch1", "ui-spec-ch2"
    name: string;      // e.g., "Generate Design Tokens: Colors"
    targetFile: string; // e.g., "ui-tokens.md" (same for all chapters)
    description: string; // What to write + "MAX N lines!"
    priority: number;  // Sequential within category
  }>
}
```

---

## Examples

### Example 1: Simple Landing Page

**Input**: 1 screen, 8 components, 15 assets

**Analysis**: 
- ui-tokens: ~180 lines expected ✅
- ui-assets: ~120 lines expected ✅
- ui-spec: ~500 lines expected ✅
- All under 600 lines → Simple strategy

**Output**:
```json
{
  "strategy": "simple",
  "targetFiles": ["ui-tokens.md", "ui-assets.md", "ui-spec.md"],
  "tasks": [
    {
      "id": "ui-tokens",
      "name": "Generate Design Tokens",
      "targetFile": "ui-tokens.md",
      "description": "Extract complete design system: colors (10 values), typography (4 families, 8 sizes), spacing (6 values). MAX 180 lines!",
      "priority": 100
    },
    {
      "id": "ui-assets",
      "name": "Generate Asset Mapping",
      "targetFile": "ui-assets.md",
      "description": "Map 15 assets (2 logos, 1 hero bg, 8 images, 4 icons) to usage. Reference ui-tokens.md. MAX 120 lines!",
      "priority": 200
    },
    {
      "id": "ui-spec",
      "name": "Generate UI Specification",
      "targetFile": "ui-spec.md",
      "description": "Document complete UI: header, hero, 6 sections, footer. 8 components. Include layout, visuals, responsive, a11y. Reference ui-tokens.md and ui-assets.md. MAX 500 lines!",
      "priority": 300
    }
  ]
}
```

---

### Example 2: Multi-Page Dashboard

**Input**: 5 screens, 25 components, 40 assets (20 icons, 15 images, 5 fonts)

**Analysis**:
- ui-tokens: ~400 lines expected (colors + typography + spacing + effects) → **SPLIT into 3 chapters**
- ui-assets: ~400 lines expected (40 assets * 10 lines) → **SPLIT into 2 chapters**
- ui-spec: ~1000 lines expected (5 screens * 200 lines) → **SPLIT into 3 chapters**
- All exceed 600 lines → Chapter-based strategy

**Output**:
```json
{
  "strategy": "chapter-based",
  "targetFiles": ["ui-tokens.md", "ui-assets.md", "ui-spec.md"],
  "tasks": [
    {
      "id": "ui-tokens-ch1",
      "name": "Design Tokens: Colors",
      "targetFile": "ui-tokens.md",
      "description": "Chapter 1: Extract color palette - primary, secondary, accent, neutrals, semantic colors. MAX 120 lines!",
      "priority": 100
    },
    {
      "id": "ui-tokens-ch2",
      "name": "Design Tokens: Typography",
      "targetFile": "ui-tokens.md",
      "description": "Chapter 2 (append to ui-tokens.md): Font families, sizes (12 values), weights, line-heights. MAX 150 lines!",
      "priority": 110
    },
    {
      "id": "ui-tokens-ch3",
      "name": "Design Tokens: Spacing & Effects",
      "targetFile": "ui-tokens.md",
      "description": "Chapter 3 (append to ui-tokens.md): Spacing scale, shadows, borders, radii. MAX 100 lines!",
      "priority": 120
    },
    {
      "id": "ui-assets-ch1",
      "name": "Asset Mapping: Images & Backgrounds",
      "targetFile": "ui-assets.md",
      "description": "Chapter 1: Map 15 images (backgrounds, hero, content) to usage. Reference ui-tokens.md. MAX 180 lines!",
      "priority": 200
    },
    {
      "id": "ui-assets-ch2",
      "name": "Asset Mapping: Icons & Graphics",
      "targetFile": "ui-assets.md",
      "description": "Chapter 2 (append to ui-assets.md): Map 20 icons to components. Reference ui-tokens.md. MAX 200 lines!",
      "priority": 210
    },
    {
      "id": "ui-spec-ch1",
      "name": "UI Specification: Layout & Navigation",
      "targetFile": "ui-spec.md",
      "description": "Chapter 1: Document 5 pages - structure, navigation, routing. Reference ui-tokens.md and ui-assets.md. MAX 300 lines!",
      "priority": 300
    },
    {
      "id": "ui-spec-ch2",
      "name": "UI Specification: Components",
      "targetFile": "ui-spec.md",
      "description": "Chapter 2 (append to ui-spec.md): Specify 25 components - visual properties, variants, composition. Reference ui-tokens.md and ui-assets.md. MAX 400 lines!",
      "priority": 310
    },
    {
      "id": "ui-spec-ch3",
      "name": "UI Specification: Interactions & States",
      "targetFile": "ui-spec.md",
      "description": "Chapter 3 (append to ui-spec.md): Component states, animations, transitions. Reference ui-tokens.md. MAX 300 lines!",
      "priority": 320
    }
  ]
}
```

---

## Decision Guidelines

**Estimate lines for EACH document**:
- **ui-tokens**: ~15 lines per color token, ~15 per font family, ~10 per spacing
- **ui-assets**: ~8-12 lines per asset
- **ui-spec**: ~150-250 lines per screen, ~20-40 per component

**If ANY document exceeds ~600 lines → Use Chapter-Based strategy**

**When in doubt**: Use Chapter-Based. Better to split unnecessarily than hit Sonnet's 8K token limit.
