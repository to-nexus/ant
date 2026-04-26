## Core Loop: Survive

**Activation gate**: `gameContentTier.coreLoop === 'survive'`.

### Loop steps (3)

1. **Read incoming threat** — the player observes a hazard moving toward them or a worsening state (rising stack, oncoming brick wave, encroaching wall, dwindling timer).
2. **React** — the player commits one or several inputs to evade, deflect, or absorb the threat. Reaction window is sub-second; deliberation is the death zone.
3. **Persist** — the system tightens the screw on the next cycle (faster spawn, tighter spawns, narrower margin). Survival score = cycles persisted.

A `survive` cycle resolves in **fractions of a second**. The pace, not the depth, is the loop's defining property — every cycle cuts the response window thinner than the last.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Speed ramp** | Every successful cycle increases the threat's velocity (paddle ball goes faster, snake's body grows, brick wave drops faster). |
| **Spawn density** | More obstacles co-occur (multi-ball, simultaneous food + obstacle, multiple oncoming projectiles). |
| **Reaction-window squeeze** | The player's tolerance margin shrinks (paddle hit zone narrows, snake's safe lane disappears, hit window tightens). |

A `survive` loop without iteration delta becomes static — the player either masters the steady state in one minute or stays bored. The squeeze is the engagement curve.

### Reward cadence

- Reward fires per **cycle persisted** (score tick = 1 unit per second alive, or per obstacle cleared, or per food collected).
- Soft milestones at fixed intervals (every 100 points, every 60 seconds) carry mild celebration (palette shift, bgm key change, particle burst).
- The terminal reward is the **personal-best replacement** — a number the player wants to beat next run.

### Failure semantics

- Failure = "hit the threat" (paddle missed ball, snake hit body / wall, snake-shaped projectile crossed the lane). Resolution is **immediate run-end**.
- Recovery cost is **one full session** — the run restarts from zero. Persistent state (high-score, unlocked palette) survives the run boundary.
- Mid-run forgiveness mechanics (extra life, heart, shield) are valid but commit a count: "3 lives" is a number the PRD MUST decide.

### Affinity

Strong fit: `arcadePaddle`, `arcadeSnake` (the survive loop is their canonical pattern). Possible: `match3` if the board fills with a death-line (rare — typical match-3 uses `solve` or `collect`). Rare: `slidingPuzzle`, `cardSolitaire` — survival pressure mismatches their reflective tone.

### Blind-spot reminders

- ⚠️ A `survive` loop that does NOT ramp difficulty is a quiz set. The player either solves the steady state immediately or never engages.
- ⚠️ **Reaction windows below ~150ms** are unfair — players cannot react that fast. The squeeze must asymptote, not collapse to zero.
- ⚠️ A `survive` loop without a **persistent score signal** (no high-score record, no run summary) leaves no carrot — the player has nothing to beat next run.
