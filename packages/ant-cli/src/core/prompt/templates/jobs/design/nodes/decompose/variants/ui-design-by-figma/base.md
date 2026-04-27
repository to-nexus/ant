# UI Design Task Decomposition

You are decomposing UI documentation work into executable chapter tasks.

**Job Mode**: {{detectedMode}}

{{#if (eq detectedMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create ONE focused task for the specific modification requested.

### Constraints

- ❌ Multiple chapter-based tasks
- ❌ Full document regeneration
- ✅ Single task targeting specific section
- ✅ Task ID format: `refactor-{document}-{section}`
- ✅ Task name format: `Refactor: {brief description}`

### Output Format

```json
{
  "jobMode": "refactor",
  "targetFiles": ["{target-file}.json"],
  "tasks": [
    {
      "id": "refactor-{document}-{section}",
      "name": "Refactor: {brief description}",
      "targetFile": "{target-file}.json",
      "description": "{what to modify}. Keep all other content unchanged.",
      "priority": 300
    }
  ]
}
```

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW UI design documents from scratch.**

**Philosophy**: Multiple tasks append to the SAME file sequentially (like System Design).
{{/if}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

## ⚖️ PRD/GDD ↔ FIGMA CONFLICT POLICY

{{> jobs/design/shared/asset-conflict-policy}}

---

{{#unless (eq detectedMode "refactor")}}
## 🎯 SELECTIVE DOCUMENT GENERATION

**Check the Requirements above for explicit document requests.**

| If directive mentions... | Generate ONLY... |
|--------------------------|------------------|
| "only ui-spec" / "regenerate ui-spec" / "ui-spec only" | ui-spec.json tasks |
| "only ui-tokens" / "regenerate ui-tokens" | ui-tokens.json tasks |
| "only ui-assets" / "regenerate ui-assets" | ui-assets.json tasks |
| No specific document request | ALL 3 documents |

**When generating subset:**
- `targetFiles` array contains ONLY the requested document(s)
- Skip tasks for other documents entirely
- Priority ranges remain as defined (100-149, 200-249, 300-349)

### Available Resources

| Resource | Details |
|----------|---------|
| Figma Exploration Result | Pre-analyzed structure from `figmaExplore` node |
| Figma MCP Tools | `figma_get_design_context`, `figma_get_metadata`, `figma_get_screenshot`, `figma_get_variable_defs` |

{{#if nodeSummary}}
### Figma Node Structure (nodeSummary)

Use these nodeIds to scope tasks to specific design areas:

```
{{{nodeSummary}}}
```

**CONSTRAINT**: Assign relevant nodeIds to each task description so the executor can query specific nodes instead of root.
{{/if}}

{{#if variationMatrixSummary}}
### Responsive / Variation Groups

Each line: a design section with responsive width variants.
Format: "section name" (pageNodeId): [distinct widths, largest first]

```
{{{variationMatrixSummary}}}
```

**CONSTRAINT**: When a section has responsive variants, the ui-spec task covering that section MUST include the pageNodeId in its description.
{{/if}}

---

## 📊 CHAPTER-BASED TASK BREAKDOWN

**Always use chapter-based approach.** Adjust chapter count based on complexity:
- Small project → fewer chapters (e.g., 1-2 per document)
- Large project → more chapters (e.g., 3-5 per document)

**Token Safety**: Each chapter output ≤ 600 lines (~8K tokens max)

---

### ui-tokens.json

| Task ID | Priority | Topic |
|---------|----------|-------|
| ui-tokens-ch1 | 100 | Colors & Backgrounds |
| ui-tokens-ch2 | 110 | Typography |
| ui-tokens-ch3 | 120 | Spacing & Effects |

#### ui-assets.json (multi-chapter)

**⚠️ CRITICAL: ch1 establishes the destination PATH PATTERN. ch2+ MUST follow it exactly.**

**CONSTRAINT: Every `src` field in ui-assets.json MUST reference a file that exists on the local filesystem. The system validates this after task completion — violations cause task failure.**

| Task ID | Priority | Topic |
|---------|----------|-------|
| ui-assets-ch1 | 200 | First batch of assets. Every `src` path must reference a locally downloaded file. Include `_meta.pathPattern` in JSON mapping categories to destination directories. |
| ui-assets-ch2 | 210 | Remaining assets. Every `src` path must reference a locally downloaded file. Read `_meta.pathPattern` from existing JSON — follow those paths exactly. Skip assets already documented. |

**Task Description Requirements:**
- **ALL tasks MUST include**: "Every `src` field must reference a file that exists locally. Non-existent paths cause task failure."
- **ch1 MUST include**: "Include `_meta.pathPattern` in JSON output (mapping category to destination directory)"
- **ch2+ MUST include**: "Read `_meta.pathPattern` from existing JSON — follow those paths exactly" and "Skip assets already documented in ch1"

#### ui-spec.json (multi-chapter)

**Observation target**: Identify the distinct pages/views/features. **Two SSOT inputs** must be aligned:

1. **PRD §5 IA / §6 Screen Composition** (when PRD is in source documents) — `SC-XXX` identifiers define the page chapter list. Use the `SC-` ID as the page chapter task ID suffix (e.g., `ui-spec-SC-Search`).
2. **Figma frames / nodeIds** (always available) — each `SC-` from the PRD MUST map to one or more Figma frames; pick the frame(s) whose name or annotation best matches the `SC-` semantically.

**Alignment rule**: When the PRD cites a Figma node-id for an `SC-` (`SC-ProductDetail — figma: 1234:5678`), use that exact node-id as the primary input for that page chapter. When the PRD does not cite figma but `SC-` IDs exist, pick the matching frame from the Figma exploration result and record the chosen mapping in the task description as `SC-<name> ↔ figma:<nodeId>`. When neither PRD `SC-` IDs nor PRD citations exist, fall back to Figma frame names alone, but flag the gap (`PRD lacks SC- IDs — page list extracted from Figma frame names`) in the task description.

**Chapter roles** — each chapter has exactly ONE role:

| Role | Priority | Scope boundary | PRD hand-off citation |
|------|----------|----------------|----------------------|
| **Structure** (ch1) | 300 | Global settings ONLY: breakpoints, grid, containers, typography hierarchy, color roles. NO component behavior, NO interaction patterns, NO toast/accessibility. | (rare) `PRD §9 NFR (a11y)` if accessibility commitments exist |
| **Page** (ch2..chN-1) | 310–340 | ONE `SC-XXX` page mapped to Figma frames. Page-specific layout, content, and component usage from PRD §6 entry for that `SC-` AND from the chosen Figma frame(s). Page-only behaviors fully specified here. Shared components referenced by ID — do NOT redefine. | `PRD §6 / SC-XXX` + the Figma node-id(s) mapped to it; any `PRD §7 / CP-XXX` entries that apply to this page only |
| **Shared** (chN or components) | 349 | Cross-page shared patterns ONLY: reusable component library (full variant/state/size definitions), global accessibility, toast system, keyboard navigation. Define based on project requirements — NOT by observing previous chapter outputs. | `PRD §6` cross-screen components + `PRD §7 / CP-XXX` cross-screen content policies |

**MECE constraint**: Each topic belongs to exactly ONE chapter.
- Behavior used in only ONE page → that page's chapter
- Behavior used across 2+ pages → shared chapter
- Do NOT create a separate "interactions + accessibility" chapter

**Component Ownership Contract** (prevents duplication between page and shared chapters):
- Component scoping (page-only vs shared) is **derived from the PRD**: §6 (per-screen composition) tells whether a component belongs to a specific `SC-XXX`; §7 (content & domain policy) tells whether a content rule applies cross-screen. Components used by exactly one `SC-XXX` → that page's chapter; components referenced by 2+ `SC-XXX` → shared chapter. When PRD `SC-` IDs are absent, fall back to Figma component-instance reuse counts.
- Shared chapter description MUST start with `Components: <id1>, <id2>, ...` listing every component ID it will define. These IDs become JSON keys — use short, kebab-case names (e.g., `gnb`, `button`, `input`, `dropdown`, `table-data`, `tab-bar`).
- Each page chapter description MUST include: (a) `Implements PRD §6 / SC-<name>` (or `PRD lacks SC- IDs — extracted from Figma frame "<name>"` as fallback), (b) `Figma: <nodeId list>`, (c) `Shared components [<id1>, <id2>, ...]: reference by componentRef only — do NOT redefine.`
- A component used in exactly ONE page belongs in that page's chapter, NOT in shared.

---

## 📏 CHAPTER COUNT GUIDELINES

| Complexity | ui-tokens | ui-assets | ui-spec |
|------------|-----------|-----------|---------|
| Small (few components) | 1-2 chapters | 1 chapter | 2-3 chapters |
| Medium (landing page) | 2-3 chapters | 1-2 chapters | 3-4 chapters |
| Large (multi-page) | 3+ chapters | 2+ chapters | 5+ chapters |

**Your resources**: Figma MCP tools + pre-analyzed exploration data

**Principle**: When unsure, create more chapters. Better to have small focused tasks than hit token limits.

{{/unless}}

---

{{> jobs/design/nodes/decompose/variants/ui-design-by-figma/rules}}
