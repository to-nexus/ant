## Genre: Arcade Paddle

**Activation gate**: `gameContentTier.genre === 'arcadePaddle'`.

### One-liner

Arcade-paddle promises **deflect-and-aim** — the player controls a paddle on one axis, a ball (or several) bounces off the paddle and the world's walls, and the player's only verb is to position the paddle to keep the ball alive (Pong) or to keep the ball alive *and* aim its rebound at score-bearing targets (Breakout). The session is a survival run with score as the persistence record.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Paddle + ball physics** | The paddle moves on a constrained axis (horizontal / vertical / radial). The ball has a 2D velocity, bounces off the paddle and walls, and reflects with a deterministic angle modifier (Breakout-class: paddle position at impact alters reflection angle; Pong-class: pure mirror reflection). The project commits: paddle dimensions, ball start velocity, reflection algorithm, and the world's wall boundaries. |
| **Brick / target field (optional but defining for the sub-variant)** | When present (Breakout / Arkanoid), the brick field is a 2D grid of consumable cells. Each brick has hit-points (1-shot, 2-shot, indestructible) and an optional power-up payload that drops on destruction. The field's clear is the level-completion condition. Pong-class variants skip this system and run on score-cap or session-time instead. |
| **Death-line (ball-loss condition)** | The single rule that ends a life: the ball crosses the boundary the paddle protects. The project commits the lives count (1 / 3 / 5), the ball-respawn behavior (auto / launch-from-paddle), and the loss penalty (life-only / score-reset). |

The project's twist — "rotational paddle around a center", "two paddles for cooperative play", "bricks with chain-explosion on destruction", "ball that grows with each rebound" — is the SBS payload.

### Coreloop affinity

Natural: `survive` (the ball-alive cycle is the canonical survive pattern). Strong fit: `collect` when bricks drop power-ups or the score itself is treated as the collected unit. The `GENRE_CORELOOP_MATRIX` exposes both. `solve` is unusual; only adopt if the project introduces a planning meta-layer (e.g. choose paddle layout before run).

### HUD essentials

- **Score** — the persistence record; visible during play and emphasized at run-end.
- **Lives indicator** — heart icons / dot row / numeric counter; updates on death.
- **Brick count remaining** (Breakout-class only) — surfaces level progress; transition to next level fires when count hits zero.
- **Power-up active state** — when a power-up modifies paddle behavior (wider / narrower / sticky / multi-ball), the HUD flags it with a duration bar or icon.

### Concept affinity (D32-revised v8 — guidance, not a hard gate)

Naturally readable concepts: `neonArcade` (the canonical Tron / synthwave palette for paddle-and-ball — the 1st-class match), `pixelRetro` (Atari 2600 Breakout aesthetic), `flatMinimal` (modern minimalist Breakout). `softPastel` and `cardClassic` are unusual fits.

### What NOT to commit at PRD level

- ❌ Exact reflection-angle formulas, exact ball-speed ramps, exact brick HP counts — balancing surface (design / spec).
- ❌ Brick / paddle / ball palette and silhouette — `gameArtTier`.
- ❌ Particle bursts on brick destruction — `gameArtTier.particleProfile` (Phase 4).

### Blind-spot reminders

- ⚠️ **Ball-trapped angles** (vertical or horizontal mirror loops where the ball never comes back to the paddle line) are a long-standing arcade-paddle bug. The PRD MUST commit an angle-perturbation rule on every paddle hit so the ball cannot lock into a trivial trajectory.
- ⚠️ **Power-up density** without a rarity rule turns Breakout into a power-up parade and dulls the survive tension. PRD commits the drop probability or makes "always drops" the explicit choice.
- ⚠️ **Touch-input precision** — paddle movement on a touch device must clamp to the world bounds AND avoid finger-over-paddle occlusion. Commit the input mapping (drag-anywhere vs drag-on-paddle).
