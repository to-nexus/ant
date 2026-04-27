## Genre: Crowd Runner

**Activation gate**: `gameContentTier.genre === 'crowdRunner'`.

### One-liner

Crowd-runner promises **steer-the-crowd** — a group of auto-advancing units travels along a course; the player commits a steering input that places the crowd against a stream of modifier gates and threats; the crowd's count and firepower are the resources that get spent and gathered along the way. The session is a single ramping run with the crowd's resources as the persistence record.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Crowd + steering model** | The player does not control a single avatar — the avatar **is the group**. The project commits: (a) **steering axis** — single (X-only / Y-only) / dual (X+Y) / radial (heading on a turn input) / lane-swap (discrete tracks) / branching (course splits at junctions). (b) **advance policy** — auto-advance at constant rate / auto-advance with player-tunable speed / event-paced (advance on input). (c) **formation rule** — line / grid / wedge / radial / chain / arbitrary. (d) **count↔formation bridge** — how a unit-count delta refreshes the layout (preserve density / preserve outline / collapse-and-respawn). |
| **Modifier-gate stream** | The course is studded with **gates** that mutate the crowd on contact. The project commits: (a) **op universe** — examples include arithmetic ops (`+N` / `-N` / `×N` / `÷N` / `=N`) on the crowd's count, attribute ops (`+Damage` / `+FireRate` / `+Range` / `+Pierce` / `+Shield`), structural ops (split / merge / formation-swap), or risk ops (`?N` random / wager). The PRD chooses any op set; the only invariant is that **at least one op category mutates a quantity the player tracks on the HUD**. (b) **placement cadence** — even / clustered / branching forced-choice / boss-prelude. (c) **conflict policy when multiple gates fire on one tick** — first-touched / left-priority / both-applied. |
| **Threat field + terminal** | The course has **threats** that consume the crowd, and a **terminal** that ends the run. The project commits: (a) **threat shape** — lane-aligned enemies / off-axis aerial / area obstacles / time-windows / lane-blocks. (b) **interaction model** — auto-fire (units engage without input) / aim-assist (steering biases targeting) / contact-only (no firing). (c) **terminal kind** — finish line / score zone / single boss / wave-cap / endless. (d) **lose condition** — crowd-resource at zero / formation collapsed / time expired / boss not defeated by terminal. |

The project's twist on each category is the SBS payload — naming "like Archero" or "like Crowd City" is empty; committing the steering axis, op universe, and threat shape is a commitment. Twist examples to inspire (not constrain):

- *"Radial-steering crowd around a center pole, gates rotate as a ring, boss opens a hole on the ring."*
- *"Two-axis crowd on a 2D field — Y is forward speed, X is lateral; gates only along the X."*
- *"Branching course with a forced-choice gate pair at each fork (`×2` vs `+Shield`); the crowd self-elects which side to take."*
- *"Aim-assist firing with a manual ammo budget — the player still does not pull a trigger but spends an ammo pool tracked on the HUD."*

### Coreloop affinity

Natural: `survive` (the crowd-loss → game-over loop is canonical — every threat tick whittles the crowd, every gate refills or boosts it). Strong fit: `collect` (gates and pickups make resource accrual the per-cycle reward). The `GENRE_CORELOOP_MATRIX` exposes both. `solve` is unusual; only adopt with a planning meta-layer (e.g. "pre-run loadout that the runtime then autoplays").

### HUD essentials

- **Crowd resource readout** — the count or aggregate the player tracks; whichever quantity is the lose-trigger MUST surface here.
- **Next-gate preview** — when gates carry choice or risk, the player needs *anticipation* before the impact instant. Gate-only runs can replace this with a threat telegraph; pure-threat runs can replace it with a danger meter. The invariant is "no impact instant without anticipation".
- **Terminal progress** — distance to finish / boss HP / score-zone clock. Without a terminal readout, an auto-advancing run feels anxious without payoff.
- **Power-state flags** — when a modifier op grants time-bound buffs (`+Shield 5s`, `+FireRate 8s`), surface the remaining duration. Permanent ops (stacking `+Damage`) need not.

### Concept affinity (guidance, not a hard gate)

Naturally readable concepts: `flatMinimal` (modern hyper-casual look), `neonArcade` (tron-tunnel runner), `pixelRetro` (8-bit lane-runner). `softPastel` works for a calmer "drone garden" theme; `cardClassic` is unusual — only adopt with an explicit visual rationale.

### What NOT to commit at PRD level

- ❌ Exact unit-spawn rates, exact bullet velocities, exact gate-modifier values, exact threat HP / damage, exact spawn cadences — balancing surface (design / spec).
- ❌ Crowd / unit / bullet / gate / threat palette, silhouette, sprite size — `gameArtTier`.
- ❌ Particle bursts on hit / death — `gameArtTier.particleProfile` (Phase 4).
- ❌ Frame-rate / tick-rate decisions — code-time concern, not PRD.

(Systems-shape choices — steering axis, op universe, formation rule, threat shape, terminal kind — ARE PRD's surface. Design / spec only owns numeric tuning; gameArtTier owns sensory commitments.)

### Blind-spot reminders (universal across any twist)

- ⚠️ **Resource cliff** — when one gate or threat can wipe the crowd in a single contact (a high-N divisor, a full-formation hit) the run loses its arc. PRD MUST commit a floor / clamp / preview mechanism so the cliff is anticipated, not surprising — *regardless of which steering axis or op set the project picks*.
- ⚠️ **Formation overflow** — when a multiplicative op keeps stacking unbounded, the formation outgrows the course bounds and the steering input loses meaning. PRD MUST commit a soft-cap, a density-preservation policy, or a depth / vertical re-layout.
- ⚠️ **Steering-input occlusion (touch)** — drag-controlled crowds suffer finger-over-formation; PRD commits the input mapping (drag-anywhere / drag-on-cursor / virtual stick).
- ⚠️ **Terminal silence** — an auto-advancing course without a visible terminal feels unbounded; PRD MUST commit either a finish-line readout, boss telegraph, or score-zone clock.
- ⚠️ **Choice without consequence** — a forced-choice gate pair (`×2` vs `+Shield`) only earns its UI cost if both branches are non-dominated for the player's current state. PRD commits how the design avoids "always-pick-X" gate pairs.
- ⚠️ **Auto-engage feedback void** — when units engage threats without input, a player who reads "nothing is happening" disengages. PRD commits at least one player-readable signal per engagement cycle (a sound, a muzzle silhouette, a hit reaction).
