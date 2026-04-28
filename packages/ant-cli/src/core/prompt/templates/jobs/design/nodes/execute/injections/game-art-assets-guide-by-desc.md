## game-art-assets.json Generation Guide (Directive only)

### Purpose
Author one category of asset entries in `game-art-assets.json` from a
directive only — without reference images or Figma frames as grounding.

### Surface scope (sub-sourced canonical)
- Output path: `visual/game-art/ant/game-art-assets.json` (mirrors `visual/ui/ant/`).

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task; do NOT bleed into siblings
- Do NOT write `visual/ui/...` paths — that is the UI surface
  (I6 Asset Surface Boundary)

### Asset-Source Kind Policy (D20 — directive-only inline-first)

| kind       | When valid (directive-only mode)                                              |
|------------|--------------------------------------------------------------------------------|
| `inline`   | Default — every entry without a directive-referenced external file             |
| `external` | When the directive explicitly names a user-placed file (e.g. "use my hero.svg") OR when the relevant scope marker is upgraded — `_meta.audioScope === 'external-enabled'` for `sfx` / `bgm`, `_meta.visualScope === 'atlas-enabled'` for `atlas` / multi-image entities |

**Directive-only constraint**: Without references or Figma, the LLM
CANNOT invent production sprite paths — `kind: 'external'` entries are
allowed only when the directive supplies the file name AND the file is
present under `assets/game/...`.

### External-asset hook (per-marker)

External mapping availability is split between the two markers; each
category is gated by exactly one of them:

| Category      | Gate                                  | External activation                                                            |
|---------------|---------------------------------------|--------------------------------------------------------------------------------|
| `sfx`         | `_meta.audioScope === 'external-enabled'` | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `assets/game/sfx/` |
| `bgm`         | `_meta.audioScope === 'external-enabled'` | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `assets/game/bgm/` |
| `entities`    | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `assets/game/entities/`        |
| `particles`   | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `assets/game/particles/`       |
| `projectiles` | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `assets/game/projectiles/`     |
| `atlas`       | `_meta.visualScope === 'atlas-enabled'`   | `kind: 'external'` atlas JSON + image pairs under `assets/game/atlas/` |

Under `_meta.audioScope === 'procedural-only'` (default), all SFX / BGM
entries MUST stay `kind: 'inline'` (`format: 'oscillator'` for SFX, BGM
omitted entirely or also procedural). The code job's audio loader honors
the marker — `audioProfile === 'fileBased'` while
`audioScope === 'procedural-only'` falls back to procedural at runtime.

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
  "src": "assets/game/<subdir>/<file>",
  "format": "svg" | "png" | "jpg" | "webp" | "json",
  "rendering": "sprite" | "graphics-blit" | "div"
}
```

`src` MUST start with `assets/game/`. The system validates the
file exists; non-existent paths cause task failure.

### JSON Structure

```json
{
  "_meta": {
    "audioScope": "procedural-only" | "external-enabled",
    "visualScope": "baseline" | "atlas-enabled"
  },
  "<your-category>": [
    /* entries — inline-first when both markers are at default;
       per-marker external activation when upgraded */
  ]
}
```

Marker derivation:

- `audioScope`: when the project basis declares
  `gameArtTier.audioProfile === 'fileBased'` or `'hybrid'`, set
  `'external-enabled'`. Otherwise default to `'procedural-only'`.
- `visualScope`: when the project basis declares
  `gameArtTier.entityCatalog === 'rich'` OR
  `gameArtTier.particleProfile === 'heavy'` OR
  `gameArtTier.projectilePolicy === 'complex'`, set `'atlas-enabled'`.
  Otherwise default to `'baseline'`.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category.

```xml
<append path="visual/game-art/ant/game-art-assets.json">
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
<file path="visual/game-art/ant/game-art-assets.json">
{
  "_meta": { "audioScope": "procedural-only", "visualScope": "baseline" },
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
6. **Path safety**: any external `src` starts with `assets/game/`
7. **Valid JSON**

### Workflow

1. Re-read the directive to extract the category's intended entries
2. For each entry:
   - Default to `kind: 'inline'` with a simple primitive
   - Use `kind: 'external'` only when the directive names a specific
     user-placed file
3. If the directive lacks specifics for a category — emit fewer, simpler
   inline entries rather than inventing details
