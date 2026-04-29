## ExecutionTier Classification

**Observation target**: The breadth of game-art documentation implied by
the directive and source documents — without reference images or Figma
frames as grounding refs.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only explanation; no game-art document produced. |
| `1` | OneShot       | Single concrete edit to one existing game-art document (e.g. a single category add). |
| `2` | Exploratory   | Must observe the directive / sources before choosing what to document; still a single cohesive edit. |
| `3` | Task          | Multiple categories of game-art documentation driven by the directive. **Default tier for directive-only generate mode.** |
| `4` | RefsGrounded  | Not applicable to directive-only mode (no reference images / Figma frames are present). |

**Constraint**: Emit exactly one `<executionTier>N</executionTier>` tag
BEFORE the JSON output. `N` is a single digit `0`–`3`.

⚠️ **Blind spot**: Even when source documents (PRD) are present,
directive-only generation is `3`, NOT `4`. Tier 4 requires reference
images or Figma frames — sources alone do not satisfy "RefsGrounded".

---

## 📋 CRITICAL RULES

### 1. Token Limit Safety (MOST IMPORTANT)

- **Claude Sonnet max output: 8,192 tokens**
- **~600 lines = ~7,200 tokens** (safe threshold)
- **Each TASK output must stay under 600 lines**

### 2. Category-Based = Independent Parallel Writes

- `game-art-assets-entities` → writes the `entities` key of `game-art-assets.json`
- All assets tasks share the same `targetFile`, but each owns a unique
  top-level dictionary key

### 3. Line Budget Guidelines

**Each category ≤ 400 lines**. Without references, individual category
size tends to be smaller than ref-grounded mode — concept inflation is
the larger risk.

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
Each task MUST include `sourceFiles` — an array of source filenames.

- Observe each file's relevance to the task's domain concepts
- ⚠️ **Blind spot**: Foundational context files (game design pillars,
  shared lore docs) are relevant to every category — do NOT skip them
{{/if}}

### 7. Category Exclusivity (MECE Principle)

**CONSTRAINT**: Each category key MUST be assigned to exactly ONE task.

- Empty categories MUST be omitted

### 7.5 GDD Hand-off Citation (when GDD is in source documents)

When the GDD provides `EN-XXX` / `LV-XXX` identifiers in §8 Content
Scope and `MC-XXX` / `RW-XXX` in §4 / §6, asset and spec category
derivation MUST cite those IDs:

- Each `game-art-assets-{category}` task description MUST cite the
  `EN-` / `LV-` IDs the category covers
  (e.g., `Implements GDD §8 (EN-Hero, EN-Hero-Wounded)`)
- Each `game-art-spec-{category}` task description MUST cite the
  `MC-` / `RW-` IDs (e.g., `Implements GDD §4 / MC-Combat`)
- The `game-art-tokens` task description MUST cite `GDD §4 / §6`
  Aesthetic + Reward & Feedback vocabulary
- An asset / spec task without a GDD citation creates shadow IDs that
  diverge from the planner's commitment. When the GDD is genuinely
  absent, state `GDD absent — categories extracted from directive` in
  each task description so the gap is visible.

### 8. Asset-Source Kind Discipline (CRITICAL — D20 / D21)

**Every asset entry has exactly one `kind: 'inline' | 'external'`.**

| kind       | Where data lives | Production scope                                                       |
|------------|------------------|------------------------------------------------------------------------|
| `external` | `assets/game/<subdir>/<file>` | Production-grade — user-placed                |
| `inline`   | Embedded in JSON (`svg` / `css` / `oscillator`) | Simple-shape / single-tone / short-duration only |

**Inline scope (D21 — Phase 2 css-only policy)**:

- ✅ A small SVG with `≤ 5` paths and `viewBox` of side `≤ 64`
- ✅ A short CSS rule using single-tone background / radial-gradient
- ✅ An OscillatorNode config with `durationMs ≤ 200`
- ❌ Multi-layer character art / detailed sprite sheets / full BGM tracks

**Directive-only constraint**: Without reference images, do NOT attempt
"realistic" or "high-fidelity" inline assets. Stay strictly within the
simple-shape envelope; the user's directive is intentionally inviting
prototype-level inline content, not production-grade artwork.

**External entries**: Allowed only when the directive explicitly
references a user-placed file (e.g. "use my hero.svg under
assets/game/entities/"). The src path MUST start with
`assets/game/`.

---

## 🚫 FORBIDDEN TASKS

DO NOT CREATE:
- ❌ "Final verification" or "review" tasks
- ❌ Deployment / Operations / Infrastructure tasks
- ❌ Single mega-task that writes all three documents
- ❌ Empty categories
- ❌ Tasks targeting `visual/ui/...` or `assets/service/...`
  — those belong to UI design intents (I6 surface boundary)
- ❌ External `kind` entries pointing at files the directive did not
  reference (production sprite manifest is the user's responsibility,
  not the LLM's invention)
{{#if (eq detectedMode "refactor")}}
- ❌ Multiple category-based tasks (refactor mode = single focused task)
{{/if}}

---

{{#if (eq detectedMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

Emit the meta tags first, then a `<tasks>` block with **one** `<task>{json}</task>` element. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

Example:

```
<executionTier>1</executionTier>
<jobMode>refactor</jobMode>
<targetFiles>["{target}.json"]</targetFiles>
<tasks>
  <task>{"id":"refactor-{document}-{category}","name":"Refactor: {brief description}","targetFile":"{target}.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"{modification scope}. Keep all other content unchanged.","priority":300,"parallelGroup":"refactor-{document}-{category}"}</task>
</tasks>
```

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{document}-{category}` |
| Description | Must include "Keep all other content unchanged" |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

Emit the meta tags first, then a `<tasks>` block with one `<task>{json}</task>` element per task. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

For directive-only generation, the `<executionTier>` is typically `3`
(multi-category) or `2` (single cohesive prototype).

Example:

```
<executionTier>3</executionTier>
<targetFiles>["game-art-tokens.json", "game-art-assets.json", "game-art-spec.json"]</targetFiles>
<tasks>
  <task>{"id":"game-art-tokens","name":"Game-Art Tokens","targetFile":"game-art-tokens.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Palette, silhouette, lighting, motion tone derived from gameArtTier.concept.","priority":100,"parallelGroup":"game-art-tokens"}</task>
  <task>{"id":"game-art-assets-entities","name":"Assets: Entities","targetFile":"game-art-assets.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Entity asset entries (hero, enemies, collectibles). Without references, default to kind:inline using simple SVG / CSS primitives.","priority":200,"parallelGroup":"game-art-assets-entities"}</task>
  <task>{"id":"game-art-spec-effects","name":"Spec: Effects","targetFile":"game-art-spec.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Effect spec entries (match-clear, hover, hit-feedback). Reference particle / entity asset ids from game-art-assets.json.","priority":300,"parallelGroup":"game-art-spec-effects"}</task>
</tasks>
```

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique (e.g. `game-art-tokens`, `game-art-assets-particles`) |
| name | Descriptive |
| targetFile | MUST be in targetFiles array |
| description | Clear scope + asset-source kind hint (default `inline`) |
| priority | See priority ranges above |
| parallelGroup | One group per task |

---

## 📋 TASK DESCRIPTION GUIDELINES

### game-art-tokens (single)

**MUST include in description:**
- "derived from `gameArtTier.concept`"

### game-art-assets-{category}

**MUST include in description:**
- The category name in plain English
- Asset-source kind hint: "default to kind:inline using simple SVG / CSS
  primitives" (directive-only); "external only if the directive
  references a specific user-placed file"

### game-art-spec-{category}

**MUST include in description:**
- The category's behavioral scope (motion / lifecycle / policy)
- "Reference asset ids from `game-art-assets.json`"

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:

### Output Structure
- ✅ `<executionTier>` tag emitted FIRST, BEFORE any other meta tag
- ✅ `<targetFiles>` body is a JSON-encoded array of filenames
- ✅ One `<task>{json}</task>` element per task inside `<tasks>...</tasks>`
- ✅ NO markdown fences anywhere in the output
- ✅ NO `<decompose>` wrapper

### JSON Structure (per `<task>` body)
- ✅ Valid JSON syntax
- ✅ Every task's `targetFile` is in the `<targetFiles>` array
- ✅ All fields present
- ✅ Priority in correct range

### Category Discipline
- ✅ At least 1 task per included document
- ✅ Each category id is unique
- ✅ No empty categories

### Asset Kind Defaults
- ✅ When `assetCount = 0`, every assets task description specifies
  inline as default
- ✅ External entries only present if the directive explicitly references
  a user-placed file (or the GDD §8 cites a sprite path for that entity)

### GDD Hand-off Citation
- ✅ When GDD is in source documents: every `game-art-assets-{category}`
  description cites the `EN-` / `LV-` IDs it covers
- ✅ When GDD is in source documents: every `game-art-spec-{category}`
  description cites the `MC-` / `RW-` IDs it covers
- ✅ When GDD is in source documents: `game-art-tokens` description
  cites `GDD §4 / §6` Aesthetic + Reward vocabulary
- ✅ When GDD is absent: every task description states
  `GDD absent — categories extracted from directive`

---

## 🎨 GAME-ART POLICY DETECTION

After the main JSON output, output a `<gameArtTier>` tag with the
detected game-art-tier axis values.

{{> jobs/shared/injections/game-art-tier-detection}}
{{/if}}
