## Code-Overlay: Game Content Tier (genre / coreLoop application)

**Activation gate**: job `code` × `gameContentTier` opted into the basis slot. Layered on top of `basis/gameContentTier/_preamble.md` (universal genre / coreLoop ledger).

This preamble defines how a code intent **applies** the genre / coreLoop decision at runtime. The universal ledger commits the genre's identity and loop steps; this file commits the code-side discipline for materializing them.

### 1. Genre → boundary mapping (D31-revised v8 — 5 sub-genres)

`gameContentTier.genre` decides which Domain shapes are likely. The genre partial supplies the canonical entity model; this file commits the boundary each genre's rule reducer lives behind:

| Genre | Domain rule reducer (engine-agnostic) | Render visual idiom | HUD readouts |
|---|---|---|---|
| `match3` | board (grid + tile pool) reducer with match-rule + cascade-rule | tile cells with palette / silhouette per `gameArtTier.concept` | score, move-count remaining, objective tracker, combo / cascade indicator |
| `slidingPuzzle` | n×n grid + empty-cell reducer with sliding-rule + completion-check | numbered or imaged cells with sliding tween | move count, optional timer, target-arrangement preview |
| `cardSolitaire` | card model + tableau reducer with legal-move predicate (rank±1 + suit/colour) | card faces with suit pictograms, tableau / foundation / waste columns | score (variant-specific), move count, undo button, stockpile state |
| `arcadePaddle` | paddle / ball physics reducer with collision + speed-ramp | paddle + ball + brick layout, particle on impact | score, lives remaining, wave / brick-count indicator |
| `arcadeSnake` | grid + snake-segment-chain reducer with collision + growth | grid cells with snake body + pickups | score, snake length, current speed tier |

- **Domain** owns the rule reducer. The reducer is engine-agnostic and tested in isolation. A `match3` reducer never imports Phaser; a `cardSolitaire` reducer never imports React.
- **Render** owns the visual idiom. Render reads Domain snapshots; never the inverse.
- **HUD** owns the player-facing readouts (the rightmost column above; details in each genre partial's "HUD essentials" section). Code wires them as `UIScene` (or equivalent) overlays.

### 2. CoreLoop → loop owner contract (D31-revised v8 — 3 universal coreLoops)

`gameContentTier.coreLoop` decides what cycle the loop owner orchestrates. The loop owner is the engine boundary (techTier × gameEngine), but the **shape** of one cycle comes from the coreLoop partial:

| coreLoop | One cycle (typical) | Loop-owner responsibility |
|---|---|---|
| `solve` | observe → hypothesize → act → confirm | Surface the rule state each tick; emit a "cycle complete" event when the rule reducer accepts a confirmation |
| `collect` | spot → reach → pick up → store | Render world entities; emit pickup events; inventory / score deltas committed at cycle end |
| `survive` | sense threat → respond → maintain rhythm → endure | Tick threat state at fixed-timestep; emit hit / miss / death-line events; lifeline budget decrements on failure |

Code intent emits these as **named events** on the loop owner — never as ad-hoc `setTimeout` chains.

### 3. Genre × coreLoop matrix (D31-revised v8 — I9)

The two axes are NOT independent. `GENRE_CORELOOP_MATRIX` (in `@ant/shared`) names which coreLoops are legal for each genre — the decompose pipeline filters out-of-matrix pairs at parse time, so code job consumers always see a legal pair:

| Genre | Legal coreLoop set | Reading |
|---|---|---|
| `match3` | `solve`, `collect` | predict-then-swap (`solve`) or chain-payoff (`collect`) |
| `slidingPuzzle` | `solve` | reflective-only |
| `cardSolitaire` | `solve`, `collect` | reflective placement (`solve`) or foundation-promotion payoff (`collect`) |
| `arcadePaddle` | `survive`, `collect` | death-line ramp (`survive`) or brick / coin pickup (`collect`) |
| `arcadeSnake` | `survive`, `collect` | self-collision avoidance (`survive`) or pickup chain (`collect`) |

If the code job ever sees an out-of-matrix pair (LLM emit + parser bug), it MUST surface the conflict as an open question rather than silently picking one. Out-of-matrix pairs (`arcadePaddle + solve`, `cardSolitaire + survive`, ...) are filtered upstream — never silently coerce.

### 4. HUD essentials (from genre partial)

Each genre partial lists "HUD essentials" — the player-facing readouts the genre demands. The code job wires them as `UIScene` (or equivalent) overlays that read Domain snapshots:

- `match3` — score, move-count remaining, objective tracker, combo / cascade indicator
- `slidingPuzzle` — move count, optional timer, target-arrangement preview tile
- `cardSolitaire` — score (variant-specific), move count, undo button, stockpile state indicator
- `arcadePaddle` — score, lives remaining, current wave / brick count
- `arcadeSnake` — score, snake length, current speed tier

Constraints:

- ❌ HUD MUST NOT mutate Domain — readouts only.
- ❌ HUD MUST NOT introduce new state that the genre's rule reducer does not already produce. If the genre needs "combo counter", Domain emits combo events; HUD displays them.

### 5. Forbidden code-time shortcuts

- ❌ Inferring genre / coreLoop from the directive at code-emission time without the LLM's emitted decision tag — the basis decision is the SSOT.
- ❌ Hardcoding genre-specific magic numbers (`MAX_COMBO = 5`, `BOARD_SIZE = 8`) without a sibling spec entry — magic numbers belong to `outputs/design/spec/...`.
- ❌ Mixing two genres' HUD idioms in one `UIScene` (a paddle / ball overlay in a `cardSolitaire` runtime) — the genre boundary is also a HUD boundary.
- ❌ Coercing an out-of-matrix `(genre, coreLoop)` pair in code — the matrix gate is enforced at decompose / parse, code MUST trust the upstream filter.
