## Core Loop: Solve

**Activation gate**: `gameContentTier.coreLoop === 'solve'`.

### Loop steps (4)

1. **Observe** — the player reads a fully-visible state (board, riddle, configuration). Information that is not on-screen breaks the loop.
2. **Hypothesize** — the player forms a prediction about the consequence of an action (will this match clear, will this path lead through, will this constraint resolve).
3. **Act** — the player commits one input (tap, drag, place, select). The action is bounded — a single move, not a sequence.
4. **Confirm** — the system reveals the consequence within sub-second feedback. Right or wrong is unambiguous.

The loop completes in **seconds** — `solve` cycles are short. Long deliberation is the player's choice; the system does not gate on it.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Constraint count** | More constraints to satisfy at once (board fills, more rules apply). |
| **Lookahead depth** | The number of future moves the player must consider before committing. |
| **Puzzle structure** | The shape of the board / problem changes (new tile types, new rules, new connectivity). |

A `solve` loop without iteration delta is a quiz set, not a loop — every problem feels independent and replay value is flat.

### Reward cadence

- Reward fires at **Confirm**, immediate.
- Combo / chain bonuses fire at **Confirm + N** when cascade rules let one act trigger multiple state changes.
- A meta-reward (puzzle complete) fires at the cycle that empties the board / satisfies the goal.

### Failure semantics

- Failure = "wrong hypothesis", surfaced at Confirm. Cost is one move (or one move-budget tick).
- Hard failure = "ran out of moves" / "board locked". Cost is the puzzle session — restart.
- Recovery cost is **explicit**: undo (low cost), restart-puzzle (medium), restart-progress (high). The PRD MUST commit which costs apply.

### Affinity

Strong fit: `puzzle`. Possible: `casual` for one-shot puzzles, `rpg` for puzzle-RPG sub-genres.

### Blind-spot reminders

- ⚠️ A `solve` loop with **hidden information** (random tile drops the player cannot see) violates the "fully observable" promise. Explicit randomness is allowed; hidden state is a category error.
- ⚠️ **Confirmation latency** above ~500ms breaks the loop's tightness. If the system needs computation, animate or stage the reveal.
- ⚠️ Skipping **Hypothesize** turns the loop into trial-and-error. The PRD's design tension lies in making hypothesis cheap and informative.
