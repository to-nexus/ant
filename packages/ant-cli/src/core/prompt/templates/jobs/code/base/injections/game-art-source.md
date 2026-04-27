## GAME-ART SOURCE — ANT CANONICAL

### Observation targets

- `game-art-tokens.json` — palette / silhouette / lighting / motion-tone + HUD CSS tokens (spacing rhythm, typography, border-radius, shadow). Concept-derived.
- `game-art-assets.json` — category-keyed asset catalog (`entities` / `particles` / `projectiles` / `sfx` / `bgm` / `tilemaps` / ...). Each entry carries `kind: 'inline' | 'external'` (D20).
- `game-art-spec.json` — category-keyed behaviour / motion / interaction specs (`effects` / `characters` / `projectiles` / `npcs` / `objectives` / `hud` / `menu` / `dialog` / ...). Categories are LLM-chosen but stable within the document (D25).

Path: `outputs/design/game-art/ant/` (D24-revised v8 — sub-sourced canonical, mirrors `outputs/design/ui/ant/`). The `figma/` and `handoff/` sub-sources are Phase 5+ hooks (parser-only today). Sections of `game-art-spec.json` are addressable by category key; the pool exposes each as `outputs/design/game-art/ant/spec/{category}`.

### Principle (Authority)

These three JSON documents are the authoritative specification for game-domain visual implementation — for BOTH the in-canvas surface (sprites / particles / projectiles / audio) AND the HUD/menu surface (D28). Treat each field as a direct constraint — do not paraphrase away a value that is explicitly present.

### Principle (One source, two render paths split by coordinate system)

A React + Phaser host runs two render paths in the same browser tab. The split is by **coordinate system** — see `jobs/code/domain/game.md` §7 for the full partition rule:

| Render path (coordinate system) | Owner | Reads | Loader |
|---|---|---|---|
| Screen-space — React HUD overlay (HUD readouts / menus / dialog / settings / page chrome) | React | `game-art-tokens.json` (HUD CSS tokens) + `game-art-spec.json` (`hud` / `menu` / `dialog` categories) | React imports inline SVG / CSS or external icons; CSS-in-JS reads tokens |
| World-space — Phaser scenes (sprites / particles / projectiles + sprite-anchored UI in `UIScene`) | Phaser | `game-art-tokens.json` (palette / silhouette / lighting / motion-tone) + `game-art-assets.json` (entities / particles / projectiles / sfx / bgm / tilemaps) | `BootScene.preload` registers textures from inline base64 or external `src` |

Both paths share **one art direction** — palette / silhouette / lighting / motion-tone come from `game-art-tokens.json` and inform the React HUD's CSS treatment as much as the sprite's appearance. The five registered genres are all single-screen so the world-space slot in `UIScene` is typically empty; every UI element resolves to screen-space (React).

### Principle (Separation of structure vs. style)

Component / scene STRUCTURE comes from the code skeleton (or refs). STYLE / behaviour / asset choice comes from `game-art-*.json`. These are orthogonal inputs; reading the skeleton first prevents accidental DOM / scene edits during a styling pass.

### Constraint (Scope markers)

Every `game-art-assets.json` carries two independent markers:

| Marker | Values | Code-time effect |
|---|---|---|
| `_meta.audioScope` | `'procedural-only'` (default) / `'external-enabled'` | `'procedural-only'` suppresses all `kind: 'external'` audio entries at load time — procedural OscillatorNode is the only audio path. `'external-enabled'` lifts the suppression and file-based audio activates. |
| `_meta.visualScope` | `'baseline'` (default) / `'atlas-enabled'` | `'baseline'` keeps the canvas on catalog entries + the engine's procedural API + build-time static assets + runtime procedural texture composition; atlas / multi-emitter / multi-projectile groups are disabled. `'atlas-enabled'` activates them. |

Code MUST honor each marker regardless of the LLM-emitted `audioProfile` / axis values. The `audioScope` marker overrides `audioProfile` when they disagree (procedural wins on the baseline boundary). image-LLM API calls and image-LLM-derived asset insertion are forbidden across both `visualScope` values — that surface is reserved for the future `visual` job.

### Constraint (Immutable skeleton)

- DOM elements / Phaser scene roots defined in the skeleton are a contract — do NOT add, remove, or rename them.
- You MAY extract sections into separate component / scene files when complexity warrants it (same DOM / scene graph, different file organisation).

### Observable

Every token key, asset id, and spec category injected into the pool is observable text. Values that are not observable (not listed in any injected section) must not be invented — fall back to GameArtTier defaults (concept / perspective derive guidance) or framework conventions instead.
