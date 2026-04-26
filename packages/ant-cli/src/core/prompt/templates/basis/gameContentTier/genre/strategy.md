## Genre: Strategy

**Activation gate**: `gameContentTier.genre === 'strategy'`.

### One-liner

Strategy promises **decision under constrained resources** — the player observes a system state, allocates limited resources or units, sees the consequence one turn / tick later, and the satisfaction comes from outsmarting the system rather than outreflexing it.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Unit or resource** | The thing the player allocates. Workers, gold, troops, settlements, cards. Quantity has an upper bound; the bound creates the decision. |
| **Decision turn** | The unit of time the system advances per player commitment (turn-based, real-time-with-pause, fixed tick). Defines reaction window. |
| **Win condition** | The stated terminal state (eliminate opponent, reach score, survive N turns). Without a stated win condition, strategy degenerates into a sandbox. |

The twist: "real-time-with-pause turn, 4 resource axes, score-by-control win" is a commitment; "strategy game" is empty.

### Coreloop affinity

Natural: `build` (gather → place → optimize → repeat). Also: `fight` for tactics genres; `explore` for grand-strategy.

Rare: `solve`, `collect` — only as side-systems.

### HUD essentials

- **Resource counts** — the constraint surface; always visible.
- **Build queue or order queue** — when the decision turn permits queued commitments.
- **Alert / notification ribbon** — events that demand attention (attack, depletion, completion).
- **Map / overview** — the system-state proxy. When the play space is larger than the screen, an overview is mandatory.

A strategy HUD that hides resource counts is a category error — the player cannot evaluate trade-offs.

### What NOT to commit at PRD level

- ❌ Exact resource yields, unit costs, combat math — balancing surface.
- ❌ Map sizes, faction lists — content surface.
- ❌ AI behavior trees — design / code surface.

### Blind-spot reminders

- ⚠️ A strategy game without **stated trade-offs** (resource A vs resource B, expansion vs defense) is a checklist, not a strategy.
- ⚠️ **Information visibility** (full map, fog of war, hidden information) is a tone-defining decision. Commit early.
- ⚠️ **Decision-turn cadence** dictates session length. Real-time-with-pause sessions average hours; turn-based with permadeath averages 30 minutes.
