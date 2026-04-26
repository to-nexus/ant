## Motion Pattern: Expressive

**Activation gate**: `gameArtTier.motionPattern === 'expressive'`.

### Promise

The `expressive` motion pattern commits to **spring physics, bounce, squash-and-stretch, and chained transitions** — entities advertise their motion. A tile clear is a chained pulse + scale-up + fade; a paddle hit is a screen shake + ball trail; a card flip carries an overshoot. The world rewards every interaction with a visible feedback flourish.

### What "expressive" looks like in code

| Surface | Realization |
|---|---|
| Sprite movement | Spring tween (`Phaser.Tweens` with `Back.easeOut` / `Bounce.easeOut` / `Elastic.easeOut`). Durations 300–600ms. Overshoot at the destination is intentional. |
| Squash-and-stretch | On impact / collision, the entity scales non-uniformly (e.g. ball flattens horizontally on paddle hit, recovers over 150ms). |
| Idle animation | Visible bobbing (3–5% scale wobble + 1–2px y-offset) on multiple entities. The world breathes. |
| State change | Chained tweens — e.g. "scale-up → flash → settle" runs in sequence over ~400ms. |
| Camera | Screen shake on death / big collisions (Phaser `cameras.main.shake(...)`). Subtle camera-follow lerp on player movement. |

### Iteration delta — what `expressive` adds vs `subtle`

- Multi-tween chains per state change (Phaser `Tweens.chain` or sequential timeline).
- Spring / bounce easing curves replace the simple ease-in-out family.
- Idle motion is universal — most on-screen entities have at least a subtle bob.
- Particle system fires at the same time as the tween (the two axes are coordinated; see `particleProfile`).
- Camera effects are part of the motion budget.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `arcadePaddle` → `expressive` is the canonical match. Brick break + ball trail + paddle squash + screen shake are the genre's expected feedback. The Breakout / Arkanoid tradition is loud-feedback.
- `arcadeSnake` → `expressive` is unusual. The grid-tick body advance does not benefit from spring; reserve `expressive` for the food-eat moment (entity pulse + particle burst) only.
- `match3` → `expressive` is unusual but legal for "juicy" match-3 variants (Royal Match style). The cascade chain is amplified by overshoot + particle synergy.
- `cardSolitaire` → `expressive` breaks the canonical `cardClassic` tone. Reserve for card-game variants that explicitly want a "magic shop" feel.
- `slidingPuzzle` → `expressive` mismatches the genre. Reflective puzzles want `static` or `subtle`.

### Code-time consequences

- The motion budget can hit 15ms+ per frame during peak feedback (cascading tweens + particle update + camera shake). The project must commit a frame-rate floor and may need to rate-limit feedback (one major effect at a time).
- Animation manifest entries (with `entityCatalog === 'standard'` / `rich`) define multi-frame state cycles (8–24 frames per cycle).
- `Phaser.Tweens` are layered: a single state change may queue 3–5 tweens across 2–3 properties of an entity.
- Sound (`audioProfile`) typically rises to `fileBased` or `hybrid` at this motion pattern — the SFX punctuates the visual flourish.

### Concept affinity (D32-revised v8 — guidance, not strict)

`expressive` pairs naturally with `neonArcade` (Tron / synthwave glow surge on hit) and works for `flatMinimal` (juicy modern match-3 in flat tone). It mismatches `cardClassic` (the table is calm), `softPastel` (the calm tone refuses bouncy feedback), and most of `pixelRetro` (era hardware did not support spring physics; the look is deliberate retro mismatch only).

### Blind-spot reminders

- ⚠️ `expressive` while `particleProfile === 'none'` is suspicious — expressive motion typically fires particles at the same beat. Either downgrade motion or step up particles.
- ⚠️ `expressive` while `phaseScope === 'p2-css-only'` and `audioProfile === 'procedural'` is workable but flat — expressive visuals without expressive audio land lopsided. The project may want to declare `audioProfile === 'procedural'` is a deliberate constraint.
- ⚠️ Stacking 5+ simultaneous tweens on different entities every frame degrades modest devices. The PRD should commit a "max simultaneous flourish count" if expressive feedback is critical.
