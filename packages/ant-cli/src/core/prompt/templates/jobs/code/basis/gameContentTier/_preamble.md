## Code-Overlay: Game Content Tier (genre / coreLoop application)

**Activation gate**: job `code` × `gameContentTier` opted into the basis slot. Layered on top of `basis/gameContentTier/_preamble.md` (universal genre / coreLoop ledger).

This preamble defines how a code intent **applies** the genre / coreLoop decision at runtime. The universal ledger commits the genre's identity and loop steps; this file commits the code-side discipline for materializing them.

### 1. Genre → boundary mapping

`gameContentTier.genre` decides which Domain shapes are likely. The genre partial supplies the canonical entity model; this file commits the boundary it lives behind:

- **Domain** owns the genre's rule reducer (board state for puzzle, position / velocity for action, party state for rpg, ...). The reducer is engine-agnostic and tested in isolation.
- **Render** owns the genre's visual idioms (board cells for puzzle, sprite frames for action, dialog trees for rpg). Render reads Domain snapshots; never the inverse.
- **HUD** owns the genre's player-facing readouts. Genre HUD essentials are listed in each genre partial under "HUD essentials" — code wires them as `UIScene` (or equivalent) overlays.

### 2. CoreLoop → loop owner contract

`gameContentTier.coreLoop` decides what cycle the loop owner orchestrates. The loop owner is the engine boundary (techTier × gameEngine), but the **shape** of one cycle comes from the coreLoop partial:

| coreLoop | One cycle (typical) | Loop-owner responsibility |
|---|---|---|
| `solve` | observe → hypothesize → act → confirm | Surface the puzzle state each tick; emit a "cycle complete" event when the rule reducer accepts a confirmation |
| `fight` | engage → decide → execute → recover | Tick combat state at fixed-timestep; emit hit / miss events; recovery window suppresses input |
| `collect` | spot → reach → pick up → store | Render world entities; emit pickup events; inventory deltas committed at cycle end |
| `build` | gather → place → validate → confirm | Build mode toggles input mode; placement invokes Domain validation; confirmation commits |
| `explore` | scan → choose → traverse → discover | Camera follows player; map / fog state advances per cycle; discovery events fire on novel cell |

Code intent emits these as **named events** on the loop owner — never as ad-hoc `setTimeout` chains.

### 3. Genre + coreLoop affinity (sanity)

When the LLM-emitted genre and coreLoop disagree (e.g. `puzzle + fight`), the code job MUST surface the conflict rather than silently picking one. The most-affinity pairs (per the genre partials' "Coreloop affinity" sections) are:

| Genre | Natural coreLoop |
|---|---|
| `puzzle` | `solve` |
| `action`, `shooter` | `fight` |
| `platformer` | `collect` or `explore` |
| `rpg` | `fight`, `explore` |
| `strategy` | `build` |
| `casual` | depends on the directive — surface as open question if ambiguous |

Mismatched pairs (e.g. `casual + fight`) are not always wrong — sub-genres exist — but the code job MUST flag the tension as an inline comment or a follow-up directive.

### 4. HUD essentials (from genre partial)

Each genre partial lists "HUD essentials" — the player-facing readouts the genre demands. The code job wires them as `UIScene` overlays that read Domain snapshots. Examples:

- `puzzle` — score, move-count remaining, hint button
- `action` / `shooter` — HP, ammo, score / wave indicator
- `rpg` — HP / MP, inventory access, quest indicator
- `platformer` — lives, collected count, level timer
- `strategy` — resource counts, build queue, alert ribbon
- `casual` — minimum: score; everything else surfaces only when the directive demands it

Constraints:

- ❌ HUD MUST NOT mutate Domain — readouts only.
- ❌ HUD MUST NOT introduce new state that the genre's rule reducer does not already produce. If the genre needs "combo counter", Domain emits combo events; HUD displays them.

### 5. Forbidden code-time shortcuts

- ❌ Inferring genre / coreLoop from the directive at code-emission time without the LLM's emitted decision tag — the basis decision is the SSOT.
- ❌ Hardcoding genre-specific magic numbers (`MAX_COMBO = 5`, `BOARD_SIZE = 8`) without a sibling spec entry — magic numbers belong to `outputs/design/spec/...`.
- ❌ Mixing two genres' HUD idioms in one `UIScene` (an inventory grid in a puzzle game) — the genre boundary is also a HUD boundary.
