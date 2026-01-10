# UI Design Task Decomposition

You are analyzing UI complexity to break it into chapter-based tasks.

**Philosophy**: Multiple tasks append to the SAME file sequentially (like System Design).

---

## 📥 INPUT CONTEXT

{{#if uiContext}}
### Requirements

{{{uiContext}}}
{{/if}}

---

## 🎯 SELECTIVE DOCUMENT GENERATION

**Check the Requirements above for explicit document requests.**

| If directive mentions... | Generate ONLY... |
|--------------------------|------------------|
| "only ui-spec" / "regenerate ui-spec" / "ui-spec only" | ui-spec.md tasks |
| "only ui-tokens" / "regenerate ui-tokens" | ui-tokens.md tasks |
| "only ui-assets" / "regenerate ui-assets" | ui-assets.md tasks |
| No specific document request | ALL 3 documents |

**When generating subset:**
- `targetFiles` array contains ONLY the requested document(s)
- Skip tasks for other documents entirely
- Priority ranges remain as defined (100-149, 200-249, 300-349)

### Available Resources

| Resource | Count |
|----------|-------|
| Reference screens | {{screenCount}} |
| Component snapshots | {{componentCount}} |
| Asset files | {{assetCount}} |

---

## 📊 CHAPTER-BASED TASK BREAKDOWN

**Always use chapter-based approach.** Adjust chapter count based on complexity:
- Small project → fewer chapters (e.g., 1-2 per document)
- Large project → more chapters (e.g., 3-5 per document)

**Token Safety**: Each chapter output ≤ 600 lines (~8K tokens max)

---

### ui-tokens.md

| Task ID | Priority | Topic |
|---------|----------|-------|
| ui-tokens-ch1 | 100 | Colors & Backgrounds |
| ui-tokens-ch2 | 110 | Typography |
| ui-tokens-ch3 | 120 | Spacing & Effects |

#### ui-assets.md (multi-chapter)

| Task ID | Priority | Topic |
|---------|----------|-------|
| ui-assets-ch1 | 200 | Images & Backgrounds |
| ui-assets-ch2 | 210 | Icons & Graphics |

#### ui-spec.md (multi-chapter)

**⚠️ CRITICAL: ch1 establishes the PATTERN. ch2+ follows the same pattern.**

| Task ID | Priority | Scope |
|---------|----------|-------|
| ui-spec-ch1 | 300 | Global settings only: overview, breakpoints, layout rules. Use `## N.` top-level sections. |
| ui-spec-ch2 | 310 | Navigation + Hero specs. Follow ch1's section pattern. |
| ui-spec-ch3 | 320 | Main content sections (first half). Follow ch1's section pattern. |
| ui-spec-ch4 | 330 | Main content sections (second half). Follow ch1's section pattern. |
| ui-spec-ch5 | 340 | Footer + interactions + accessibility. Follow ch1's section pattern. |

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

**Your resources**: screens={{screenCount}}, components={{componentCount}}, assets={{assetCount}}

**Principle**: When unsure, create more chapters. Better to have small focused tasks than hit token limits.

---

{{> design/phases/decompose/rules-ui-design}}
