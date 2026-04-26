## Genre: Shooter

**Activation gate**: `gameContentTier.genre === 'shooter'`.

### One-liner

Shooter promises **aim, fire, manage ammo** — the player's verb is projectile-bound, success is target-bound, and the failure pressure comes from running out of resources or being hit before the target is.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Aim** | The deterministic mapping from input to projectile vector. Continuous (mouse-look, twin-stick) or quantized (8-direction, lane-bound). The mapping is a domain invariant. |
| **Fire** | The verb's emission cadence (single-shot, burst, auto). Includes spread, recoil, and the input window per shot. |
| **Ammunition / cooldown** | The resource that limits fire. Magazine, energy, overheat — pick one and commit. Without an ammo gate, shooter degenerates into hold-the-button. |

The project's own twist on these three is the SBS payload — "twin-stick aim with 8-shot burst and overheat cooldown" is a commitment; "shoot enemies" is empty.

### Coreloop affinity

Natural: `fight` (engage → aim → fire → recover). Also: `collect` for arena pickups, `solve` for `puzzle-shooter` hybrids (constraint-bound shots).

Rare: `build`, `explore` — only as wrappers around the shoot loop.

### HUD essentials

- **HP / shield** — the failure-state proxy.
- **Ammo / heat gauge** — the resource gate; without it the player cannot pace.
- **Reticle / aim indicator** — the verb's targeting feedback. Even crosshair-less designs MUST commit a substitute (lock-on indicator, lane glow).
- **Score / wave indicator** — the iteration-delta proxy.

A shooter HUD without an ammo / heat gauge breaks the genre promise.

### What NOT to commit at PRD level

- ❌ Exact damage / spread / reload-time values — balancing surface.
- ❌ Particle / muzzle-flash visuals — `gameArtTier` (`particleProfile`).
- ❌ Specific weapon names / lore — narrative surface, decided per directive.

### Blind-spot reminders

- ⚠️ A shooter without an explicit **out-of-ammo** state degenerates into endless fire. State the consequence (reload, overheat lockout, switch weapons).
- ⚠️ **Aim quantization** (8-dir vs continuous) is a category-defining choice — commit early, do NOT leave it implicit.
- ⚠️ Friendly fire / cover / line-of-sight: each is a sub-system that, when present, MUST be named in the PRD's Defining Systems section. Implicit cover systems lead to disagreements at design time.
