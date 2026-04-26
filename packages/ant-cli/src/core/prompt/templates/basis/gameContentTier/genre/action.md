## Genre: Action

**Activation gate**: `gameContentTier.genre === 'action'`.

### One-liner

Action promises **timing-pressured player verbs with sub-second feedback** — the player issues a verb (swing, dodge, dash) and the system reacts within a perceptible window, building a rhythm of risk and reaction.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Core verb** | The signature action the player issues most often (swing, slash, dash, parry). The verb has an input window, an animation envelope, and a recovery window — those three slots are domain invariants. |
| **Hit feedback** | The deterministic feedback the system emits when the verb connects (hit-stop frames, screen flash, knockback, sound cue). Without explicit hit feedback the loop has no rhythm. |
| **Threat pacing** | How threats arrive in time (waves, intervals, density curve). Threat pacing is the iteration delta — what gets harder between cycles. |

The project's own **twist on each of these three** is the SBS payload — "side-arm slash with 6-frame startup and 2-frame parry window" is a commitment; "fast-paced action" is empty.

### Coreloop affinity

Natural: `fight` (engage → strike → react → recover). Also: `collect` for `action-platformer` hybrids.

Rare: `solve`, `build`, `explore` — if chosen, the action layer is a sub-system inside another loop.

### HUD essentials

- **HP** — the failure-state proxy.
- **Combo / score indicator** — the rhythm proxy; surfaces when the threat-pacing curve rewards rhythm.
- **Special / cooldown gauge** — when a non-core verb has a budget, its budget MUST be visible.

An action HUD without HP is a category error — the genre's failure state is invisible.

### What NOT to commit at PRD level

- ❌ Frame counts, hitstun values, exact damage numbers — those are balancing surface (design / spec).
- ❌ Sprite / animation frame counts — that is `gameArtTier`.
- ❌ Specific button bindings — those are input-mapping surface (UI / settings).

### Blind-spot reminders

- ⚠️ An action game without an explicit **recovery window** turns into mash-the-button — the recovery window is what makes the verb feel weighty.
- ⚠️ **Threat pacing** is what differentiates two action games of the same verb. A boss with no pacing curve is just a high-HP wall.
- ⚠️ Hit feedback is the genre's most-cut corner — name it explicitly even if it is "screen flash + sound", because removing it breaks the genre promise.
