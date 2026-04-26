## Motion Pattern: Subtle

**Activation gate**: `gameArtTier.motionPattern === 'subtle'`.

### Promise

The `subtle` motion pattern commits to **ease-in-out tweens with short durations** — entities transition smoothly between positions, but the motion is brief (150–400ms) and does not advertise itself. Sprites may carry a tiny idle motion (slow opacity pulse, 1–2% scale wobble) but never a bouncy, expressive cue. The world feels alive without ever stealing focus from the player's verb.

### What "subtle" looks like in code

| Surface | Realization |
|---|---|
| Sprite movement | `Phaser.Tweens.add({ targets, x, y, duration: 200, ease: 'Cubic.easeOut' })` — short ease-out for "in to position" feel. |
| Cascade / drop | Match-3 tile drop uses `Phaser.Tweens.add({ y: targetY, duration: 250, ease: 'Sine.easeIn' })` so falling tiles settle naturally. |
| Idle animation | Slow scale oscillation (`scale: 1 ↔ 1.02` over 2 seconds) on the focal element only. Most entities stay still. |
| State change | 150ms color / opacity fade between states — the swap is visible but not jarring. |
| Camera | Tiny camera lerp on focus changes; never a screen shake (that's `expressive`). |

### Iteration delta — what `subtle` adds vs `static`

- Phaser `Tweens` are used for position / scale / opacity transitions; durations stay under 400ms.
- One CSS transition slot per state for HUD elements (e.g. `transition: transform 200ms ease-out`); never multiple chained transitions.
- The motion budget runs about 5–10ms per frame on modest devices — well within the 16ms budget.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

- `match3` → `subtle` is the canonical match. The cascade-drop ease is the genre's signature motion — tiles should fall with inertia, not snap. Match-3 without `subtle` motion feels mechanical.
- `cardSolitaire` → `subtle` is the canonical match. Card-flip + card-settle expect ease curves; the table is a calm surface that rewards smoothness.
- `slidingPuzzle` → `subtle` is unusual but legal — sliding-puzzles with `subtle` ease (instead of `static` snap) feel modern / app-store-ish (e.g. iOS slide-puzzle apps).
- `arcadePaddle` → `subtle` works for the brick-break tween (brick fades out over 200ms instead of disappearing instantly). Ball motion stays continuous (physics, not tween).
- `arcadeSnake` → `subtle` is unusual; the grid-tick advance breaks if you try to ease between body cells. Reserve `subtle` for non-positional cues (food pulse, score-flash).

### Code-time consequences

- `update(time, delta)` continues to advance tick state; `Phaser.Tweens.TweenManager` runs in parallel for visual transitions.
- Animation manifest entries (when used with `entityCatalog === 'standard'` or higher) define short cycles (≤ 8 frames) — not full walk cycles.
- HUD CSS uses 150–250ms transitions on hover / press; longer durations belong to `expressive`.

### Concept affinity (D32-revised v8 — guidance, not strict)

`subtle` is the most domain-agnostic motion pattern. It pairs naturally with `flatMinimal` (modern app feel), `cardClassic` (table calmness), and `softPastel` (cozy pace). It works for `pixelRetro` only when the project explicitly mixes pixel art with smooth tweens (a stylistic choice — declare in PRD). `neonArcade` benefits more from `expressive`.

### Blind-spot reminders

- ⚠️ A `subtle` project that pushes tween durations over 400ms is creeping into `expressive` — the LLM may need a reminder to keep durations short.
- ⚠️ Stacking 3+ simultaneous tweens on a single entity reads as `expressive`, not `subtle`. One axis at a time per state change.
- ⚠️ `subtle` while `motionPattern.idleEnabled === false` is fine, but the project should not list per-entity idle cycles in `game-art-spec.json` — those are dead code.
