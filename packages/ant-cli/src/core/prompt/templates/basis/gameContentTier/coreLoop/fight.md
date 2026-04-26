## Core Loop: Fight

**Activation gate**: `gameContentTier.coreLoop === 'fight'`.

### Loop steps (4)

1. **Engage** — the player and a threat enter contact range. Threat appearance is the loop's start signal.
2. **Decide** — the player chooses a verb (attack, dodge, block, ability) within an input window. Decision is informed by observed threat tells.
3. **Execute** — the verb plays out (animation, projectile, hit-check). System resolves outcomes deterministically.
4. **Recover** — both sides settle (recovery frames, post-hit knockback, regen tick). The next Engage starts when recovery clears.

The loop runs in **sub-seconds to seconds**. Fast action games loop several times per second; turn-based loops can be 10+ seconds per cycle.

### Iteration delta (what changes between cycles)

| Lever | Description |
|---|---|
| **Threat composition** | What kinds of threats appear (single, group, mixed types). |
| **Tempo** | How fast Engage signals fire — wave density, threat aggressiveness. |
| **Reward escalation** | Better outcomes (item, stat, scenario unlock) per cycle. |

A `fight` loop without escalating threat composition or tempo collapses into "fight 100 of the same enemy".

### Reward cadence

- Hit feedback fires at **Execute** (immediate, per-hit) — the rhythm signal.
- Combat-end reward fires at the cycle that resolves the encounter (kill, retreat, timer).
- Iteration reward (loot, XP, currency) fires at combat-end, NOT per-hit (per-hit currency turns combat into a slot machine).

### Failure semantics

- Failure = "took damage when avoidable". Cost is HP (numeric) plus a small confidence cost.
- Hard failure = "HP reached 0". Cost depends on the death model (respawn, checkpoint, permadeath).
- Recovery is built into the loop's **Recover** step — without recovery windows the loop is mash-the-button.

### Affinity

Strong fit: `action`, `shooter`, `rpg` (combat-RPGs). Possible: `platformer` (action-platformer hybrids), `strategy` (tactical combat).

### Blind-spot reminders

- ⚠️ A `fight` loop without **threat tells** (telegraphed attacks, audio cues) makes Decide feel random.
- ⚠️ **Recovery windows** are the genre's most-cut corner. Without them, optimal play is to spam the verb.
- ⚠️ **Damage model** (HP-based, posture-based, position-based) is a category-defining decision — commit, do NOT leave it implicit.
