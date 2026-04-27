## Genre: Match-3

**Activation gate**: `gameContentTier.genre === 'match3'`.

### One-liner

Match-3 promises **swap → match → cascade** — the player commits a single board mutation, three (or more) like-typed tiles align, those tiles vanish, the board collapses, and a chain of secondary matches may fire automatically. The whole sequence completes in under two seconds and rewards both the move and the cascade.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Board (grid + tile pool)** | A bounded 2D grid (commonly 6×6 to 9×9) where each cell holds a tile of one of N color/shape kinds. The grid coordinate system, tile kind enum, and adjacency rule (4-neighbor classic, or 6-neighbor hex) are domain invariants. The project commits the grid dimensions and the tile kind count up front. |
| **Match rule (3-in-a-row + extensions)** | The deterministic rule that triggers a clear: any straight line of ≥3 same-kind tiles. Extensions decide whether L / T / 5-in-a-row produce special tiles (line-clear, bomb, color-burst). The match rule MUST be checkable from the board state alone — no hidden inputs. |
| **Cascade rule (gravity + refill)** | When a match clears, tiles above fall to fill empty cells, new tiles spawn at the top, and the system re-checks for newly-formed matches. The cascade is the loop's iteration delta — without it, every move is independent and the game is a quiz of one-shot patterns. |

The project's twist on each of these — "9×9 hex grid with 6 colors, T-shape spawns a row-clear bomb, gravity falls toward the center on a circular board" — is the SBS payload. Naming "like Bejeweled" is empty; committing the grid shape, kind count, and special-tile rules is a commitment.

### Coreloop affinity

Natural: `solve` (predict-then-swap, observe-cascade-effect). Strong fit: `collect` (every cleared chain produces score / objectives / coin). The `GENRE_CORELOOP_MATRIX` exposes both candidates to the LLM. Survive cycles are unusual for match-3; commit a death-line system (rising threat that clears only via play) before adopting `survive`.

### HUD essentials

- **Score** — the cascade's tangible reward. Per-cycle delta visible.
- **Move-count budget** — the tightest constraint that turns observation into prediction. (Fixed-budget puzzle mode; relaxed in endless variants.)
- **Objective tracker** — when the level is "collect 30 blue tiles" or "drop the cherry to the bottom row", the HUD must surface progress on each move.
- **Combo/cascade indicator** — a brief "x2 / x3" multiplier badge that surges on each cascade tick. This is the player's feedback that the cascade rule is firing.

### Concept affinity (guidance, not a hard gate)

Naturally readable concepts: `flatMinimal` (clean Material/iOS gem look), `softPastel` (Two Dots / Threes-style cushion grid), `pixelRetro` (8-bit gem set with limited palette). `neonArcade` works for an "energy crystal" theme; `cardClassic` is unusual — only adopt with an explicit visual rationale (e.g. "playing cards as match tiles").

### What NOT to commit at PRD level

- ❌ Exact match thresholds (3-in-a-row vs 4-in-a-row), exact board sizes, exact combo multipliers, special-tile thresholds — those are balancing surface (design / spec).
- ❌ Particle / palette / silhouette decisions — that is `gameArtTier`.
- ❌ Animation timings / tween curves — that is `gameArtTier.motionPattern` (Phase 4).

### Blind-spot reminders

- ⚠️ A match-3 board without a **death / completion condition** (no move-count cap, no objective, no rising-line) is a sandbox toy — players cycle moves indefinitely with no tension.
- ⚠️ Cascades that **chain too long** (>5 cascades from one swap) feel out of the player's control. Commit a cascade cap or a falling-speed ramp.
- ⚠️ The **shuffle policy** when no legal move remains is a UX trap. Auto-shuffle silently? Deduct a move? End the level? PRD MUST commit.
