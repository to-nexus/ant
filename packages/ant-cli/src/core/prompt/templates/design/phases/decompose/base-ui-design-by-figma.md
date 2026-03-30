# UI Design Task Decomposition

You are analyzing UI complexity to break it into tasks.

**Job Mode**: {{jobMode}}

{{#if (eq jobMode "refactor")}}
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

{{#if uiContext}}
### Requirements

{{{uiContext}}}
{{/if}}

---

{{#unless (eq jobMode "refactor")}}
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
| ui-assets-ch1 | 200 | First batch of assets. Every `src` path must reference a locally downloaded file. Define canonical destination path patterns. Output PATH_PATTERN metadata. |
| ui-assets-ch2 | 210 | Remaining assets. Every `src` path must reference a locally downloaded file. MUST follow ch1's path patterns exactly. Skip assets already documented. |

**Task Description Requirements:**
- **ALL tasks MUST include**: "Every `src` field must reference a file that exists locally. Non-existent paths cause task failure."
- **ch1 MUST include**: "Define canonical destination paths" and "Output `<!-- PATH_PATTERN: ... -->` metadata"
- **ch2+ MUST include**: "Follow ch1's path patterns exactly" and "Skip assets already documented in ch1"

#### ui-spec.json (multi-chapter)

**⚠️ CRITICAL: ch1 establishes the PATTERN. ch2+ follows the same pattern.**

**Observation target**: Identify the distinct pages/views/features in the project requirements.

**Chapter roles** — each chapter has exactly ONE role:

| Role | Priority | Scope boundary |
|------|----------|----------------|
| **Structure** (ch1) | 300 | Document TOC + layout primitives ONLY: breakpoints, grid, containers, typography hierarchy, color roles. NO component behavior, NO interaction patterns, NO toast/accessibility. |
| **Page** (ch2..chN-1) | 310–340 | ONE page or feature area. ALL component specs for that page INCLUDING its interactions, states, and animations. |
| **Shared** (chN or components) | 349 | Cross-page shared patterns ONLY: reusable component library, global accessibility, toast system, keyboard navigation. Define based on project requirements — NOT by observing previous chapter outputs. |

**MECE constraint**: Each topic belongs to exactly ONE chapter.
- Behavior used in only ONE page → that page's chapter
- Behavior used across 2+ pages → shared chapter
- Do NOT create a separate "interactions + accessibility" chapter

**⚠️ Pattern Consistency**:
- ch1 writes actual content with a specific structure pattern (e.g., `## 1.`, `## 2.`)
- ch2+ **reads FORBIDDEN SECTIONS** to see the pattern, then continues with same pattern
- NO placeholder/outline system (append-only architecture)

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

{{> design/phases/decompose/rules-ui-design-by-figma}}
