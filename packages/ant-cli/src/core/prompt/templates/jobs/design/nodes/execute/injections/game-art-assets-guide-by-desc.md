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

### Asset-Source Kind Policy (D20 — survey-first, inline as floor)

Real asset files may already be placed under `assets/game/<category>/`. **Survey
that inventory first** (the injected asset list + `list_assets`) and prefer a
real file when one fits the entry you are authoring.

**A user-placed real file is always consumable.** The presence of a real file
under `assets/game/` activates its category for `kind: 'external'` mapping —
the scope markers below describe the AUTHORING default posture (what to
generate when nothing is placed), never a prohibition on consuming what the
user has provided.

| kind       | When valid                                                                     |
|------------|--------------------------------------------------------------------------------|
| `external` | A real inventory file under `assets/game/...` satisfies this entry's need (surveyed, or named by the directive). Its `src` is that exact path. For `sfx` / `bgm` this additionally requires `_meta.audioScope === 'external-enabled'`; for `atlas` / multi-image entities, `_meta.visualScope === 'atlas-enabled'` |
| `inline`   | Floor — used when no inventory file fits the entry (or the pool is empty). Author a simple primitive per the D21 ceiling |

**Grounding constraint**: `kind: 'external'` `src` MUST name a file that is
actually present under `assets/game/...` — either observed in the inventory or
named by the directive. Do NOT invent a production sprite path that no file
backs; if nothing fits, fall back to `inline`.

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
| `models`      | `perspective === '3d'`                | `kind: 'external'` `.glb` / `.gltf` under `assets/game/models/` — consumed via the enable3d GLTF loader; carry a `fallback` primitive (the 3D floor) |
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

**Concept alignment & token authority**: `game-art-tokens.json` is the
single palette/silhouette authority — it is authored before this task.
`read_file game-art-tokens.json` FIRST and derive every color and
silhouette value from the token keys it actually defines. Do NOT invent
a parallel palette namespace or hardcode hex values that contradict the
tokens catalog — reference the exact keys present (via `fill='currentColor'`
+ CSS custom properties, or by naming the token key in a `_palette` note).
If a needed key is absent, use the closest existing token key rather than
minting a new one.

#### `kind: 'external'` shape (preferred when a real inventory file fits)

```json
{
  "id": "<stable-id>",
  "kind": "external",
  "src": "assets/game/<subdir>/<file>",
  "format": "svg" | "png" | "jpg" | "webp" | "json" | "glb" | "gltf",
  "rendering": "sprite" | "graphics-blit" | "div",
  "fallback": {
    "format": "svg" | "css",
    "svg": "<svg viewBox='0 0 64 64'>...simple primitive...</svg>"
  }
}
```

`src` MUST start with `assets/game/`. The system validates the
file exists; non-existent paths cause task failure.

**Code-fulfillable floor — carry a fallback primitive (inline-first).**
A visual `kind: 'external'` entry (`entities` / `particles` / `projectiles`)
names a file that may be absent when the code job runs. Attach an optional
`fallback` — a single inline primitive at the css-only ceiling (same shape
as a `kind: 'inline'` entry) — so the code job can render a minimum-playable
stand-in for that `id` when the external file is not yet placed. The
`rendering` field is the complementary draw-path hint. Audio external
entries need no `fallback`: the procedural OscillatorNode floor covers them
globally. This keeps the catalog inline-first — external is the enrichment,
the primitive is the guaranteed floor.

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
3. **Grounded**: `external` entries reference a real surveyed file (`src` = its exact path); `inline` is the floor when none fits
4. **Inline scope respected**: simple primitives only
5. **Concept-aligned & token-conformant**: visuals reflect `gameArtTier.concept` mood and reference only token keys that exist in `game-art-tokens.json` — no invented palette namespace, no contradicting hex
6. **Path safety**: any external `src` starts with `assets/game/`
7. **Valid JSON**

### Workflow

1. **Survey the real inventory** — read the injected asset list (real files
   under `assets/game/`) and/or call `list_assets`. Note which files could back
   entries in YOUR category.
2. `read_file game-art-tokens.json` — the palette/silhouette SSOT. Note the
   exact token keys you will reference (colors, silhouette).
3. Re-read the directive to extract the category's intended entries.
4. For each entry:
   - If a surveyed real file fits it → `kind: 'external'`, `src` = that exact path.
   - Otherwise → `kind: 'inline'` with a simple primitive (the floor).
5. If neither the inventory nor the directive gives specifics for a category —
   emit fewer, simpler inline entries rather than inventing details.
