## Core Loop: Build

**Activation gate**: `gameContentTier.coreLoop === 'build'`.

### Loop steps (4)

1. **Gather** — the player accumulates the resources that build consumes (mine, harvest, earn, salvage). Rate of gather is a system constraint.
2. **Place** — the player commits a structure / unit / module to the play space. Placement consumes the gathered resources and occupies space.
3. **Validate / optimize** — the player observes the placed system's output (production rate, throughput, defense) and adjusts. May re-place or remove.
4. **Repeat** — the player gathers more (now boosted by step 2's output) and starts the next cycle. The loop expands the player's footprint.

The loop runs in **minutes**. `build` is the slowest of the five loops.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Constraint tightness** | Land, energy, or resource caps tighten — the player optimizes more carefully. |
| **Unlocked options** | New buildable types appear, expanding the decision space. |
| **External pressure** | Threats arrive (attacks, time limits) that force the player to defend / hurry. |

A `build` loop without constraint tightening or external pressure is a sandbox — there is no shape to "more".

### Reward cadence

- Placement confirmation fires at **Place** (immediate visual + resource decrement).
- Output reward fires at **Validate** when the placed system produces something visible.
- Long-cycle reward fires at milestone (objective met, threat repelled, score reached).

### Failure semantics

- Soft failure = "placed sub-optimally", recoverable by removing and re-placing (cost may be partial refund).
- Hard failure = "external pressure overwhelmed the build" or "ran out of resources permanently". Cost is the run / save.
- Recovery in `build` is rebuilding from a partial state — failure rarely resets the whole world.

### Affinity

Strong fit: `strategy`. Possible: `casual` (idle / incremental games), `rpg` (settlement subsystems).

### Blind-spot reminders

- ⚠️ A `build` loop without a **stop signal** (objective, win condition, threat conclusion) becomes idle clicker without intent. Even sandboxes commit a "session-end" suggestion.
- ⚠️ **Resource overflow** (capped resources that fill faster than the player consumes) is a UX failure mode — name the cap and the consequence.
- ⚠️ **Reversibility** of placement (free undo vs partial refund vs no refund) defines tone. Commit early.
