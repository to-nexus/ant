# Game-Art Design Task Decomposition (References + PRD)

You are decomposing **game-art documentation work** into executable tasks.

**Surface scope (D17/D18)**: This intent produces `game-art-tokens.json` /
`game-art-assets.json` / `game-art-spec.json` only. UI surface decisions
(`visualLanguage` / `surfaceSystem` / chapter-style page regions) are NOT in
scope here — those belong to `gen-ui-*` / `rev-ui` intents.

**Job Mode**: {{detectedMode}}

{{#if (eq detectedMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Game-Art Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create ONE focused task for the specific modification requested.

### Constraints

- ❌ Multiple category-based tasks
- ❌ Full document regeneration
- ✅ Single task targeting specific category or token group
- ✅ Task ID format: `refactor-{document}-{category}`
- ✅ Task name format: `Refactor: {brief description}`

### Output Format

```json
{
  "jobMode": "refactor",
  "targetFiles": ["{target-file}.json"],
  "tasks": [
    {
      "id": "refactor-{document}-{category}",
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
## 🆕 GENERATE MODE - Create New Game-Art Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW game-art design documents from scratch.**

**Philosophy**: One token document; multiple parallel category tasks for
assets and spec. Categories are LLM-decided dictionary keys (D25) — not a
fixed enum.
{{/if}}

---

## 📥 INPUT CONTEXT

{{#if directiveContext}}
### Directive

{{{directiveContext}}}
{{/if}}

---

{{#unless (eq detectedMode "refactor")}}
## 🎯 SELECTIVE DOCUMENT GENERATION

**Check the Directive above for explicit document requests.**

| If directive mentions...                                    | Generate ONLY...        |
|-------------------------------------------------------------|-------------------------|
| "only game-art-spec" / "regenerate game-art-spec"           | game-art-spec.json tasks  |
| "only game-art-tokens" / "regenerate game-art-tokens"       | game-art-tokens.json tasks|
| "only game-art-assets" / "regenerate game-art-assets"       | game-art-assets.json tasks|
| No specific document request                                | ALL 3 documents         |

**When generating subset:**
- `targetFiles` array contains ONLY the requested document(s)
- Skip tasks for other documents entirely
- Priority ranges remain as defined (100-149, 200-249, 300-349)

### Available Resources

| Resource | Count |
|----------|-------|
| Reference images | {{referenceCount}} |
| External asset files (`inputs/assets/game/`) | {{assetCount}} |

---

## 📊 CATEGORY-BASED TASK BREAKDOWN

**Game-art docs use categories, not chapters.** A category is a top-level
JSON dictionary key (D25):

- `game-art-assets.json` categories — `entities` / `particles` / `projectiles`
  / `sfx` / `bgm` / `tilemaps` / `models` (or any other key the game requires)
- `game-art-spec.json` categories — `effects` / `characters` / `projectiles`
  / `npcs` / `objectives` / `environments` (or any other key the game
  requires)

**Categories are NOT pre-fixed.** Choose the categories that match the
game concept observed in the directive and references. A match-3 puzzle
typically needs `entities` + `particles` + `effects` + `objectives`; a
shooter typically adds `projectiles` + `npcs`; a platformer typically adds
`tilemaps` + `environments`.

**Token Safety**: Each task output ≤ 600 lines (~7,200 tokens, with margin
under the 8K cap).

---

### game-art-tokens.json (single task)

| Task ID | Priority | Topic |
|---------|----------|-------|
| `game-art-tokens` | 100 | Palette, silhouette, lighting, motion-tone tokens — derived from `gameArtTier.concept` (sfFantasy / darkFantasy / threeKingdoms / martialArts / modernCasual / pixelRetro). |

**Single-task constraint**: tokens are global (one palette, one silhouette
weight, one motion tone). Do NOT split tokens into chapters — append-only
chapter merge is not safe for top-level scalar tokens.

---

### game-art-assets.json (category-parallel tasks)

**One task per asset category present in the game.** Choose categories
based on the directive and reference images. Categories with zero items
SHOULD be omitted entirely — do not emit empty arrays.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-assets-{category}` | 200..249 | Asset entries for one category. Each entry has `id`, `kind: 'inline' \| 'external'`, plus kind-specific fields. |

**Path consistency for external assets**: when one category mixes
`kind: 'external'` entries, every external `src` MUST start with
`inputs/assets/game/{category-or-subdir}/`. The `_meta.pathPattern` field
(see ch1 for ui-assets) is NOT used for game-art-assets — game asset
paths follow the `inputs/assets/game/<subdir>/` convention directly.

**Asset-source kind policy (D20)**:

- `kind: 'external'` — file already placed under `inputs/assets/game/...`
  by the user. Reference by `src` path; the parser validates existence.
- `kind: 'inline'` — LLM-generated SVG / CSS / oscillator config inside
  the JSON. Production-grade sprites and audio MUST NOT be attempted
  here (D21). Inline content stays under simple-shape / single-tone /
  short-duration scope; anything richer is the user's responsibility
  (external) or a future visual-job task (Phase 5+ hook).

---

### game-art-spec.json (category-parallel tasks)

**One task per spec category present in the game.** Spec categories
describe behavior / motion / policy — not asset bytes.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-spec-{category}` | 300..349 | Spec entries for one category. Each entry describes motion, lifecycle, spawn policy, or interaction rules. |

**Cross-document references**: `game-art-spec` entries MAY reference
`game-art-assets` entries by id (e.g. `effects.match-clear.particles =
"spark"` references `assets.particles[0].id = "spark"`). Spec tasks run
AFTER all assets tasks (priority barrier).

---

## 📏 CATEGORY COUNT GUIDELINES

| Game complexity | game-art-tokens | game-art-assets | game-art-spec |
|-----------------|-----------------|-----------------|---------------|
| Minimal (1 enemy, 1 effect)       | 1 task | 2-3 categories | 2 categories |
| Standard (puzzle / brawler core)  | 1 task | 3-4 categories | 3-4 categories |
| Rich (multi-level / multi-enemy)  | 1 task | 4-6 categories | 4-6 categories |

**Your resources**: references={{referenceCount}}, external assets={{assetCount}}

**Principle**: Choose categories that the directive's concept actually
requires. Adding empty categories (`projectiles: []`) is forbidden — the
absence of a category communicates intent.

{{/unless}}

---

{{! Execute-phase injection guides: static partial refs for manifest/matrix audits; branch never renders. }}
{{#if false}}
{{> jobs/design/nodes/execute/injections/art-tokens-guide-by-ref}}
{{> jobs/design/nodes/execute/injections/art-assets-guide-by-ref}}
{{> jobs/design/nodes/execute/injections/art-spec-guide-by-ref}}
{{/if}}

{{> jobs/design/nodes/decompose/variants/art-design-by-ref/rules}}
