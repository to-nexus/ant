## Genre: Platformer

**Activation gate**: `gameContentTier.genre === 'platformer'`.

### One-liner

Platformer promises **traversal-as-skill** — the player's verb is movement (run, jump, dash, climb), the world is gap-and-hazard structured, and mastery is felt in the difference between an attempted path and a clean one.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Move** | The continuous traversal verb (walk / run, with optional ground acceleration / drag). Sets the player's baseline pace. |
| **Jump or traversal verb** | The signature traversal verb that bypasses obstacles (jump, double-jump, dash, glide, wall-cling). Has input window, height curve, and air-control rule. |
| **Hazard or obstacle** | What kills or sends back. Pits, spikes, enemies, time limits. Without explicit hazards, the level is a corridor. |

The twist: "run-and-jump with mid-air dash and 1-frame coyote-time" is a commitment; "platformer like Mario" is empty.

### Coreloop affinity

Natural: `collect` (explore → reach → pick → store) when stages have collectibles; `explore` for metroidvania-style branching.

Possible: `fight` for `action-platformer` hybrids. Rare: `solve`, `build` — only as set-piece sub-systems.

### HUD essentials

- **Lives / HP** — the failure-state proxy.
- **Collected count** — the iteration-delta proxy when the loop is `collect`.
- **Level timer** (optional) — when speedrun-style pacing matters.
- **Position-context indicator** — minimap or zone label, when the level is non-linear.

A platformer HUD without lives or HP is a "death is invisible" failure mode.

### What NOT to commit at PRD level

- ❌ Exact jump heights, gravity values, dash distances — balancing surface.
- ❌ Tile-art palette, sprite sizes — `gameArtTier`.
- ❌ Level layout — that is design / spec surface (the PRD commits hazards-in-general, not specific arrangements).

### Blind-spot reminders

- ⚠️ **Coyote-time** (a few frames of "ground" after the player walks off a ledge) is the most-cut corner that decides whether a platformer feels fair. Even if values belong to balancing, the PRD MUST commit to its existence.
- ⚠️ A platformer that pairs **fight** with **traverse** without a clear priority — which one is the loop's spine — collapses into "you can shoot but you mostly run".
- ⚠️ Camera follow rule (look-ahead, snap, smooth) is a hidden system. Name it.
