## game-art-assets.json Generation Guide (References + PRD)

### Purpose
Author one category of asset entries in `game-art-assets.json`.
Categories are LLM-decided dictionary keys (D25) — typically one of
`entities` / `particles` / `projectiles` / `sfx` / `bgm` / `tilemaps`,
but the game's needs decide.

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-assets.json`

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- `game-art-assets-entities` → writes `entities` key
- `game-art-assets-particles` → writes `particles` key
- Do NOT write categories outside your task — other tasks own them
- Do NOT write `outputs/design/ui/...` paths — that is the UI surface
  (I6 Asset Surface Boundary; cross-pollution causes lint failure)

### Asset-Source Kind Policy (D20 — TWO kinds, exactly one per entry)

Every entry MUST have one and only one `kind`:

| kind       | Where data lives | Production scope                                                       |
|------------|------------------|------------------------------------------------------------------------|
| `external` | `inputs/assets/game/<subdir>/<file>` | Production-grade — user-placed via `inputs/assets/game/`     |
| `inline`   | Embedded in the JSON | Simple-shape / single-tone / short-duration only (D21 css-only policy) |

#### `kind: 'external'` shape

```json
{
  "id": "<stable-id>",
  "kind": "external",
  "src": "inputs/assets/game/<subdir>/<file>",
  "format": "svg" | "png" | "jpg" | "webp" | "json",
  "rendering": "sprite" | "graphics-blit" | "div"
}
```

**Constraint**: `src` MUST start with `inputs/assets/game/`. The system
validates the file exists; non-existent paths cause task failure.
**Constraint**: Only Phase 2-allowed extensions (image + JSON tilemap).
Audio / atlas / glb extensions are reserved for Phase 4.

#### `kind: 'inline'` shape (D21 css-only policy)

For SVG primitives:

```json
{
  "id": "<stable-id>",
  "kind": "inline",
  "format": "svg",
  "svg": "<svg viewBox='0 0 64 64'>...simple paths only...</svg>",
  "rendering": "graphics-blit" | "div"
}
```

For CSS-only primitives:

```json
{
  "id": "<stable-id>",
  "kind": "inline",
  "format": "css",
  "css": ".asset-id { width: 32px; height: 32px; ... }",
  "rendering": "div"
}
```

For procedural audio (OscillatorNode):

```json
{
  "id": "<stable-id>",
  "kind": "inline",
  "format": "oscillator",
  "oscillator": {
    "type": "sine" | "square" | "triangle" | "sawtooth",
    "frequency": <number>,
    "durationMs": <number>,
    "gain": <number>
  }
}
```

**Inline scope (D21)**:
- ✅ `viewBox` side ≤ 64; ≤ 5 paths
- ✅ Single-tone CSS background or radial-gradient
- ✅ OscillatorNode with `durationMs` ≤ 200
- ❌ Multi-layer character art / detailed sprite sheets
- ❌ Full BGM tracks / multi-stage audio envelopes

**Reference image principle**: When references show a complex sprite,
prefer `kind: 'external'` (the user must provide the file). Inline is
for prototype primitives the user hasn't placed yet.

### JSON Structure (per task — one category)

```json
{
  "_meta": {
    "phaseScope": "p2-css-only"
  },
  "<your-category>": [
    /* entries — see kind shapes above */
  ]
}
```

`_meta.phaseScope` is `p2-css-only` for Phase 2; the first task to
write this file SHOULD include the `_meta`. Continuation tasks (other
categories) MUST NOT overwrite an existing `_meta`.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category into
the shared JSON. Per-file mutex + deep merge handles concurrent writes.

```xml
<append path="outputs/design/game-art/game-art-assets.json">
{
  "<your-category>": [
    /* entries */
  ]
}
</append>
```
{{else}}
**First task**: use `<file>` to create the document with `_meta`.

```xml
<file path="outputs/design/game-art/game-art-assets.json">
{
  "_meta": { "phaseScope": "p2-css-only" },
  "<your-category>": [
    /* entries */
  ]
}
</file>
```
{{/if}}

### Quality Criteria

1. **Single category**: only your task's category present
2. **Stable ids**: every `id` is kebab-case, unique, descriptive
3. **kind discipline**: exactly one `kind` per entry, matching the
   policy above
4. **Path safety**: every `kind: 'external'` `src` starts with
   `inputs/assets/game/` (I6)
5. **Inline scope respected**: no production-grade artwork inlined
6. **Valid JSON**: proper syntax

### Workflow

1. `list_reference_images` → see what references exist
2. `read_reference_image` → understand the visual target
3. `list_assets` (scoped to `inputs/assets/game/`) → see user-placed
   sprites available for `kind: 'external'`
4. Author entries — prefer `external` when a matching file exists,
   `inline` for css-only primitives the user hasn't supplied
