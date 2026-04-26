## Game Content Tier (universal ledger)

**Activation gate**: `domain === 'game'` and the basis slot opts into `gameContentTier`. Active across plan / design / code jobs (D10 — content tier is shared). UI / spec / art jobs all consume it.

This preamble frames the two axes that make up `gameContentTier`:

- **`genre`** — the kind of game (puzzle / action / shooter / platformer / rpg / strategy / casual). The genre commits the project's **systems shape** (board, combat, growth, ...).
- **`coreLoop`** — the inner, shortest cycle the player repeats (collect / fight / build / explore / solve). The coreLoop commits the project's **moment-to-moment verbs**.

### What every genre / coreLoop partial commits to

The two axes are independent (a `puzzle + solve` and a `puzzle + fight` are both legal — sub-genres exist). Each partial answers a fixed-shape question set so consumers (plan / design / code) can layer signals predictably.

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
- `techTier` decides **which engine / language / framework** runs the build.

A genre or coreLoop partial MUST NOT specify palette / silhouette / engine / framework — those are other tiers' surfaces. Conversely, a `gameArtTier` partial MUST NOT enumerate genre-defining systems (board, ammo, party). The matrix gate keeps the surfaces orthogonal; the partials enforce it textually.

### Self-contained partial invariant (I4)

This file and every partial under `basis/gameContentTier/{genre,coreLoop}/` is `basis/**` — Handlebars `\{{> }}` includes are FORBIDDEN inside (I4 — Basis Partial Invariant). Each partial is a self-contained text body the PromptBuilder concatenates verbatim.

### SBS gate payload reminder

Each genre / coreLoop value is a **specific** gate. The partial MUST mention the genre's / loop's own name (`puzzle`, `solve`) and use the vocabulary that gate justifies (board / matching for puzzle; observe / hypothesize for solve). Genre-neutral text in a genre-gated partial defeats the SBS gate's information payload.
