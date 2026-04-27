## Particle Profile: Light

**Activation gate**: `gameArtTier.particleProfile === 'light'`.

### Promise

The `light` particle profile commits to **5–10 particles per emit event, single texture per emitter, brief lifetime (~300–600ms)**. Match-clear spark, food-eat pulse, brick-break debris — small, cheap, single-color or single-shape bursts that land at the moment of feedback and disappear. The scene rewards the player without filling with shrapnel.

### What "light" looks like in code

- `Phaser.GameObjects.Particles` instances scoped to specific events: match-clear, food-eat, brick-destroy, score-tick.
- 5–10 particles per `emitParticle()` call. Lifetime ≤ 600ms. Single particle texture per emitter (often a 4x4 colored rect or a tiny circle svg).
- The texture is css-only-realizable: a single solid color circle or a tiny svg shape rendered via `Graphics.fillCircle` and converted to texture, OR an inline `kind: 'inline'` particle entry that the engine consumes verbatim.
- CSS shrapnel for HUD (e.g. score-pop confetti on level-up) uses ≤ 5 absolutely-positioned `<div>` elements with `transform` + `opacity` keyframes — not a real particle system, but counted under the `light` budget.

### `game-art-assets.json` particles category shape

```jsonc
"particles": [
  { "id": "match-spark", "kind": "inline", "format": "css", "css": "background: #FFD700; border-radius: 50%; width: 6px; height: 6px;" },
  { "id": "food-pulse", "kind": "inline", "format": "svg", "svg": "<circle cx='4' cy='4' r='4' fill='#7DFF8E'/>" }
]
```

Each entry is a single shape; the emitter config (count, spread, lifetime) is in `game-art-spec.json` `effects` category, not in the asset catalog itself.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `match3` → `light` is the canonical match. Match-clear spark (3-match → 5 particles, 4-match → 7 particles, 5-match → 10 particles + accent color) is the genre's sweet spot.
- `arcadeSnake` → `light` works well for the food-eat pulse moment. Otherwise the snake body's grid-tick advance has no particle need.
- `arcadePaddle` → `light` is the lower-bound option for brick break (5–10 debris particles per brick). For more theatric feedback, `heavy`.
- `slidingPuzzle` → `light` is unusual but legal — the reflective tone usually asks for no particles, but a tile-solved flourish at the goal-state moment can be a `light` pulse.
- `cardSolitaire` → `light` is unusual. Reserve for the foundation-completion celebration only (cascade of stars across the foundation row).

### Code-time consequences

- Phaser `BootScene.preload` may need a single small texture per particle id (or the project draws particles into a `Graphics` context inline).
- The motion budget rises by ~2–3ms per frame during active emit windows; idle scenes have zero particle cost.
- Particle emitters are typically attached to short-lived events — the project should NOT keep emitters running continuously (that drifts toward `heavy`).

### Concept affinity (D32-revised v8 — guidance, not strict)

`light` pairs naturally with `flatMinimal` (single-color sparks), `softPastel` (gentle pulse), and `pixelRetro` (era-appropriate 1–4-pixel shrapnel — limited but expected). `neonArcade` benefits from `light` (neon spark on hit) and can step up to `heavy`. `cardClassic` rarely uses `light`; the table aesthetic prefers `none`.

### Blind-spot reminders

- ⚠️ A `light` profile that emits 20+ particles per event is creeping into `heavy` — the LLM may need to constrain the count.
- ⚠️ Continuous emitters (always-on trails, ambient dust) are not `light` even at low particle counts — that pattern belongs to `heavy`. `light` is event-bursted, not ambient.
- ⚠️ `light` while `visualScope === 'baseline'` is fully feasible — particle textures stay inline. External particle atlases activate at `visualScope === 'atlas-enabled'`.
