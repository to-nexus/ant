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

{{#if uiContext}}
### Requirements

{{{uiContext}}}
{{/if}}

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

| Resource | Count |
|----------|-------|
| Reference images | {{referenceCount}} |
| Asset files | {{assetCount}} |

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

| Task ID | Priority | Topic |
|---------|----------|-------|
| ui-assets-ch1 | 200 | First batch of assets. Include `_meta.pathPattern` in JSON mapping categories to destination directories. |
| ui-assets-ch2 | 210 | Icons & Graphics. Read `_meta.pathPattern` from existing JSON — follow those paths exactly. Skip assets already documented. |

**Task Description Requirements:**
- **ch1 MUST include**: "Include `_meta.pathPattern` in JSON output (mapping category to destination directory)"
- **ch2+ MUST include**: "Read `_meta.pathPattern` from existing JSON — follow those paths exactly" and "Skip assets already documented in ch1"

#### ui-spec.json (multi-chapter)

**Observation target**: Identify the distinct pages/views/features in the project requirements.

**Chapter roles** — each chapter has exactly ONE role:

| Role | Priority | Scope boundary |
|------|----------|----------------|
| **Structure** (ch1) | 300 | Global settings ONLY: breakpoints, grid, containers, typography hierarchy, color roles. NO component behavior, NO interaction patterns, NO toast/accessibility. |
| **Page** (ch2..chN-1) | 310–340 | ONE page or feature area. Page-specific layout, content, and component usage. Page-only behaviors (used in this page only) fully specified here. Shared components referenced by ID — do NOT redefine their variants/states/sizes. |
| **Shared** (chN or components) | 349 | Cross-page shared patterns ONLY: reusable component library (full variant/state/size definitions), global accessibility, toast system, keyboard navigation. Define based on project requirements — NOT by observing previous chapter outputs. |

**MECE constraint**: Each topic belongs to exactly ONE chapter.
- Behavior used in only ONE page → that page's chapter
- Behavior used across 2+ pages → shared chapter
- Do NOT create a separate "interactions + accessibility" chapter

**Component Ownership Contract** (prevents duplication between page and shared chapters):
- Shared chapter description MUST start with `Components: <id1>, <id2>, ...` listing every component ID it will define. These IDs become JSON keys — use short, kebab-case names (e.g., `gnb`, `button`, `input`, `dropdown`, `table-data`, `tab-bar`).
- Each page chapter description MUST include: `Shared components [<id1>, <id2>, ...]: reference by componentRef only — do NOT redefine.`
- A component used in exactly ONE page belongs in that page's chapter, NOT in shared.

---

## 📏 CHAPTER COUNT GUIDELINES

| Complexity | ui-tokens | ui-assets | ui-spec |
|------------|-----------|-----------|---------|
| Small (few components) | 1-2 chapters | 1 chapter | 2-3 chapters |
| Medium (landing page) | 2-3 chapters | 1-2 chapters | 3-4 chapters |
| Large (multi-page) | 3+ chapters | 2+ chapters | 5+ chapters |

**Your resources**: references={{referenceCount}}, assets={{assetCount}}

**Principle**: When unsure, create more chapters. Better to have small focused tasks than hit token limits.

{{/unless}}

---

{{> jobs/design/nodes/decompose/variants/ui-design-by-ref/rules}}
