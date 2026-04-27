## Genre: Arcade Snake

**Activation gate**: `gameContentTier.genre === 'arcadeSnake'`.

### One-liner

Arcade-snake promises **route-the-line** — the player steers a continuously-moving line (the snake / cycle / lane-rider) across a grid, picks up food / pellet / collectible cells along the way, and dies on contact with their own body, an obstacle, or a wall. The session is a single ramping run; every food eaten extends the line and tightens the maze the player just made for themselves.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Grid + heading model** | The world is a bounded 2D grid (16×16 to 30×30 typical for arcade-snake; larger for Tron-class). The snake is an ordered list of grid cells (head + body); the head advances one cell per tick along its current heading. The project commits: grid dimensions, tick rate, wrap policy (wall-kills vs. toroidal), and starting body length. |
| **Movement / heading rules** | The deterministic rule for how player input changes heading: 4-directional taps (canonical Snake), turn-on-tap relative to current heading (Tron-style), or lane swaps (Frogger / Subway-class). The rule MUST forbid a 180° instant reversal (would self-collide on the next tick); commit the input lockout per tick. |
| **Death + growth conditions** | The single death rule (head enters body cell / obstacle cell / wall cell — the project commits which set). The single growth rule (eating food appends N cells to the tail; commit N=1 vs N=2 etc.). The food-spawn policy (random empty cell vs. pattern-driven) is the third leg. |

The project's twist — "Tron-class with persistent trails", "Snake with poison food that shrinks the body", "Frogger-style with multiple lanes and only side-to-side input" — is the SBS payload.

### Coreloop affinity

Natural: `survive` (the death-line ramp is canonical for snake-class — every food makes the body longer, which makes the maze tighter, which compresses the survival window). Strong fit: `collect` (each food is a collected unit, point ramp matters). The `GENRE_CORELOOP_MATRIX` exposes both. `solve` is unusual; only adopt with a planning meta-layer.

### HUD essentials

- **Score / length counter** — the persistence record; usually equals body length minus starting length.
- **Lives indicator** (optional — many snake variants are 1-life single-run).
- **Speed / tick-rate indicator** — for variants that ramp tick rate as score grows; visible so players see the difficulty curve.
- **Food locator hint** (optional, for larger grids) — a directional arrow on screen edge when the food is off-screen.

### Concept affinity (guidance, not a hard gate)

Naturally readable concepts: `neonArcade` (the canonical Tron-grid look — the 1st-class match), `pixelRetro` (NES / Game-Boy Snake), `flatMinimal` (modern phone-app Snake). `softPastel` and `cardClassic` are unusual.

### What NOT to commit at PRD level

- ❌ Exact tick-rate ramp curves, exact food spawn probabilities — balancing surface.
- ❌ Snake / food / wall palette and pixel design — `gameArtTier`.
- ❌ Particle bursts on food eat — `gameArtTier.particleProfile` (Phase 4).

### Blind-spot reminders

- ⚠️ **Head-tail collision on growth** is the corner case every implementation must handle: when the snake eats food and then immediately tries to enter the cell the tail just vacated, the order of "advance head → resolve eat → trim tail" matters. PRD MUST commit the resolution order so the gameplay feels consistent.
- ⚠️ **Input buffering** matters at high tick rates — if the player taps two directions inside one tick, only one should resolve. Commit the input-buffer depth (1 frame? 2 frames?).
- ⚠️ **Food spawn into an impossible cell** (the body now fills the entire grid) is the win condition for some snake variants and the soft-lock for others. PRD MUST commit which.
