## ExecutionTier Classification

**Observation target**: The breadth of game-art documentation implied by
the directive, the mode, and the Figma frames / source documents
supplied in this prompt.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only explanation; no game-art document produced. |
| `1` | OneShot       | Single concrete edit to one existing game-art document (e.g. a targeted asset entry add). |
| `2` | Exploratory   | Must observe the Figma file / sources before choosing what to document; still a single cohesive edit. |
| `3` | Task          | Multiple categories of game-art documentation driven by the directive alone, without systematic grounding on Figma frames. |
| `4` | RefsGrounded  | Multiple categories systematically grounded in the Figma frames plus PRD / source documents supplied in this prompt. |

**Constraint**: Emit exactly one `<executionTier>N</executionTier>` tag
BEFORE the JSON output. `N` is a single digit `0`–`4`.

**Constraint**: Figma frames supplied in `nodeSummary` /
`variationMatrixSummary` act as grounding refs. A multi-frame asset-pack
or full pre-production Figma decomposition is the Tier 4 signature.

⚠️ **Blind spot**: When Figma frames are the source of truth for the
breakdown (the categories map to frames), the tier is `4`, NOT `3`.

---

## 📋 CRITICAL RULES

### 1. Token Limit Safety (MOST IMPORTANT)

- **Claude Sonnet max output: 8,192 tokens**
- **~600 lines = ~7,200 tokens** (safe threshold)
- **Each TASK output must stay under 600 lines**

### 2. Category-Based = Independent Parallel Writes

- `game-art-assets-entities` → writes the `entities` key of `game-art-assets.json`
- `game-art-assets-particles` → writes the `particles` key in parallel
- All assets tasks share the same `targetFile`, but each owns a unique
  top-level dictionary key

### 3. Line Budget Guidelines

**Each category ≤ 400 lines** (safe margin for ~8K token limit).

If one category needs more, split into sibling sub-categories with
descriptive ids — `effects-combat` and `effects-ui` are valid sibling
categories.

### 4. Dependencies

- `game-art-tokens` is independent
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

- Observe each file's relevance to the task's domain concepts
- ⚠️ **Blind spot**: Foundational context files (game design pillars,
  shared lore docs) are relevant to every category — do NOT skip them
{{/if}}

### 7. Figma Node Assignment

Each task description SHOULD include the Figma `nodeId` of the frame(s)
it scopes. The executor uses these nodeIds to call Figma MCP tools
without rescanning root.

- Single-frame asset task → one nodeId in description
- Multi-frame category (`effects` covering N effect frames) → list every
  nodeId in description

### 8. Category Exclusivity (MECE Principle)

**CONSTRAINT**: Each category key MUST be assigned to exactly ONE task.

- An entity belongs to ONE category (either `entities` OR `npcs`, not both)
- An effect belongs to `effects` (spec) and references its visual asset
  in `particles` or `entities` (assets) — that is reference, not duplication
- Empty categories MUST be omitted

### 8.5 GDD Hand-off Citation + EN ↔ Figma Alignment (when GDD is in source documents)

When the GDD provides `EN-XXX` / `LV-XXX` identifiers in §8 Content
Scope and `MC-XXX` / `RW-XXX` in §4 / §6, both inputs MUST be aligned:

- One asset task per `EN-` / `LV-` cluster from GDD §8 — task ID prefers
  GDD entity ID alignment (e.g., `game-art-assets-entities-hero`)
- Each `game-art-assets-{category}` task description MUST: (a) cite the
  GDD IDs (`Implements GDD §8 (EN-Hero, EN-Hero-Wounded)`), (b) record
  the Figma node-id mapping (`Figma: <nodeId list>`), and (c) state
  the alignment source — `figma node cited by GDD` / `frame name match: <name>` /
  `unmapped — Figma frame proposes new EN-`
- Each `game-art-spec-{category}` task description MUST cite `MC-` / `RW-`
  IDs and the Figma frames that visualize the mechanic / reward
- The `game-art-tokens` task description MUST cite `GDD §4 / §6`
  Aesthetic + Reward vocabulary plus the Figma variable groups consumed
- A Figma frame that does not map to any `EN-` / `LV-` from GDD §8:
  include it as a separate task with `unmapped — proposes new EN-` note;
  the planner can then back-fill the GDD with the proposed `EN-` ID
- When the GDD is genuinely absent, state `GDD absent — categories
  extracted from Figma frames` in each task description so the gap is
  visible

### 9. Asset-Source Kind Discipline (CRITICAL — D20 / D21)

**Every asset entry has exactly one `kind: 'inline' | 'external'`.**

| kind       | Where data lives | Production scope                                                       |
|------------|------------------|------------------------------------------------------------------------|
| `external` | `inputs/assets/game/<subdir>/<file>` | Production-grade — user-placed sprite export      |
| `inline`   | Embedded in JSON (`svg` / `css` / `oscillator`) | Simple-shape / single-tone / short-duration only |

**Inline scope (D21 — Phase 2 css-only policy)**:

- ✅ A small SVG with `≤ 5` paths and `viewBox` of side `≤ 64`
- ✅ A short CSS rule using single-tone background / radial-gradient
- ✅ An OscillatorNode config with `durationMs ≤ 200`
- ❌ Multi-layer character art / detailed sprite sheets / full BGM tracks

**External scope**:

- The `src` path MUST start with `inputs/assets/game/`
- The `src` MUST point to an extension allowed by the artifact-dir
  policy (Phase 2: images + JSON tilemaps)

**When in doubt — prefer `external`**.

---

## 🚫 FORBIDDEN TASKS

DO NOT CREATE:
- ❌ "Final verification" or "review" tasks
- ❌ Deployment / Operations / Infrastructure tasks
- ❌ Single mega-task that writes all three documents
- ❌ Empty categories
- ❌ Tasks targeting `outputs/design/ui/...` or `inputs/assets/service/...`
  — those belong to UI design intents (I6 surface boundary)
{{#if (eq detectedMode "refactor")}}
- ❌ Multiple category-based tasks (refactor mode = single focused task)
{{/if}}

---

{{#if (eq detectedMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

Emit `<executionTier>N</executionTier>` BEFORE the JSON output.

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

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{document}-{category}` |
| Description | Must include "Keep all other content unchanged" |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

Emit `<executionTier>N</executionTier>` BEFORE the JSON output.

```json
{
  "targetFiles": ["game-art-tokens.json", "game-art-assets.json", "game-art-spec.json"],
  "tasks": [
    {
      "id": "game-art-tokens",
      "name": "Game-Art Tokens",
      "targetFile": "game-art-tokens.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Palette, silhouette, lighting, motion tone derived from gameArtTier.concept and Figma color/effect variables. Use figma_get_variable_defs against root nodeId.",
      "priority": 100,
      "parallelGroup": "game-art-tokens"
    },
    {
      "id": "game-art-assets-entities",
      "name": "Assets: Entities",
      "targetFile": "game-art-assets.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Entity asset entries. Scope: nodeId=<entity-frame-id>. Use kind:external for user-placed sprite exports under inputs/assets/game/entities/; use kind:inline for css-only primitives.",
      "priority": 200,
      "parallelGroup": "game-art-assets-entities"
    },
    {
      "id": "game-art-spec-effects",
      "name": "Spec: Effects",
      "targetFile": "game-art-spec.json",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "Effect spec entries. Scope: nodeId=<effects-frame-id>. Reference particle asset ids from game-art-assets.json.",
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

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique (e.g. `game-art-tokens`, `game-art-assets-particles`) |
| name | Descriptive (e.g. "Game-Art Tokens", "Assets: Particles") |
| targetFile | MUST be in targetFiles array |
| description | Clear scope + Figma nodeIds + asset-source kind policy |
| priority | See priority ranges above |
| parallelGroup | One group per task |

---

## 📋 TASK DESCRIPTION GUIDELINES

### game-art-tokens (single)

**MUST include in description:**
- "derived from `gameArtTier.concept`"
- "Use `figma_get_variable_defs` against root nodeId"

### game-art-assets-{category}

**MUST include in description:**
- The Figma frame nodeId(s) the category scopes to
- Asset-source kind hint: "external for user-placed sprite exports;
  inline for css-only primitives"

### game-art-spec-{category}

**MUST include in description:**
- The category's behavioral scope (motion / lifecycle / policy)
- "Reference asset ids from `game-art-assets.json`"

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:

### JSON Structure
- ✅ Valid JSON syntax
- ✅ `targetFiles` contains only requested documents
- ✅ Every task's `targetFile` is in `targetFiles` array
- ✅ All fields present (id, name, targetFile, description, priority, parallelGroup)
- ✅ Priority in correct range (100-149, 200-249, 300-349)

### Category Discipline
- ✅ At least 1 task per included document
- ✅ Each category id is unique
- ✅ No empty categories

### Task Descriptions
- ✅ Token task description mentions `gameArtTier.concept` and (when GDD present) cites `GDD §4 / §6` Aesthetic + Reward vocabulary
- ✅ Assets task descriptions mention the inline / external kind policy
- ✅ Spec task descriptions reference asset ids
- ✅ Every task scopes a Figma nodeId where applicable
- ✅ When GDD is in source documents: every assets task description cites the `EN-` / `LV-` IDs and the Figma node-id mapping with alignment source
- ✅ When GDD is in source documents: every spec task description cites the `MC-` / `RW-` IDs
- ✅ When GDD is absent: every task description states `GDD absent — categories extracted from Figma frames`

---

## 🎨 GAME-ART POLICY DETECTION

After the main JSON output, output a `<gameArtTier>` tag with the
detected game-art-tier axis values.

{{> jobs/shared/injections/game-art-tier-detection}}
{{/if}}
