## Genre: Puzzle

**Activation gate**: `gameContentTier.genre === 'puzzle'`.

### One-liner

Puzzle promises **stepwise reasoning with immediate feedback** — the player observes a constrained state, predicts a consequence, acts, and learns within seconds whether the prediction was right.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Board** | A bounded play space where state is fully observable. Grid (match-3, sokoban), tree (logic), or graph (network). The board's dimensions and adjacency rules are domain invariants. |
| **Matching / placement rule** | The deterministic rule that triggers the reward (3-in-a-row, line clear, valid path, satisfied constraint). MUST be checkable from the board state alone — no hidden inputs. |
| **Combo / chain rule** | Iteration delta: how a single move cascades into more rewards. Without a combo rule, every move is independent and the loop is a quiz, not a puzzle. |

The project's own **twist on each of these three** is the SBS payload — naming "match-3 board with cascading drops and color-shift power-ups" is a commitment; saying "like Bejeweled" is empty.

### Coreloop affinity

Natural: `solve` (observe → hypothesize → act → confirm).

Possible (sub-genres): `collect` (the puzzle gates a collectible). Rare: `fight`, `build`, `explore` — if chosen, the project is intentionally subverting the genre and MUST state why.

### HUD essentials

- **Score / progress indicator** — the puzzle's tangible feedback signal.
- **Move-count or move-budget** — the constraint that makes the reasoning hard.
- **Hint button** (optional) — the failure-recovery surface; explicit when present, absent when not.

A puzzle HUD without one of {score, move-count} is a feedback gap — the player observes an act but cannot verify a hypothesis.

### What NOT to commit at PRD level

- ❌ Exact match thresholds (3-in-a-row vs 4-in-a-row), exact board sizes, exact combo multipliers — those are balancing surface (design / spec).
- ❌ Particle / palette / silhouette decisions — that is `gameArtTier`.
- ❌ Hint algorithm — that is design / code surface (the PRD only commits whether hints exist).

### Blind-spot reminders

- ⚠️ A puzzle without explicit **fail condition** ("ran out of moves", "board locked") collapses into a doodling toy.
- ⚠️ A puzzle whose **board state is partially hidden** (random tile drops the player cannot see) breaks the "fully observable" promise — that is allowed but MUST be called out.
- ⚠️ The **combo rule** is the loop's iteration delta. A puzzle without combo rules has flat replay value.
