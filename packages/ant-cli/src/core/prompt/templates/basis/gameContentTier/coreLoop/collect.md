## Core Loop: Collect

**Activation gate**: `gameContentTier.coreLoop === 'collect'`.

### Loop steps (4)

1. **Spot** — the player observes a collectible (item on the ground, target on the map, drop signal). Visibility is intentional — the player MUST be able to see it before deciding.
2. **Reach** — the player traverses to the collectible (walk, jump, dash, click). Traversal is the loop's effort.
3. **Pick up** — the player commits a contact (overlap, button press, drag). The system confirms with a sound / particle / counter increment.
4. **Store / consume** — the collectible enters inventory (counter, slot, currency) or fires its effect immediately. The Store step closes the cycle.

The loop runs in **seconds to minutes** depending on traversal cost.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Density** | More collectibles per unit of play space. |
| **Variety** | New collectible types with new effects or scoring. |
| **Risk near pickup** | Hazards / enemies guarding the pickup, raising the cost of Reach. |

A `collect` loop without density / variety / risk delta is a treadmill — the player picks up identical items forever.

### Reward cadence

- Pickup confirmation fires at **Pick up** (immediate).
- Cumulative reward fires when a counter crosses a threshold (10 coins → power-up, 5 keys → unlock).
- The threshold reward is the loop's actual progression signal; per-pickup reward is the rhythm.

### Failure semantics

- Soft failure = "missed a pickup", recoverable next cycle.
- Hard failure = "took damage / lost progress while reaching". Cost is HP, time, or a regression in the counter.
- Some `collect` loops are forgiving (no failure state); others are gated by hazards. Commit which.

### Affinity

Strong fit: `match3` (each cleared chain is a collect cycle), `cardSolitaire` (suit completions are the collected unit). Possible: `arcadeSnake` (food pickup), `arcadePaddle` (brick clear treated as score collection).

### Blind-spot reminders

- ⚠️ A `collect` loop where **collectibles are invisible until interacted** (loot boxes you cannot see inside) breaks the Spot step and turns the loop into a click-everywhere walk.
- ⚠️ **Inventory cap** matters — without one, every collectible is "free" and the variety axis loses bite.
- ⚠️ The **threshold reward** is the loop's spine. State the threshold in the PRD even if the number is balancing.
