## Genre: Sliding Puzzle

**Activation gate**: `gameContentTier.genre === 'slidingPuzzle'`.

### One-liner

Sliding-puzzle promises **plan-then-shift** — the player observes a board where pieces occupy cells and one or more cells are empty (or otherwise "movable"), then chooses a piece to slide into a legal target cell, and repeats until the board reaches the goal configuration. Every move is reversible in principle but constrained in practice; the design tension is the path between observed state and goal state.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Board (grid + occupancy state)** | A bounded grid where each cell holds at most one piece (or is "open"). The grid dimensions (3×3 / 4×4 / 5×5), the legal axes of motion (row / column / both / one-direction), and the wrap policy (toroidal? walls?) are domain invariants. Commit the grid shape and the open-cell count up front. |
| **Sliding rule (piece-to-empty / push-chain)** | The deterministic rule that decides what counts as a "legal slide". Variants: 15-puzzle-style (one piece into one empty cell), Sokoban-style (push a crate into an empty cell, cannot pull), color-slider-style (a whole row/column shifts as a unit). The rule MUST be checkable from board state alone — no chance, no hidden state. |
| **Goal configuration (target state + completion check)** | The specific board state that triggers "puzzle solved": numbered tiles in order (15-puzzle), all crates on switches (Sokoban), all rows or columns matching a target color sequence (color-slider). The check runs after every legal move. |

The project's twist — "5×5 grid with two empty cells and exit doors", "Sokoban-style with one-way arrows on certain tiles", "color rows where adjacent rows of the same color collapse" — is the SBS payload.

### Coreloop affinity

Natural: `solve` (the canonical deliberate-planning loop — observe state, hypothesize a sequence, slide, confirm). The `GENRE_CORELOOP_MATRIX` exposes only `solve` for `slidingPuzzle` because the genre's reflective tone collides with `collect` (no item drops) and `survive` (no time pressure that fits without contorting the genre).

### HUD essentials

- **Move count** — the meditative tally of moves so far; the PRD commits whether par moves are scored or just displayed.
- **Goal preview** — a thumbnail or overlay showing the target configuration (especially for color-slider / image-tile variants).
- **Undo / reset controls** — the genre's recovery surface. PRD MUST commit whether undo is unlimited, cost-bound, or absent.
- **Hint button** (optional) — for puzzle-pack variants; commit explicitly when present.

### Concept affinity (guidance, not a hard gate)

Naturally readable concepts: `pixelRetro` (NES-era Sokoban tile aesthetic), `flatMinimal` (modern numbered-tile or Material crate). `softPastel` works for a "calm puzzle book" tone. `neonArcade` is unusual; `cardClassic` mismatches the genre.

### What NOT to commit at PRD level

- ❌ Specific level layouts — those live as data files (`inputs/sources/levels.json` or similar), not in the PRD.
- ❌ Exact undo cost numbers, hint cost numbers — balancing surface.
- ❌ Tile sprite shapes / colors — `gameArtTier`.

### Blind-spot reminders

- ⚠️ A sliding puzzle without a clear **goal-detection rule** is a sandbox — the player has no terminal feedback. Even an endless mode needs a tracked "target reached".
- ⚠️ **Unsolvable starting configurations** are a hard-failure mode. Most slide-puzzle generators have parity / reachability constraints; commit which generator (random vs. solver-validated) the project uses.
- ⚠️ A **one-hand single-axis input** (drag-only) needs feedback on tap-tap and on diagonal swipes; ambiguous gestures kill the genre's calm.
