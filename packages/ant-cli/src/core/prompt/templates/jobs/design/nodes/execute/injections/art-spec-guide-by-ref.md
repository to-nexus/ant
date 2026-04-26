## game-art-spec.json Generation Guide (References + PRD)

### Purpose
Author one category of behavior / motion / policy spec entries in
`game-art-spec.json`. Categories are LLM-decided dictionary keys (D25)
— typically `effects` / `characters` / `projectiles` / `npcs` /
`objectives` / `environments`, but the game decides.

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-spec.json`

### Spec vs Assets distinction (CRITICAL)

| Document               | What it captures                                                      |
|------------------------|------------------------------------------------------------------------|
| `game-art-assets.json` | **Bytes** — visual data: SVG markup, image paths, oscillator configs   |
| `game-art-spec.json`   | **Behavior** — motion, lifecycle, spawn policy, interaction rules     |

A spec entry NEVER duplicates asset bytes. It REFERENCES asset ids:
`effects.match-clear.particles = "spark"` references the `spark` id
defined in `game-art-assets.json`'s `particles` category.

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task; do NOT bleed into siblings
- Do NOT write `outputs/design/ui/...` paths — that is the UI surface

### JSON Structure (per task — one category)

```json
{
  "_meta": {
    "gameContentTier": {
      "genre": "<from resolvedAction.basis.gameContentTier.genre>",
      "coreLoop": "<from resolvedAction.basis.gameContentTier.coreLoop>"
    }
  },
  "<your-category>": {
    "<entry-id>": {
      /* category-specific shape — see Common Patterns below */
    }
  }
}
```

`_meta` is written only by the FIRST task to create the file.

### Common Patterns (by category)

These are starting points — the directive and references decide the
actual shape.

#### `effects`
```json
{
  "match-clear": {
    "particles": "spark",
    "count": 8,
    "spread": "radial",
    "durationMs": 400,
    "intent": "Reward feedback when a 3-piece match resolves"
  }
}
```

#### `characters`
```json
{
  "hero": {
    "movement": "grid-snap",
    "tweenMs": 150,
    "states": ["idle", "select"],
    "intent": "Cursor-driven board control"
  }
}
```

#### `projectiles`
```json
{
  "arrow": {
    "trajectory": "straight",
    "speedPxPerSec": 600,
    "lifetimeMs": 1500,
    "onHit": "destroy"
  }
}
```

#### `npcs`
```json
{
  "blob-enemy": {
    "behavior": "patrol",
    "speedPxPerSec": 50,
    "states": ["idle", "alert", "stunned"]
  }
}
```

#### `objectives`
```json
{
  "coin": {
    "spawnPolicy": "match-3-clear",
    "rewardScore": 10
  }
}
```

#### `environments`
```json
{
  "forest-bg": {
    "tilemap": "forest-tiles",
    "parallax": [0.3, 0.6, 1.0]
  }
}
```

### Asset-Reference Discipline

Every `particles` / `tilemap` / `entity` reference inside a spec entry
MUST be the `id` of an asset entry in `game-art-assets.json`. If the
asset does not yet exist, either:
1. Add a corresponding `inline` entry to `game-art-assets.json` first
   (in your sibling task), or
2. Note in `intent` that the user must provide the asset externally

Do NOT inline asset bytes here.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category.

```xml
<append path="outputs/design/game-art/game-art-spec.json">
{
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
</append>
```
{{else}}
**First task**: use `<file>` with `_meta`.

```xml
<file path="outputs/design/game-art/game-art-spec.json">
{
  "_meta": {
    "gameContentTier": { "genre": "...", "coreLoop": "..." }
  },
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
</file>
```
{{/if}}

### Quality Criteria

1. **Single category** per task
2. **Behavior-only**: no asset bytes (svg / css / oscillator) here
3. **Asset references valid**: every referenced id matches a
   `game-art-assets.json` entry in your sibling task (or explicit user
   responsibility noted in `intent`)
4. **Concept alignment**: motion / lifecycle values reflect
   `gameArtTier.motionTone` from `game-art-tokens.json`
5. **No UI surface keywords**: avoid `visualLanguage`, `surfaceSystem`,
   `spatialSystem`, page-region terms (header / main / footer)
6. **Valid JSON**

### Workflow

1. `read_reference_image` — confirm the visual triggers behavior
   (which sprite plays which effect, etc.)
2. List the entries this category needs (from the directive + refs)
3. For each entry: encode behavior + reference asset ids by name
