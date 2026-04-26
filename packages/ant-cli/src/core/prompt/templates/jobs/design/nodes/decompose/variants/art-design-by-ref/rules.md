## ExecutionTier Classification

**Observation target**: The breadth of game-art documentation implied by
the directive, the mode, and the reference images / source documents
supplied in this prompt.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only explanation; no game-art document produced. |
| `1` | OneShot       | Single concrete edit to one existing game-art document (e.g. a targeted asset entry add). |
| `2` | Exploratory   | Must observe the references/sources before choosing what to document; still a single cohesive edit. |
| `3` | Task          | Multiple categories of game-art documentation driven by the directive alone, without systematic grounding on external reference docs. |
| `4` | RefsGrounded  | Multiple categories systematically grounded in reference images plus PRD / source documents supplied in this prompt. |

**Constraint**: Emit exactly one `<executionTier>N</executionTier>` tag
BEFORE the JSON output. `N` is a single digit `0`–`4`.

**Constraint**: Reference images alone do not force Tier 4. Tier 4
applies when the game-art documentation is systematically derived from
those references (concept art → multi-category asset / spec map).

⚠️ **Blind spot**: When references are the source of truth for the
breakdown, the tier is `4`, NOT `3`.

---

## 📋 CRITICAL RULES

### 1. Token Limit Safety (MOST IMPORTANT)

- **Claude Sonnet max output: 8,192 tokens**
- **~600 lines = ~7,200 tokens** (safe threshold)
- **Each TASK output must stay under 600 lines**
- Split into more categories if any category would exceed this

### 2. Category-Based = Independent Parallel Writes

- `game-art-assets-entities` → writes the `entities` key of `game-art-assets.json`
- `game-art-assets-particles` → writes the `particles` key in parallel
- All assets tasks share the same `targetFile`, but each owns a unique
  top-level dictionary key (no key collisions)
- Same rule for spec tasks (each owns one top-level category key)

### 3. Line Budget Guidelines

**Each category ≤ 400 lines** (safe margin for ~8K token limit).

If one category needs more (e.g. dozens of effects), split into
sub-categories with descriptive ids — `effects-combat` and `effects-ui`
are valid sibling categories. Avoid sub-keys; the parser splits on the
top-level key.

### 4. Dependencies

- `game-art-tokens` is independent (runs first or in parallel with assets)
- `game-art-assets-{cat}` tasks are independent of each other
- `game-art-spec-{cat}` tasks depend on ALL `game-art-assets-{cat}` tasks
  (priority barrier — spec entries reference asset ids)

### 5. Priority Ranges

| Document | Priority Range |
|----------|----------------|
| game-art-tokens | 100-149 |
| game-art-assets | 200-249 |
| game-art-spec | 300-349 |

### 6. Source File Assignment

{{#if sourceFileNames}}
Each task MUST include `sourceFiles` — an array of source filenames that
the task needs to reference.

- A task MAY reference 1 or more files depending on its scope
- Observe each file's relevance to the task's domain concepts
- **Constraint**: Do NOT omit a file that contains requirements relevant
  to the task scope
- ⚠️ **Blind spot**: Foundational context files (game design pillars,
  shared lore docs) are relevant to every category — do NOT skip them
  because they lack a direct asset mapping
{{/if}}

### 7. Category Exclusivity (MECE Principle)

**CONSTRAINT**: Each category key MUST be assigned to exactly ONE task.

- An entity belongs to ONE category (either `entities` OR `npcs`, not both)
- An effect belongs to `effects` (spec) and references its visual asset
  in `particles` or `entities` (assets) — that is reference, not duplication
- Cross-category constants (token-like values that differ from
  `game-art-tokens`) belong in the most narrowly-fitting category, not
  duplicated across categories
- Empty categories MUST be omitted

### 8. Asset-Source Kind Discipline (CRITICAL — D20 / D21)

**Every asset entry has exactly one `kind: 'inline' | 'external'`.**

| kind       | Where data lives | Production scope                                                       |
|------------|------------------|------------------------------------------------------------------------|
| `external` | `inputs/assets/game/<subdir>/<file>` | Production-grade — user-placed                |
| `inline`   | Embedded in JSON (`svg` / `css` / `oscillator` / etc.) | Simple-shape / single-tone / short-duration only |

**Inline scope (D21 — Phase 2 css-only policy)**:

- ✅ A small SVG with `≤ 5` paths and `viewBox` of side `≤ 64`
- ✅ A short CSS rule using single-tone background / radial-gradient
- ✅ An OscillatorNode config with `durationMs ≤ 200`
- ❌ Multi-layer character art / detailed sprite sheets / full BGM tracks
- ❌ Anything that the user could reasonably author in a vector tool

**External scope**:

- The `src` path MUST start with `inputs/assets/game/`
- The `src` MUST point to an extension allowed by the artifact-dir
  policy (Phase 2: images + JSON tilemaps; audio / atlas / glb is
  reserved for Phase 4 hook)

**When in doubt — prefer `external`**. Inline is a fallback for
prototype-grade primitives, not a production pipeline.

---

## 🚫 FORBIDDEN TASKS

DO NOT CREATE:
- ❌ "Final verification" or "review" tasks
- ❌ Deployment / Operations / Infrastructure tasks
- ❌ Single mega-task that writes all three documents
- ❌ Empty categories (omit them instead)
- ❌ Tasks targeting `outputs/design/ui/...` or `inputs/assets/service/...`
  — those belong to UI design intents (I6 surface boundary)
{{#if (eq detectedMode "refactor")}}
- ❌ Multiple category-based tasks (refactor mode = single focused task)
- ❌ Full document regeneration (only modify requested category)
{{/if}}

---

{{#if (eq detectedMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

**Principle**: Single focused task for modification. No multi-category
decomposition.

Emit `<executionTier>N</executionTier>` BEFORE the JSON output. Example:

`<executionTier>1</executionTier>`

```json
{
  "jobMode": "refactor",
  "targetFiles": ["{target}.json"],
  "tasks": [
    {
      "id": "refactor-{document}-{category}",
      "name": "Refactor: {brief description}",
      "targetFile": "{target}.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 300
    }
  ]
}
```

### Constraints

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{document}-{category}` |
| Name format | `Refactor: {description}` |
| Description | Must include "Keep all other content unchanged" |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

Emit `<executionTier>N</executionTier>` BEFORE the JSON output. Example:

`<executionTier>4</executionTier>`

```json
{
  "targetFiles": ["game-art-tokens.json", "game-art-assets.json", "game-art-spec.json"],
  "tasks": [
    {
      "id": "game-art-tokens",
      "name": "Game-Art Tokens",
      "targetFile": "game-art-tokens.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Palette, silhouette, lighting, motion tone derived from gameArtTier.concept.",
      "priority": 100,
      "parallelGroup": "game-art-tokens"
    },
    {
      "id": "game-art-assets-entities",
      "name": "Assets: Entities",
      "targetFile": "game-art-assets.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Entity asset entries (heroes, enemies, collectibles). Use kind:external for user-placed sprites under inputs/assets/game/entities/; use kind:inline for css-only primitives.",
      "priority": 200,
      "parallelGroup": "game-art-assets-entities"
    },
    {
      "id": "game-art-spec-effects",
      "name": "Spec: Effects",
      "targetFile": "game-art-spec.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Effect spec entries (match-clear, hover, hit-feedback). Reference particle asset ids from game-art-assets.json.",
      "priority": 300,
      "parallelGroup": "game-art-spec-effects"
    }
  ]
}
```

### targetFiles Selection

| Scenario                                           | targetFiles                                                                |
|----------------------------------------------------|----------------------------------------------------------------------------|
| Full generation                                    | `["game-art-tokens.json", "game-art-assets.json", "game-art-spec.json"]`   |
| Spec only (tokens / assets exist)                  | `["game-art-spec.json"]`                                                   |
| Tokens only                                        | `["game-art-tokens.json"]`                                                 |
| Assets only                                        | `["game-art-assets.json"]`                                                 |

**Rule**: Only include documents that will be generated. Tasks MUST
match targetFiles.

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique (e.g. `game-art-tokens`, `game-art-assets-particles`) |
| name | Descriptive (e.g. "Game-Art Tokens", "Assets: Particles") |
| targetFile | MUST be in targetFiles array |
| description | Clear scope of what to document — for assets, MUST mention asset-source kind policy ("external for user-placed; inline for css-only primitives"). |
| priority | See priority ranges above |
| parallelGroup | One group per task — full parallelism within a document |

### Parallel Execution Hints

Add `"parallelGroup"` to every task.

- `game-art-tokens` — single task, group = `game-art-tokens`
- `game-art-assets-{category}` — group = task id (one task per category)
- `game-art-spec-{category}` — group = task id (one task per category)

The system uses per-file mutex + deep merge for concurrent writes. Spec
tasks (priority 300+) wait for assets tasks (priority 200+) via
priority barrier.

---

## 📋 TASK DESCRIPTION GUIDELINES

### game-art-tokens (single)

**MUST include in description:**
- "derived from `gameArtTier.concept`"
- "Single-task scope — palette + silhouette + lighting + motion tone"

### game-art-assets-{category}

**MUST include in description:**
- The category name in plain English
- Asset-source kind hint: "external for user-placed; inline for
  css-only primitives"
- For categories that mix ids referenced by spec — note "Asset ids
  must be stable; spec entries reference them"

### game-art-spec-{category}

**MUST include in description:**
- The category's behavioral scope (motion / lifecycle / policy)
- "Reference asset ids from `game-art-assets.json` (do NOT redefine
  asset bytes)"

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:

### JSON Structure
- ✅ Valid JSON syntax
- ✅ `targetFiles` contains only requested documents (check directive!)
- ✅ Every task's `targetFile` is in `targetFiles` array
- ✅ All fields present (id, name, targetFile, description, priority, parallelGroup)
- ✅ Priority in correct range (100-149, 200-249, 300-349)
- ✅ No forbidden tasks (verification, deployment, operations)

### Category Discipline
- ✅ At least 1 task per included document
- ✅ Each category id is unique (no duplicate top-level keys across tasks)
- ✅ No empty categories (omit instead of `projectiles: []`)

### Task Descriptions
- ✅ Token task description mentions `gameArtTier.concept`
- ✅ Assets task descriptions mention the inline / external kind policy
- ✅ Spec task descriptions reference asset ids (not asset bytes)

---

## 🎨 GAME-ART POLICY DETECTION

After the main JSON output, output a `<gameArtTier>` tag with the
detected art-tier axis values.

{{> jobs/shared/injections/game-art-tier-detection}}
{{/if}}
