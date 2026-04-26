## Core Loop: Explore

**Activation gate**: `gameContentTier.coreLoop === 'explore'`.

### Loop steps (4)

1. **Scan** — the player observes the visible portion of the world (current room, nearby map cells, known waypoints). The unknown is signaled (fog, unmapped edge).
2. **Choose** — the player picks a direction or target (next door, nearest unexplored, marker). Choice MUST be informed by the Scan output.
3. **Traverse** — the player moves to the chosen target. Traversal cost (time, stamina, risk) is a system constraint.
4. **Discover** — the player crosses the threshold and the world reveals new state (new room, new NPC, new resource node). Discovery MUST produce **observably new** information.

The loop runs in **seconds to minutes** per cycle.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Map novelty** | Each Discover reveals genuinely new content; recycled rooms with cosmetic swaps decay the loop. |
| **Path branching** | The Choose step has more options as the world grows, forcing prioritization. |
| **Memorability** | The world's structure becomes navigable from memory — landmarks, biome shifts, audio cues. |

An `explore` loop without map novelty or memorability degrades into wandering.

### Reward cadence

- Reveal feedback fires at **Discover** (the room shows, the map fills, a name appears).
- Discovery rewards (item, lore beat, shortcut) fire at Discover but are not on every cycle — pacing matters.
- Long-cycle reward fires at major reveal (boss room, biome transition, story beat).

### Failure semantics

- Soft failure = "got lost", recoverable by re-Scanning. Cost is time.
- Hard failure = "died exploring" or "missed a one-time discovery". Cost depends on the persistence model.
- Backtracking is part of the loop — explicit shortcuts (unlocked passages, fast travel) are how the loop manages backtrack cost.

### Affinity

Strong fit: `rpg` (especially metroidvania-style), `platformer`. Possible: `casual` (one-screen exploration), `strategy` (grand-strategy reveal).

### Blind-spot reminders

- ⚠️ An `explore` loop without an **unknown signal** (fog, unmapped, "?" marker) leaves Scan empty — the player has nothing to choose toward.
- ⚠️ **Backtrack cost** is the genre's most-cut corner. Long backtracks without shortcuts kill the loop's tempo.
- ⚠️ Procedural generation is a knob, not the loop itself. Procedural rooms with no memorable landmarks still violate the "novelty" lever.
