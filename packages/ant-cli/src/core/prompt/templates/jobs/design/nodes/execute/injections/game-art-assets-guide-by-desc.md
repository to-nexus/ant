## game-art-assets.json Generation Guide (Directive only)

### Purpose
Author one category of asset entries in `game-art-assets.json` from a
directive only — without reference images or Figma frames as grounding.

### Surface scope (D24-revised v8 — sub-sourced canonical)
- Output path: `outputs/design/game-art/ant/game-art-assets.json` (mirrors `outputs/design/ui/ant/`).

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task; do NOT bleed into siblings
- Do NOT write `outputs/design/ui/...` paths — that is the UI surface
  (I6 Asset Surface Boundary)

### Asset-Source Kind Policy (D20 — directive-only inline-first)

| kind       | When valid (directive-only mode)                                              |
|------------|--------------------------------------------------------------------------------|
| `inline`   | Default — every entry without a directive-referenced external file             |
| `external` | When the directive explicitly names a user-placed file (e.g. "use my hero.svg") OR when `_meta.phaseScope === 'p4-external-enabled'` and the asset category supports external mapping (sfx / bgm / atlas / entities) |

**Directive-only constraint**: Without references or Figma, the LLM
CANNOT invent production sprite paths — `kind: 'external'` entries are
allowed only when the directive supplies the file name AND the file is
present under `inputs/assets/game/...`.

### Phase 4 external-asset hook (`_meta.phaseScope === 'p4-external-enabled'`)

When the project marks `_meta.phaseScope` as `'p4-external-enabled'`, the
following category-specific external mappings activate:

| Category      | External activation                                                                 |
|---------------|--------------------------------------------------------------------------------------|
| `sfx`         | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `inputs/assets/game/sfx/`         |
| `bgm`         | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `inputs/assets/game/bgm/`         |
| `atlas`       | `kind: 'external'` atlas JSON + image pairs under `inputs/assets/game/atlas/`       |
| `entities`    | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/entities/`             |
| `particles`   | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/particles/`            |
| `projectiles` | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/projectiles/`          |

Under `_meta.phaseScope === 'p2-css-only'` (default), all SFX / BGM
entries MUST stay `kind: 'inline'` (`format: 'oscillator'` for SFX, BGM
omitted entirely or also procedural). The code job's audio loader honors
the marker — `audioProfile === 'fileBased'` while `phaseScope === 'p2-css-only'`
falls back to procedural at runtime.

#### `kind: 'inline'` shape (D21 — DEFAULT)

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

For procedural audio:

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
- ❌ Full BGM tracks

**Concept alignment**: The inline visuals MUST reflect
`gameArtTier.concept`'s palette and silhouette weight (see
`game-art-tokens.json`). Reference token paths instead of inlining hex
values when possible (e.g. `fill='currentColor'` paired with CSS
custom properties).

#### `kind: 'external'` shape (rare in directive-only mode)

```json
{
  "id": "<stable-id>",
  "kind": "external",
  "src": "inputs/assets/game/<subdir>/<file>",
  "format": "svg" | "png" | "jpg" | "webp" | "json",
  "rendering": "sprite" | "graphics-blit" | "div"
}
```

`src` MUST start with `inputs/assets/game/`. The system validates the
file exists; non-existent paths cause task failure.

### JSON Structure

```json
{
  "_meta": {
    "phaseScope": "p2-css-only" | "p4-external-enabled"
  },
  "<your-category>": [
    /* entries — inline-first under p2-css-only;
       inline + external under p4-external-enabled */
  ]
}
```

`phaseScope` derivation: when the project basis declares
`gameArtTier.audioProfile === 'fileBased'` or `'hybrid'`, OR
`gameArtTier.entityCatalog === 'rich'`, OR
`gameArtTier.particleProfile === 'heavy'`, the scope is
`'p4-external-enabled'`. Otherwise default to `'p2-css-only'`.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category.

```xml
<append path="outputs/design/game-art/ant/game-art-assets.json">
{
  "<your-category>": [
    /* entries */
  ]
}
</append>
```
{{else}}
**First task**: use `<file>` with `_meta`.

```xml
<file path="outputs/design/game-art/ant/game-art-assets.json">
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

1. **Single category** per task
2. **Stable ids** (kebab-case, unique)
3. **inline-first**: external entries only with directive-referenced files
4. **Inline scope respected**: simple primitives only
5. **Concept-aligned**: visuals reflect `gameArtTier.concept` mood
6. **Path safety**: any external `src` starts with `inputs/assets/game/`
7. **Valid JSON**

### Workflow

1. Re-read the directive to extract the category's intended entries
2. For each entry:
   - Default to `kind: 'inline'` with a simple primitive
   - Use `kind: 'external'` only when the directive names a specific
     user-placed file
3. If the directive lacks specifics for a category — emit fewer, simpler
   inline entries rather than inventing details
