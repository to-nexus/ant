## Motion Pattern: Static

**Activation gate**: `gameArtTier.motionPattern === 'static'`.

### Promise

The `static` motion pattern commits to **discrete position changes** — entities snap from one cell / position to the next without intermediate tween. There is no velocity model, no easing curve, no spring. The world advances on a fixed-timestep tick and every visible change is a frame swap, not a smooth interpolation.

### What "static" looks like in code

| Surface | Realization |
|---|---|
| Sprite movement | `entity.x = newX; entity.y = newY` on the tick boundary. No `Phaser.Tweens.add({ x, y, duration })` calls. |
| Idle animation | None. The entity holds its pose between input events. |
| State change | Hard-cut on the same frame — sprite swaps from `idle` to `selected` with no tween. |
| Camera | No camera shake, no easing. Camera position changes are also instant. |

### Iteration delta — what `static` does NOT add

- No `Phaser.Tweens` calls anywhere in the scene.
- No CSS transitions on game-art-driven UI elements (HUD CSS transitions for hover / press are still allowed via `interactionGrammar` for service-domain workspaces; in game-domain workspaces the HUD is part of `game-art` and a `static` motion pattern means even the HUD is hard-cut).
- No `requestAnimationFrame` interpolation for entity positions; the only RAF use is the engine's tick scheduler.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `slidingPuzzle` → `static` is the canonical match. Tile-snap-to-grid IS the genre's motion language. Easing the slide breaks the genre's reflective tone.
- `match3` → `static` is unusual. Match-3 cascades typically benefit from a `subtle` ease (the dropping tiles have inertia).
- `cardSolitaire` → `static` works for very minimal solitaire variants; the canonical `cardClassic` tone expects `subtle` (card flip + settle).
- `arcadePaddle` → `static` is unusual. Paddle / ball motion expects continuous physics; `static` is only reasonable for grid-bound paddle variants.
- `arcadeSnake` → `static` is the canonical match. Grid-tick body advance IS the genre's motion language.

### Code-time consequences

- The scene's `update(time, delta)` reads `delta` for tick timing only — no mid-tick interpolation.
- Positions are integers (or grid coordinates) at all times; sub-pixel rendering is forbidden (CSS `image-rendering: pixelated` if the project also uses `pixelRetro`).
- The motion budget is zero — no tween / particle / spring math runs per frame outside of the engine's housekeeping.

### Concept affinity (D32-revised v8 — guidance, not strict)

`static` pairs naturally with `pixelRetro` (era-faithful step animation) and `cardClassic` (calm table). It works for `flatMinimal` (stark, clean grids) but most flat-minimal projects benefit from `subtle`. `softPastel` and `neonArcade` are unusual fits — those concepts expect at least some motion to convey their tone.

### Blind-spot reminders

- ⚠️ A `static` project that emits `Phaser.Tweens.add(...)` calls in code is inconsistent — the validator should flag.
- ⚠️ `static` while the project uses `gameArtTier.particleProfile !== 'none'` is suspicious — particles imply motion. Either both axes go static or both step up to `subtle` / `light`.
- ⚠️ Player feedback on `static` projects depends on **frame-perfect input response**. If the tick rate is too slow (< 30 fps tick), `static` reads as laggy rather than discrete.
