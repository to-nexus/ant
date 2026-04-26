## Domain Identity — Game

**Activation gate**: `domain === 'game'`. Always-on for every job (plan / design / code / learn / ask). The gate decides nothing about tech stack, intent, or task type — those are orthogonal axes.

This partial states **what kind of project this is** so every downstream prompt shares a vocabulary about value, iteration cadence, and failure cost. Job-specific overlays (e.g. `jobs/plan/domain/game.md`) layer on top of this one.

### Core value axis

| Axis | Game prioritizes |
|---|---|
| Feel vs correctness | **Feel** — input response, animation timing, audio cue precedence |
| Iteration vs stability | **Iteration speed** — kill features that don't survive playtest |
| Delight vs scale | **Delight** — surprise, mastery, social moments |
| Engagement vs compliance | **Engagement** — minute-to-minute experience is the metric |

### Iteration cadence

- Rapid prototype + playtest loops — features may be cut between versions
- "Working code" is not enough; the build must produce the intended **player experience**
- Numbers (damage, drop rate, spawn rate) are tunable knobs, not contracts

### Failure cost ranking (highest to lowest)

1. Boredom — player drops the session within minutes
2. Confusion — player cannot infer what to do or what just happened
3. Unfair-feeling failure — loss without a learnable reason
4. Mechanical bug that breaks an in-progress run (less critical than a service crash because runs are short by design)
5. Cosmetic glitch outside core loop

### First-class domain entities

- **Player / agency** — what the player can do every moment
- **Coreloop** — the shortest repeatable cycle the game is built around
- **Mechanics** — concrete verbs the player issues
- **World / content** — stages, characters, items, enemies the player encounters
- **Progression** — what changes between iterations (within a run, across runs)
- **Reward & feedback** — what the game gives back, how, and when

### Universal constraint (every job)

Do NOT treat a game project like a service — there is no SLA, no SOC2, no "user retention" in the SaaS sense. Failure-and-retry is a **designed experience**, not a defect; balance and feel are first-class outputs, not nice-to-haves.
