## Design-Overlay — Game Content Tier (genre / coreLoop applied to system design)

**Activation gate**: job `design` × `domain === 'game'` × `gameContentTier` slot is decided (`genre` and / or `coreLoop` populated). Layered on top of `templates/jobs/design/domain/game.md` (the universal game-domain design overlay) and the universal `basis/gameContentTier/_preamble.md`. The matrix gate excludes `service` automatically — this file is dead for service projects.

This overlay sharpens **how genre + coreLoop reach into system design** — Domain rule-reducer shape, simulation cycle granularity, and event boundaries. The plan job already committed *what kind of game it is* and *what the player does each cycle* (PRD); the design job MUST translate those commitments into the layered system contract before the code job materialises them.

### 1. Genre → Domain rule reducer shape

The genre registry (`match3` / `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake` / `crowdRunner`) names which Domain shapes are likely. The design job MUST commit the rule reducer's **state model**, **authoritative inputs**, and **event emission** before the code job materialises it. Domain event names are **abstract verbs** at this layer; concrete sub-events (e.g. which modifier op fired in `crowdRunner`) are rolled up into the abstract verb so the reducer admits any twist on the genre's axes without renaming events:

| Genre | Rule reducer state model | Authoritative inputs | Domain events emitted (abstract verbs) |
|---|---|---|---|
| `match3` | board grid + tile-kind enum + active-cascade flag + move budget | swap commands; cascade tick | `MatchCleared` / `CascadeChained` / `BoardRefilled` / `MoveBudgetExhausted` / `Won` |
| `slidingPuzzle` | n×n cell array + empty-cell index + move count | sliding commands (4-neighbour into empty) | `TileSlid` / `ArrangementMatched` / `MoveCounted` / `Won` |
| `cardSolitaire` | tableau columns + foundations + waste / freecell + move count | card-pickup + place commands; stockpile draw | `CardMoved` / `FoundationPromoted` / `Won` / `LegalMovesExhausted` |
| `arcadePaddle` | ball (position + velocity) + paddle position + brick layout + lives + speed tier | paddle-move command + tick `dt` | `BallReflected` / `BrickHit` / `LifeLost` / `WaveCleared` / `SpeedRamped` / `Lost` |
| `arcadeSnake` | grid + snake-segment chain + pickup positions + speed tier | direction commands + tick `dt` | `SnakeMoved` / `PickupCollected` / `SnakeGrew` / `SelfCollided` / `Lost` |
| `crowdRunner` | crowd resource (count + attribute pool) + formation snapshot + course progress + active modifiers + threat-field state + terminal predicate | steering command (axis-agnostic) + tick `dt` | `CrowdMutated` (any op on the crowd resource — `+N`/`×N`/`÷N`/`+Damage`/…) / `CrowdEngaged` (any auto-fire / contact event) / `CrowdAttrited` (any threat-induced loss) / `ThresholdCrossed` (any cliff / cap / soft-cap warning) / `Won` / `Lost` |

Reducer constraints (FPOP):

- Domain event names MUST be **rule-focused** (`MatchCleared`, not `ScoreIncreased`). Score is a meta-rule the Application layer derives from rule events.
- Event names MUST be **abstract over the genre's polymorphism axes**. `CrowdMutated` rolls up every modifier op variant (`+N` / `×N` / `÷N` / `+Damage` / `+Shield` / `split` / `merge`); the specific op fired travels as an event payload field, not as a new event type. This keeps the reducer's event surface stable across PRD twists on the op universe.
- The state model MUST exclude rendering / input-device specifics. `ballPositionPx` is a rendering concern; `ballPosition` (in domain units) belongs to Domain. Steering commands MUST be expressed in domain units (`{ axis: <axisId>, value: number }`) so the reducer admits any steering axis (X-only / X+Y / radial / lane-swap) without code branching.
- The reducer MUST be testable as `(state, command, dt) → newState + events[]` without instantiating any engine / rendering / HUD layer.

### 2. CoreLoop → simulation cycle granularity

The coreLoop registry (`solve` / `collect` / `survive`) names the inner cycle the design MUST schedule. Combined with `gameArtTier.motionPattern` (Phase 4), it sets the simulation tick policy:

| coreLoop | One cycle | Tick / cycle schedule |
|---|---|---|
| `solve` | observe → hypothesize → act → confirm | Reflective / input-bound — each player input commits a single rule application; cascade / chain may multi-tick *after* the input commits. Fixed-timestep is unnecessary unless the genre has time pressure (e.g. timed `slidingPuzzle`). |
| `collect` | spot → reach → pick up → store | Per-tick state advance (entity positions, pickup hit-tests). Pickup events fire on collision; inventory / score delta committed at cycle end. |
| `survive` | sense threat → respond → maintain rhythm → endure | **Fixed-timestep mandatory** — physics / collision / death-line ramps are tick-bound, not frame-bound. Variable-timestep here breaks determinism and gives non-reproducible failures. |

The design overlay names the **policy** (which cycles are tick-bound vs input-bound); the engine partial supplies the API names; the code job materialises both.

### 3. Genre × coreLoop matrix gate (I9)

The matrix is enforced upstream by `GENRE_CORELOOP_MATRIX` + parser drop — the design job always sees a legal pair:

| Genre | Legal coreLoop set | Reading |
|---|---|---|
| `match3` | `solve`, `collect` | predict-then-swap (`solve`) or chain-payoff (`collect`) |
| `slidingPuzzle` | `solve` | reflective-only |
| `cardSolitaire` | `solve`, `collect` | reflective placement (`solve`) or foundation-promotion payoff (`collect`) |
| `arcadePaddle` | `survive`, `collect` | death-line ramp (`survive`) or brick / coin pickup (`collect`) |
| `arcadeSnake` | `survive`, `collect` | self-collision avoidance (`survive`) or pickup chain (`collect`) |
| `crowdRunner` | `survive`, `collect` | crowd-attrition ramp toward the terminal (`survive`) or gate / pickup accrual (`collect`) |

If an out-of-matrix pair surfaces in the LLM-emitted basis (a parser bug), surface it as an open question rather than silently coercing — the design surface is the last gate before code materialisation.

### 4. What design commits vs plan / code

| Concern | Plan owns | Design owns | Code owns |
|---|---|---|---|
| Genre identity | GDD §2: "this is a `match3` with cascading combos" | board dimensions enum, tile-kind count, cascade cap policy, special-tile rules | actual grid data structure, swap-command shape, cascade tick scheduler |
| CoreLoop shape | GDD §2 / §4: "the player solves a sliding board" | state-ownership boundary, event flow, determinism / tick policy | reducer code, event subscription, tick accumulator |
| Failure / completion | GDD §7 fail condition stated | `Lost` / `Won` event names + transition rules + restart cost | scene transitions, restart wiring, life-counter HUD update |
| HUD readouts | required-readouts list at GDD level | `UIScene` overlay specs (layout slots, glyph references in `game-art-spec.json`) | actual `UIScene.create` + Domain-event subscription |
| Asset hand-off | none (gameArt is its own tier) | catalog category keys (`hud` / `entities` / `particles`) committed | catalog lookup + texture / oscillator wiring |

### 5. What NOT to commit at design level

- ❌ Engine-specific API names (`Phaser.Scene`, `Graphics.fillRect`, Godot node names) — those belong to the engine partial under `basis/techTier/gameEngine/`.
- ❌ Pixel-level coordinates, palette hex codes, animation curve specifics — those are `gameArtTier` (palette / silhouette / motion-tone) plus `architecture/spec/...` (numeric values).
- ❌ Score formulas (`score += matched.length * 10`) — that is balancing surface owned by `architecture/spec/...`.
- ❌ `requestAnimationFrame` / `setInterval` mentions or any frame-scheduling implementation — those are code-time decisions, not design.
- ❌ Out-of-matrix `(genre, coreLoop)` pairing — even hypothetical (`arcadePaddle + solve`, `cardSolitaire + survive`) — the registry is the SSOT.

### 6. Blind-spot reminders (genre-specific design pitfalls)

- ⚠️ **Cascade / chain over-runs** in `match3` — design MUST commit a cascade cap or falling-speed ramp; without one, a single swap can chain >5 cascades and feel out of player control.
- ⚠️ **`slidingPuzzle` unsolvable starts** — design MUST commit whether shuffles are solver-validated or accept random with restart affordance.
- ⚠️ **Solitaire multi-card drag** semantics — design MUST commit whether sub-stack drag is allowed; touch interfaces need clear pivot feedback (interaction-grammar trap).
- ⚠️ **Paddle spin influence** — design MUST commit whether paddle position / velocity at impact affects ball angle (policy level only — formulas live in spec).
- ⚠️ **Snake speed-tier ramp** — design MUST commit ramp granularity (per-pickup, per-N-pickups, per-second) and any soft-cap to keep late-game playable.
- ⚠️ **`crowdRunner` resource cliff and formation overflow** — design MUST commit (a) a floor / clamp / preview mechanism so a single high-N divisor or full-formation hit cannot wipe the run with no anticipation, and (b) a soft-cap, density-preservation policy, or re-layout rule so unbounded multiplicative ops do not push the formation outside the steering surface. These reminders apply *regardless* of which steering axis, op universe, or threat shape the PRD picks — they are universal across the genre's polymorphism axes.
- ⚠️ **HUD-Domain write-back** — under any genre, HUD MUST NOT mutate Domain. Player input from HUD becomes a command; commands are the only inbound mutation channel.
- ⚠️ **Determinism break under `survive`** — paddle / snake / crowdRunner reducers need fixed-timestep; surfacing variable-timestep here corrupts replays and any future multiplayer.

### 7. Out of scope for this overlay

- Asset / art commitments (sprite count, palette, audio profile) — those are `gameArtTier`, not `gameContentTier`, and they belong to game-art design intents (`gen-game-art-figma` / `gen-game-art-desc`).
- Engine choice or framework — that is `techTier`, decided independently.
- Implementation-level scheduling primitives (`requestAnimationFrame`, accumulator code) — those are the code job's surface.
