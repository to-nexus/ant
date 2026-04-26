## Plan-Overlay — Game Content Tier Hook

**Activation gate**: job `plan` × `domain === 'game'` × `gameContentTier` is decided (`genre` and / or `coreLoop` slot is populated). Layered on top of `templates/jobs/plan/domain/game.md` (GDD skeleton, D27). The matrix gate excludes `service` automatically — this file is dead for service projects.

This overlay sharpens **two GDD sections** when their tier values are pre-decided or selected during planning:

| Tier value | Applies to GDD section | What the overlay sharpens |
|---|---|---|
| `genre` (`match3` / `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake` — D31-revised v8) | §2 Genre & Coreloop | Genre-defining systems the PRD MUST commit |
| `coreLoop` (`solve` / `collect` / `survive` — matrix-gated per genre, D31-revised v8) | §2 Genre & Coreloop, §4 MDA | Loop-defining steps the PRD MUST commit |

### Genre commitment principle (when `genre` is decided)

When the genre is decided in this turn or pre-set on the basis, the PRD MUST commit to **at least three genre-defining systems** so the design job has a non-empty seed. The overlay does NOT name those systems for the PM — the PM observes them from the genre baseline and cites them by category.

| Genre | Categories the PRD MUST cover (the project's specific instance, not the baseline) |
|---|---|
| `match3` | board (grid + tile pool) / matching rule (≥3 same-kind line + L/T/5 extensions) / cascade rule (gravity + refill + chain) |
| `slidingPuzzle` | board (n×n grid + 1 empty cell) / sliding rule (4-neighbour swap into empty) / completion condition (target arrangement, e.g. 1..n²−1 ordered) |
| `cardSolitaire` | card model (suit + rank universe) / tableau structure (stacks + foundations + waste / freecell) / legal-move predicate (rank±1 + suit/colour discipline) |
| `arcadePaddle` | paddle physics (bounce + spin influence) / threat ramp (ball speed / brick layout / death-line) / score and life budget |
| `arcadeSnake` | grid + snake-body chain / collision rule (self-collision + wall) / growth and speed ramp on pickup |

The PRD must cite the project's **own twist** on each category — what makes THIS game different from the genre baseline. A PRD that only restates the baseline is empty (SBS violation: the genre gate's information payload is zero).

### Coreloop commitment principle (when `coreLoop` is decided)

When `coreLoop` is decided, the PRD MUST describe the loop as a **3- or 4-step cycle** with what changes between iterations. A loop without iteration-delta is a tutorial, not a loop.

| coreLoop | Skeleton (each step is a player verb the PRD owns) | What MUST change between iterations |
|---|---|---|
| `solve` | observe → hypothesize → act → confirm | Puzzle structure / constraint count / lookahead depth |
| `collect` | spot → reach → pick up → store | Density / variety / payoff cadence near the pickup |
| `survive` | sense threat → respond → maintain rhythm → endure | Threat tempo / death-line ramp / lifeline budget |

These skeletons are **starting points**, not contracts — the PRD is allowed to rename steps, merge two, or split one, as long as the rewritten loop still answers "what does the player do, in what order, and what changes next time".

### Matrix gate (D31-revised v8 — I9)

The two axes are NOT independent. `GENRE_CORELOOP_MATRIX` (in `@ant/shared`) names which coreLoops are reachable for each genre — the decompose pipeline filters out-of-matrix pairs at parse time:

| Genre | Legal coreLoop set |
|---|---|
| `match3` | `solve`, `collect` |
| `slidingPuzzle` | `solve` |
| `cardSolitaire` | `solve`, `collect` |
| `arcadePaddle` | `survive`, `collect` |
| `arcadeSnake` | `survive`, `collect` |

The PRD MUST commit a `(genre, coreLoop)` pair already in the matrix. Pairs outside it (`arcadePaddle + solve`, `cardSolitaire + survive`, ...) are filtered before the design / code job sees them — surfacing one in the GDD costs a retry round and never reaches downstream.

### Reminders (FPOP-style blind spots)

- ⚠️ Do NOT lift the genre's **mechanics** from a famous game — name the project's own verbs. "Like Bejeweled" is not a commitment; "swap two adjacent tiles → match-3 → cascade → refill" is.
- ⚠️ A coreLoop step must be a **verb the player issues**, not a system reaction. "Damage is dealt" is a system reaction; "player times the dodge" is the verb.
- ⚠️ When `genre` and `coreLoop` are both decided, they MUST come from `GENRE_CORELOOP_MATRIX` (D31-revised v8). The decompose pipeline filters out-of-matrix pairs at parse time — surfacing one in the PRD costs a retry round.
- ⚠️ The `match3` / `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake` registry is css-only-tuned. Production-asset-dependent genres (action, platformer, shooter, rpg, strategy) are deferred to Phase 5+ when the visual job activates (legacy super-categories archived).
- ⚠️ Multi-loop games (a meta-loop wrapping a moment-loop, e.g. roguelite) state both loops separately — coreLoop in this overlay is the **inner / shortest** loop. Outer loop, if any, is captured in §11 Meta-Progression of the GDD.

### Out of scope for this overlay

- Asset / art commitments (sprite count, palette, audio profile) — those are `gameArtTier`, not `gameContentTier`, and they belong to design / game-art jobs
- System-level mechanics rules (collision, determinism, tick policy) — those are design job's surface
- Engine or framework choice — that is `techTier`, decided later
