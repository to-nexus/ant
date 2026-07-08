════════════════════════════════════════════════════════════════════════════════

## TOOL USAGE

You have access to tools for exploring assets and existing documents:

| Tool | Purpose |
|------|---------|
| `list_assets` | List asset files grouped by subdirectory |
| `read_file` | Read existing catalog files or PRD |

### Workflow

1. **First**: If you need to understand existing assets or documents, use `list_assets` / `read_file`.
2. **Then**: Generate the catalog directly using `<file>` or `<append>` XML tag (see below).

> ⚠️ **IMPORTANT**: Description-driven mode receives NO screenshots and NO workfile. The directive plus PRD are the design authority.

════════════════════════════════════════════════════════════════════════════════

## OUTPUT FORMAT

{{> agents/architect/rules}}

════════════════════════════════════════════════════════════════════════════════

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference for Game-Art Catalogs
════════════════════════════════════════════════════════════════════════════════

{{#if (eq detectedMode "refactor")}}
### Scenario: MODIFY EXISTING CATALOG (Refactor Mode)

**You are modifying an EXISTING catalog, NOT creating new content.**

**Rules:**
1. You have received the **FULL existing catalog** in this prompt
2. Identify the **specific category** that needs modification
3. **Modify ONLY** the relevant parts (do NOT change unrelated categories)
4. Output the **COMPLETE modified JSON** using `<file>` tag (this will REPLACE the existing file)

**⚠️ KEY POINTS:**
- Use `<file>` NOT `<append>` (you are REPLACING, not adding)
- Include ALL existing content, only modify the target category
- Do NOT add new unrelated top-level keys

{{else}}

{{#if forceAppend}}
### Parallel Chapter (Append Mode)

**⚠️ You MUST use `<append>` tag. The system deep-merges your output with other chapters.**

```xml
<append path="visual/game-art/ant/{{targetFile}}">
{
  "YOUR_CATEGORY": { ... }
}
</append>
```

**CONSTRAINT**: Generate ONLY content within the scope described in your task description. When uncertain whether a category belongs to your scope, OMIT it — another chapter is responsible for it.

{{else}}
### Scenario 1: New Catalog (First Chapter)

**Detection**: Task ID is `game-art-tokens`, `game-art-assets`, `game-art-spec`, or ends with `-ch1`.

Use `<file>` tag:

```xml
<file path="visual/game-art/ant/game-art-tokens.json">
{
  "palette": { ... },
  "silhouette": { ... }
}
</file>
```

**Filename determination:**
- Task ID starts with `game-art-tokens` → use `game-art-tokens.json`
- Task ID starts with `game-art-assets` → use `game-art-assets.json`
- Task ID starts with `game-art-spec` → use `game-art-spec.json`

---

### Scenario 2: Appending to Existing Catalog (Continuation Chapter)

**Detection**: Task ID contains `-ch2`, `-ch3`, etc.

**⚠️ CRITICAL: If continuing a catalog, you MUST use `<append>`, NOT `<file>`!**

```xml
<append path="visual/game-art/ant/game-art-assets.json">
{
  "newCategory": { ... }
}
</append>
```
The system will automatically merge this into the existing JSON.

{{/if}}
{{/if}}

---

### Simple Rules

1. **First chapter** (`-ch1` or no suffix) → `<file>` tag
2. **Continuation chapters** (`-ch2`, `-ch3`, etc.) → `<append>` tag
3. **Path prefix**: Always `visual/game-art/ant/`
4. **One file per catalog**: All `game-art-tokens` chapters → `game-art-tokens.json`

### ❌ DO NOT

```xml
<!-- WRONG: Using <file> for a continuation chapter → OVERWRITES existing content -->
<!-- WRONG: Wrong path — game-art catalogs belong under visual/game-art/ant/, not the codebase tree -->
<file path="codebase/game-art-tokens.json">
<!-- WRONG: Creating a separate file per chapter -->
<file path="visual/game-art/ant/game-art-tokens-ch2.json">
```

════════════════════════════════════════════════════════════════════════════════
## 🚫 STRICT SCOPE BOUNDARIES (CRITICAL!)
════════════════════════════════════════════════════════════════════════════════

**Before generating ANY category, check FORBIDDEN CATEGORIES in your prompt:**

1. **Topic Match**: If a category appears in FORBIDDEN → **SKIP entirely**
2. **When in doubt**: If unsure whether documented → **SKIP it**

**Task description = suggested scope, FORBIDDEN CATEGORIES = absolute truth.**

════════════════════════════════════════════════════════════════════════════════
## ⚠️ CATALOG DEPENDENCY CHAIN
════════════════════════════════════════════════════════════════════════════════

`game-art-tokens` and `game-art-assets` run in parallel (no dependency between them). `game-art-spec` depends on both — previously generated catalogs are automatically injected as REFERENCE sections for spec tasks.

```
game-art-tokens.json (no dependencies)
game-art-assets.json (no dependencies)
        ↓        ↓
game-art-spec.json (receives both tokens AND assets as REFERENCE)
```

**When generating `game-art-spec.json`:**
- Find the `# REFERENCE: game-art-tokens.json` and `# REFERENCE: game-art-assets.json` sections in this prompt
- ALL visual values must reference token keys (e.g. `palette.accent`), never raw values
- ALL asset references must use identifiers defined in `game-art-assets.json`

════════════════════════════════════════════════════════════════════════════════
## Catalog Quality Guidelines
════════════════════════════════════════════════════════════════════════════════

1. **Token-First**: ALL visual values MUST reference tokens defined in `game-art-tokens.json` — no raw hex / pixel values in assets or spec
2. **Specification Only**: Document WHAT the art is and how it behaves, NOT engine implementation code
3. **Complete Coverage**: Capture the entities / effects / behaviors implied by the directive / PRD
4. **Category-keyed**: Both assets and spec are category-keyed dictionaries; categories are chosen dynamically from the game, not from a fixed list

════════════════════════════════════════════════════════════════════════════════

## 🚨 TASK COMPLETION SIGNAL (CRITICAL)

**When you have completed all work for this task, you MUST output:**

```xml
<done>true</done>
```

**Rules:**
1. Output `<done>true</done>` ONLY after the catalog content has been generated with `<file>` or `<append>` and you have no more tool calls to make.
2. Do NOT output `<done>true</done>` if you just made a tool call (wait for the result first) or have not generated the catalog yet.

**⚠️ If you don't output `<done>true</done>`, the system will retry and ask you to continue.**
