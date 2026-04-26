## Genre: RPG

**Activation gate**: `gameContentTier.genre === 'rpg'`.

### One-liner

RPG promises **a character that grows through choice** — the player commits to a build, accumulates inventory, advances quests, and the character's measurable state at hour 10 is observably different from hour 1.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Stats or growth** | The numeric or categorical axes that change over time (level, attribute scores, perk tree). The growth source (XP, milestone, choice) is committed here. |
| **Inventory** | Where collected items live and how they are equipped / consumed. Slots, weight, stack rules — pick the model and commit. |
| **Quest or progression goal** | The stated objective that drives forward motion. Linear quest, branching, open objectives — pick one. |

The twist: "class-based stat growth + 6-slot inventory + branching main quest" is a commitment; "RPG with leveling" is empty.

### Coreloop affinity

Natural: `fight` (engage → strike → react → recover) for combat-RPGs; `explore` (observe → choose → traverse → discover) for adventure-RPGs.

Possible: `collect` (loot-driven), `solve` (`puzzle-rpg` hybrids). Rare: `build` — only when crafting / settlement is a major subsystem.

### HUD essentials

- **HP / MP (or analogous resource)** — the combat-state proxy.
- **Inventory access** — at minimum, a button that opens the inventory; quick-slot bar when combat is fast.
- **Quest indicator** — the player MUST always be able to surface "what next". Compass, marker, or quest log.
- **Level / XP gauge** — the growth proxy.

An RPG HUD without {HP, inventory access, quest indicator} is missing a system.

### What NOT to commit at PRD level

- ❌ Specific stat formulas (damage = ATK − DEF, etc.) — balancing surface.
- ❌ Item lists, quest text — narrative / content surface.
- ❌ Class names and lore — narrative surface.

### Blind-spot reminders

- ⚠️ **Growth source** (how the player gets stronger) is the most-skipped commitment. Pure XP-on-kill, milestone-only, or choice-based — pick.
- ⚠️ **Permadeath vs respawn** is a tone-defining decision. The PRD MUST state which side it lives on.
- ⚠️ **Save model** (auto, manual, checkpoint) is a hidden system — name it. Save model dictates how the player tolerates risk.
