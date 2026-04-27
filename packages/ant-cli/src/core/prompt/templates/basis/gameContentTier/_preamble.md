## Game Content Tier (universal ledger)

**Activation gate**: `domain === 'game'` and the basis slot opts into `gameContentTier`. Active across plan / design / code jobs (D10 — content tier is shared). UI / spec / art jobs all consume it.

This preamble frames the two axes that make up `gameContentTier`:

- **`genre`** — the kind of game. v9 (D31-revised) registers 6 sub-genres tuned for css-only inline production: `match3`, `slidingPuzzle`, `cardSolitaire`, `arcadePaddle`, `arcadeSnake`, `crowdRunner`. The genre commits the project's **systems-shape categories** (board / sliding-rule / suit / paddle-physics / snake-grid / crowd+steering); the axes inside each category remain PRD's surface.
- **`coreLoop`** — the inner, shortest cycle the player repeats. v9 (D31-revised) registers 3 universal loops: `solve` (reflective / hypothesise-then-confirm), `collect` (chains, suits, points, gate pickups), `survive` (paddle / snake / crowd death-line ramp). The coreLoop commits the project's **moment-to-moment verbs**.

### Matrix gate (D31-revised v9 — I9)

The two axes are NOT independent. `GENRE_CORELOOP_MATRIX` (in `@ant/shared`) names which coreLoops are reachable for each genre:

| Genre | CoreLoop candidate set |
|---|---|
| `match3` | `solve`, `collect` |
| `slidingPuzzle` | `solve` |
| `cardSolitaire` | `solve`, `collect` |
| `arcadePaddle` | `survive`, `collect` |
| `arcadeSnake` | `survive`, `collect` |
| `crowdRunner` | `survive`, `collect` |

The decompose pipeline narrows `gameCoreLoopCandidates` once the genre is decided. A LLM-emitted `(genre, coreLoop)` pair outside this matrix is filtered at parse time — the LLM never sees the mismatched pairing in its candidate enumeration. `solve` for `arcadePaddle` / `arcadeSnake` / `crowdRunner`, or `survive` for `cardSolitaire` / `slidingPuzzle`, is intentionally excluded as a category mismatch.

### What every genre / coreLoop partial commits to

The two axes are matrix-related (D31-revised v9 — `GENRE_CORELOOP_MATRIX`). A pair like `match3 + solve` and `match3 + collect` are both legal; `match3 + survive` is filtered out at parse time. Each partial answers a fixed-shape question set so consumers (plan / design / code) can layer signals predictably regardless of which legal pair the LLM emits.

**Genre partial (per `genre`)**:

1. **One-liner** — what this genre promises the player.
2. **Defining systems** — three system categories the project MUST cover; the project's own twist on each is the SBS payload.
3. **Coreloop affinity** — which `coreLoop` values are natural for this genre (and which are unusual).
4. **HUD essentials** — the player-facing readouts the genre demands (consumed by ui-design and code intents for HUD wiring).
5. **What NOT to commit at PRD level** — concerns that belong to design / code, not plan.

**CoreLoop partial (per `coreLoop`)**:

1. **Loop steps** — 3- or 4-step skeleton, each step is a player verb.
2. **Iteration delta** — what changes between cycles (the loop is not a loop without iteration delta).
3. **Reward cadence hint** — which step emits feedback / reward.
4. **Failure semantics** — what counts as failure in this loop; recovery cost.

### Boundary with other tiers

- `gameContentTier` decides **what kind of game** and **what the player does each cycle**.
- `gameArtTier` decides **how the game looks and sounds** (concept / perspective / 5 art axes — Phase 4).
- `techTier` decides **which engine / language / framework** runs the runtime.

A genre or coreLoop partial MUST NOT specify palette / silhouette / engine / framework — those are other tiers' surfaces. Conversely, a `gameArtTier` partial MUST NOT enumerate genre-defining systems (board, ammo, party). The matrix gate keeps the surfaces orthogonal; the partials enforce it textually.

### Self-contained partial invariant (I4)

This file and every partial under `basis/gameContentTier/{genre,coreLoop}/` is `basis/**` — Handlebars `\{{> }}` includes are FORBIDDEN inside (I4 — Basis Partial Invariant). Each partial is a self-contained text body the PromptBuilder concatenates verbatim.

### SBS gate payload reminder

Each genre / coreLoop value is a **specific** gate. The partial MUST mention the genre's / loop's own name (`match3`, `solve`) and use the vocabulary that gate justifies (board / matching / cascade for match3; observe / hypothesize for solve). Genre-neutral text in a genre-gated partial defeats the SBS gate's information payload.
