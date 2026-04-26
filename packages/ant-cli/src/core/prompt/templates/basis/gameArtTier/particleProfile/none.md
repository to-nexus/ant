## Particle Profile: None

**Activation gate**: `gameArtTier.particleProfile === 'none'`.

### Promise

The `none` particle profile commits to **zero particle emitters in the project**. No spark on match clear, no debris on brick break, no trail behind the ball, no dust under the snake. Visual feedback comes purely from sprite tweens (`motionPattern`), color shifts (`game-art-tokens.json`), and audio (`audioProfile`). The scene stays clean.

### What "none" looks like in code

- No `Phaser.GameObjects.Particles` instances in the scene graph.
- No `requestAnimationFrame` particle update loops.
- No CSS `@keyframes` or `animation` rules that simulate particles via inline `<div>` shrapnel.
- `game-art-assets.json` has no `particles` category, or the category is empty (`"particles": []`).

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `slidingPuzzle` → `none` is the canonical match. The genre's reflective tone has no use for particle bursts.
- `cardSolitaire` → `none` is the canonical match. The card-table aesthetic does not want shrapnel; only the win-state cascade flourish is acceptable, and that is achieved via `motionPattern` (cards fanning out), not particles.
- `match3` → `none` is unusual. Match-3 typically benefits from at least `light` (match-clear spark). Use `none` only for the most minimalist match-3 variants that lean fully on color / motion.
- `arcadePaddle` → `none` is unusual. The brick break naturally calls for a debris burst.
- `arcadeSnake` → `none` is acceptable for minimalist Tron-style snake; use `light` if the food-eat moment wants a pulse.

### Code-time consequences

- `BootScene.preload` does not load any particle texture assets.
- The render budget is the lightest possible — `none` projects can ship at 60 fps on the most modest devices.
- HUD overlay rendering (React-side) keeps its own animations; `none` here only constrains the in-canvas surface.

### Concept affinity (D32-revised v8 — guidance, not strict)

`none` pairs naturally with `cardClassic` and `pixelRetro` (era-faithful, no particle systems on the original hardware). It works for `flatMinimal` and `softPastel` (calm aesthetics). `neonArcade` rarely benefits from `none` — neon visuals expect at least a glow trail.

### Blind-spot reminders

- ⚠️ `none` while `motionPattern === 'expressive'` lands lopsided — expressive motion expects particle synergy. Consider `light` or downgrade motion.
- ⚠️ `none` while the project explicitly asks for "juicy" feedback (PRD describes "feels alive") is a category mismatch — the LLM may have selected `none` to be conservative; revisit.
- ⚠️ Adding inline `<div>` shrapnel via CSS animations to circumvent `particleProfile === 'none'` is a contract violation — those are particles in disguise.
