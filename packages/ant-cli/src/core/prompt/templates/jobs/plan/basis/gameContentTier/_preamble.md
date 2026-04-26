## Plan-Overlay — Game Content Tier Hook

**Activation gate**: job `plan` × `domain === 'game'` × `gameContentTier` is decided (`genre` and / or `coreLoop` slot is populated). Layered on top of `templates/jobs/plan/domain/game.md` (GDD skeleton, D27). The matrix gate excludes `service` automatically — this file is dead for service projects.

This overlay sharpens **two GDD sections** when their tier values are pre-decided or selected during planning:

| Tier value | Applies to GDD section | What the overlay sharpens |
|---|---|---|
| `genre` (puzzle / shooter / rpg / platformer / strategy / casual / action) | §2 Genre & Coreloop | Genre-defining systems the PRD MUST commit |
| `coreLoop` (collect / fight / build / explore / solve) | §2 Genre & Coreloop, §4 MDA | Loop-defining steps the PRD MUST commit |

### Genre commitment principle (when `genre` is decided)

When the genre is decided in this turn or pre-set on the basis, the PRD MUST commit to **at least three genre-defining systems** so the design job has a non-empty seed. The overlay does NOT name those systems for the PM — the PM observes them from the genre baseline and cites them by category.

| Genre | Categories the PRD MUST cover (the project's specific instance, not the baseline) |
|---|---|
| puzzle | board / matching rule / combo or chain rule |
| shooter | aim / fire / ammunition or cooldown |
| rpg | stats or growth / inventory / quest or progression goal |
| platformer | move / jump or traversal verb / hazard or obstacle |
| strategy | unit or resource / decision turn / win condition |
| action | core verb / hit feedback / threat pacing |
| casual | one-touch input / one-screen scope / session-length cap |

The PRD must cite the project's **own twist** on each category — what makes THIS game different from the genre baseline. A PRD that only restates the baseline is empty (SBS violation: the genre gate's information payload is zero).

### Coreloop commitment principle (when `coreLoop` is decided)

When `coreLoop` is decided, the PRD MUST describe the loop as a **3- or 4-step cycle** with what changes between iterations. A loop without iteration-delta is a tutorial, not a loop.

| coreLoop | Skeleton (each step is a player verb the PRD owns) | What MUST change between iterations |
|---|---|---|
| collect | explore → pick → carry → store | Density / variety / risk near the pickup |
| fight | engage → strike → react → recover | Threat composition / tempo / reward |
| build | gather → place → optimize → repeat | Constraint tightness / unlocked options |
| explore | observe → choose → traverse → discover | Map novelty / path branching / memorability |
| solve | observe → hypothesize → act → confirm | Puzzle structure / constraint count / lookahead |

These skeletons are **starting points**, not contracts — the PRD is allowed to rename steps, merge two, or split one, as long as the rewritten loop still answers "what does the player do, in what order, and what changes next time".

### Reminders (FPOP-style blind spots)

- ⚠️ Do NOT lift the genre's **mechanics** from a famous game — name the project's own verbs. "Like Tetris" is not a commitment; "rotate / drop / clear-line / refill-from-top" is.
- ⚠️ A coreLoop step must be a **verb the player issues**, not a system reaction. "Damage is dealt" is a system reaction; "player times the swing" is the verb.
- ⚠️ When `genre` and `coreLoop` are both decided, they MUST be consistent with each other. A `puzzle` genre with a `fight` coreLoop is either a categorical error or the directive is intentionally subverting the genre — make the subversion explicit in the GDD.
- ⚠️ Multi-loop games (a meta-loop wrapping a moment-loop, e.g. roguelite) state both loops separately — coreLoop in this overlay is the **inner / shortest** loop. Outer loop, if any, is captured in §11 Meta-Progression of the GDD.

### Out of scope for this overlay

- Asset / art commitments (sprite count, palette, audio profile) — those are `gameArtTier`, not `gameContentTier`, and they belong to design / game-art jobs
- System-level mechanics rules (collision, determinism, tick policy) — those are design job's surface
- Engine or framework choice — that is `techTier`, decided later
