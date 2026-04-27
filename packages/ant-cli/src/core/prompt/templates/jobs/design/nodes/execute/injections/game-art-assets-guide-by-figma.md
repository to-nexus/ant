## game-art-assets.json Generation Guide (Figma)

### Purpose
Author one category of asset entries in `game-art-assets.json`.
Categories are LLM-decided dictionary keys (D25). Each Figma frame /
component group maps to one category.

### Surface scope (D24-revised v8 — sub-sourced canonical)
- Output path: `outputs/design/game-art/ant/game-art-assets.json` (mirrors `outputs/design/ui/ant/`).

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task; do NOT bleed into siblings
- Do NOT write `outputs/design/ui/...` paths — that is the UI surface
  (I6 Asset Surface Boundary)

### Asset-Source Kind Policy (D20 — TWO kinds, exactly one per entry)

| kind       | Where data lives | Production scope                                                       |
|------------|------------------|------------------------------------------------------------------------|
| `external` | `inputs/assets/game/<subdir>/<file>` | Production-grade — user-placed sprite export from Figma     |
| `inline`   | Embedded in the JSON | Simple-shape / single-tone / short-duration only (D21 design-time inline-payload ceiling) |

#### Figma → kind decision

| Figma observation | Recommended kind |
|-------------------|------------------|
| Component instance with stable variants AND user-placed export under `inputs/assets/game/...` | `external` |
| Component instance with stable variants but NO export placed | `inline` (simple SVG approximation only) |
| Effect / overlay frame (non-exported) | `inline` |
| Multi-layer character art frame | `external` (user must export — do NOT attempt to inline-recreate) |

#### `kind: 'external'` shape

```json
{
  "id": "<stable-id>",
  "kind": "external",
  "src": "inputs/assets/game/<subdir>/<file>",
  "format": "svg" | "png" | "jpg" | "webp" | "json",
  "rendering": "sprite" | "graphics-blit" | "div",
  "figmaNodeId": "<source-frame-nodeId>"
}
```

The `figmaNodeId` field provides traceability back to the source frame.

#### `kind: 'inline'` shape (D21 design-time inline-payload ceiling)

Same shape as in the by-desc variant:
- SVG: `format: 'svg', svg: '<svg viewBox=...>'`
- CSS: `format: 'css', css: '.id { ... }'`
- Audio: `format: 'oscillator', oscillator: { type, frequency, durationMs, gain }`

**Inline scope (D21)**: viewBox ≤ 64; ≤ 5 paths; single-tone CSS;
OscillatorNode `durationMs` ≤ 200.

### External-asset hook (per-marker)

External mapping availability is split between the two markers; each
category is gated by exactly one of them:

| Category      | Gate                                  | External activation                                                            |
|---------------|---------------------------------------|--------------------------------------------------------------------------------|
| `sfx`         | `_meta.audioScope === 'external-enabled'` | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `inputs/assets/game/sfx/` |
| `bgm`         | `_meta.audioScope === 'external-enabled'` | `kind: 'external'` `.mp3` / `.ogg` / `.wav` under `inputs/assets/game/bgm/` |
| `entities`    | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/entities/` (typical Figma export target) |
| `particles`   | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/particles/`       |
| `projectiles` | always (single-image)                 | `kind: 'external'` `.png` / `.svg` under `inputs/assets/game/projectiles/`     |
| `atlas`       | `_meta.visualScope === 'atlas-enabled'`   | `kind: 'external'` atlas JSON + image pairs under `inputs/assets/game/atlas/` |

Marker derivation:

- `audioScope`: when the project basis declares
  `gameArtTier.audioProfile === 'fileBased'` or `'hybrid'`, set
  `'external-enabled'`. Otherwise default to `'procedural-only'`.
- `visualScope`: when the project basis declares
  `gameArtTier.entityCatalog === 'rich'` OR
  `gameArtTier.particleProfile === 'heavy'` OR
  `gameArtTier.projectilePolicy === 'complex'`, set `'atlas-enabled'`.
  Otherwise default to `'baseline'`.

### JSON Structure

```json
{
  "_meta": {
    "audioScope": "procedural-only" | "external-enabled",
    "visualScope": "baseline" | "atlas-enabled"
  },
  "<your-category>": [
    /* entries */
  ]
}
```

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
3. **kind discipline**: every entry has exactly one `kind`
4. **Path safety**: external `src` starts with `inputs/assets/game/`
5. **Inline scope respected**: no production-grade artwork inlined
6. **Figma traceability**: every `external` entry includes `figmaNodeId`
7. **Valid JSON**

### Workflow

1. `figma_get_design_context` against your task's frame nodeId
2. For each component instance / variant in the frame:
   - If a user export exists under `inputs/assets/game/...` (use
     `list_assets` to verify) → `kind: 'external'` with `figmaNodeId`
   - Otherwise → `kind: 'inline'` with simple SVG approximation
3. Optionally `figma_get_screenshot` to confirm the inline approximation
   is visually plausible
