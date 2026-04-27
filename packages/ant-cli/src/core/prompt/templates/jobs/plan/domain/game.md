## Plan-Overlay — Game Domain (Game Design Document Skeleton)

**Activation gate**: job `plan` × `domain === 'game'`. Layered on top of `templates/domain/game.md` (identity, D27).

This overlay defines the **game design document (GDD) skeleton** for game projects. Use it when the planning intent (`gen-plan` / `rev-plan`) authors the design document. The plan job decides **what kind of game it is**, **why it is fun**, **what the player does and feels** (mechanic / aesthetic / progression / fail / reward), and **what bounds the prototype** (content scope, input & perspective, modes, meta-progression). System-level commitments (state ownership, simulation determinism, event flow, multiplayer synchronization) and game-art selection (palette / silhouette / lighting / asset categorization) belong to the design jobs that consume this GDD — those words MUST NOT appear here. The GDD is the SSOT consumed by `system-design` and `game-art-design-by-{desc,figma}` decompose; sections must be authored so design tasks can cite them by stable identifier.

### MECE GDD section map (12 + Optional)

The GDD is partitioned into a **Required core (8)**, **Conditional (4)**, and **Optional sections (game-specific extensions)**. Required-core sections appear in every GDD. Conditional sections appear only when the directive's scope warrants them; otherwise §12 records the reason for the omission. The partition is **mutually exclusive** (each section answers one designer commitment) and **collectively exhaustive** (the union covers everything a playable prototype demands before system / art design start).

#### Required core (always present)

| # | Section | Designer commitment | Outcome the section commits |
|---|---|---|---|
| 1 | Core Concept | One-line pitch | Who plays, what they do, why it is fun — in a single sentence |
| 2 | Genre & Coreloop (`CL-XXX`) | What kind of game it is | Concrete genre + repeatable action cycle (3- or 4-step), each step issued a `CL-` ID |
| 3 | 5-Minute Hook | First-impression contract | What a first-time player MUST experience in the first five minutes |
| 4 | Mechanics → Dynamics → Aesthetic (`MC-XXX`) | What → how → feel | Player verbs (each issued `MC-` ID), emergent interactions, intended feeling (MDA layering) |
| 7 | Fail Condition & Recovery | Failure as design | What counts as failure; how the player learns from it; restart cost |
| 8 | Content Scope (`EN-XXX`, `LV-XXX`) | Ceiling on creation work | Number of stages / characters / items / enemies — explicit bound, each entity / level issued an ID |
| 9 | Input & Perspective | Control & camera contract | Control scheme, viewpoint (2D side / 2D top / 3D first / ...), device target, **orientation policy** (locked-portrait / locked-landscape / fluid), **viewport target** (fullscreen / windowed) |
| 12 | Out-of-Scope (Non-Goals) | Explicit cuts | What this build is NOT — bounds the prototype |

#### Conditional (include only when the directive warrants it; otherwise note in §12 / §Open Questions)

| # | Section | Include when | Outcome the section commits |
|---|---|---|---|
| 5 | Progression Curve | The coreloop has repetition value (rogue-like, RPG, score-attack, etc.) | How difficulty / unlocks / mastery scale — within a session AND across sessions |
| 6 | Reward & Feedback (`RW-XXX`) | Rewards are part of the coreloop | Intrinsic (mastery / discovery) vs extrinsic (score / item / unlock) cadence + visibility, each reward type issued `RW-` ID |
| 10 | Game Modes (`GM-XXX`) | More than a single mode (co-op / async / competitive) | Single / co-op / async / competitive; if multiple, how they relate; each mode issued `GM-` ID |
| 11 | Meta-Progression (`MP-XXX`) | Cross-session progression matters | Account-bound vs save-bound; permanent unlock vs per-run reset; each meta-track issued `MP-` ID |

#### Optional sections (game-specific extensions)

These appear only when the directive or genre warrants them. They are NOT mandatory:

- **Narrative & World-building** — only when the genre depends on story (rpg, adventure)
- **Economy** — only when in-game currency or trade is part of the coreloop
- **Multiplayer Pacing** — only when game modes include synchronous co-op or competitive (this is plan-level pacing, NOT design-level synchronization policy)
- **Accessibility Modes** — only when the directive explicitly names accessibility commitments

#### Sections explicitly NOT included by default (forbidden without explicit directive)

The following are NOT chapters of a GDD unless the directive explicitly requests them. They belong to design / code / dedicated jobs:

- Test scenarios / QA / playtest plans — playtest belongs to the team's process, not the GDD
- Build / deployment / store-submission runbooks — design / code
- Migration plans — design / code
- Security / anti-cheat threat models — separate threat-modeling job, or a single line under §12 if real

If the directive overlaps multiple sections, **split** rather than merge — duplication across sections is an MECE violation. The 5-Minute Hook section, in particular, is NOT a summary of the Coreloop — it is a contract about onboarding pacing.

{{> jobs/plan/shared/identifier-convention}}

**Game-domain identifier prefixes**:

| Prefix | Owns | Example |
|---|---|---|
| `§N` / `§N.M` | Section / subsection number | `§4`, `§4.2` |
| `CL-` | Coreloop steps (§2) — keep to 3–4 steps max | `CL-Spawn`, `CL-Combat`, `CL-Reward` |
| `MC-` | Mechanics / player verbs (§4 MDA Mechanics) | `MC-Move`, `MC-Combat`, `MC-Match`, `MC-Negotiate` |
| `EN-` | Entities (§8 Content Scope) | `EN-Hero`, `EN-Boss`, `EN-Enemy-Goblin`, `EN-Coin` |
| `LV-` | Stages / levels (§5 / §8) | `LV-Forest`, `LV-Castle` |
| `RW-` | Reward types (§6) | `RW-Score`, `RW-Item`, `RW-Unlock` |
| `GM-` | Game modes (§10) | `GM-Solo`, `GM-CoOp`, `GM-Versus` |
| `MP-` | Meta-progression tracks (§11) | `MP-Hero-Unlock`, `MP-Save-Slot` |

{{> jobs/plan/shared/design-handoff-table}}

**Game hand-off table**:

| GDD section | Game-System Design picks up | Game-Art Design picks up | Game-Content (balancing) picks up |
|---|---|---|---|
| §2 Coreloop (`CL-XXX`) | State machine and transitions of coreloop steps | (indirect) | (rare) |
| §4 MDA Mechanics (`MC-XXX`) | Input → event flow, simulation determinism | Mechanic-feedback motion-tone | Mechanic tuning values |
| §4 MDA Aesthetic | (indirect) | Palette / silhouette / lighting tokens | (indirect) |
| §5 Progression Curve | (indirect) | (indirect) | Curve dataset |
| §6 Reward & Feedback (`RW-XXX`) | (rare) | Feedback visuals / motion-tone | Reward catalog values |
| §7 Fail Condition | State transition (defeat → restart cost) | Fail UI treatment | (rare) |
| §8 Content Scope (`EN-XXX`, `LV-XXX`) | (indirect) | SSOT for asset categories and counts | Content catalog |
| §9 Input & Perspective | Input handling / viewport policy | Viewport / camera scheme / orientation visuals | (rare) |
| §10 Game Modes (`GM-XXX`) | Multiplayer synchronization policy | (rare) | Mode-specific content |
| §11 Meta-Progression (`MP-XXX`) | Persistence contract | (rare) | (rare) |

{{> jobs/plan/shared/external-asset-citation}}

**Game-domain external asset kinds and citation locations**:

- Allowed kinds: `concept` (concept art image, path under `inputs/assets/game/concept/...`), `reference` (URL or path to a video / image showing the desired feel), `sprite` (path under `inputs/assets/game/...` to a checked-in sprite), `sound` (path to a checked-in audio clip), `figma` (URL or `<node-id>` for UI-heavy game projects).
- Citation locations: §4 MDA (per `MC-` for mechanic feedback reference), §6 Reward & Feedback (per `RW-`), §8 Content Scope (per `EN-` / `LV-`), §9 Input & Perspective (rare — viewport reference).
- Example: `EN-Hero — concept: inputs/assets/game/concept/hero.png` on a separate line inside the §8 entry for `EN-Hero`.
- Citations for a specific entity override the inline-first default in `game-art-design-by-desc` for **that entity only** — design uses the cited asset as `external` `src`. Entities without a citation keep the inline-first default.

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Give the player a coin every 30 seconds" | "Reward must precede friction in the first five minutes; cadence and reward type are tunable" |
| **What over How** | "Use object pooling for projectiles" | "Projectile spawn must support burst patterns; implementation belongs to code" |
| **Observable over Assumed** | "Players will love the boss fight" | Describe what the player **sees / clicks / hears** during the boss fight; player-emotion claims need a referenced playtest or are deferred |
| **Universal over Specific** (outside the gate) | "Use Phaser for the canvas" | "Engine choice belongs to design / code; the GDD only commits to viewpoint and input" |
| **Constraints over Instructions** | "Make the boss hard" | "Boss MUST be defeatable on the first encounter once the player has unlocked all core verbs; difficulty numbers belong to balancing" |
| **Reminders for Blind Spots** | (none) | "⚠️ A GDD without an explicit fail condition produces a 'cannot lose' prototype that is mechanically boring" |
| **Composition over Implementation** (§4 / §8) | "Spawn 3 enemies on a 5-second timer" | "The mechanic MUST commit to a wave shape (sparse / dense / boss) and an entity catalog (`EN-XXX`); spawn timing is balancing" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'game'`. It is REQUIRED to use game-design vocabulary (`coreloop`, `mechanic`, `progression`, `hook`, `feedback`, `fail`, `MDA`, `playable verb`, `playtest`). It is FORBIDDEN to:

- Specify state ownership, simulation determinism, event flow, or synchronization policy — those are design's surface (`jobs/design/domain/game.md`)
- Specify exact damage / drop / spawn / cooldown numbers — those are balancing surface, owned by design or code
- Specify engine names, framework choices, or asset file formats unless the directive demands them
- Use service-domain vocabulary (`persona role`, `RBAC`, `SLA`, `non-functional requirement`, `audit log`, `retention policy`) — the matrix gate already excluded those concepts
- **Add forbidden-by-default chapters** (test / playtest plans, build / deployment runbooks, migration / store-submission, security / anti-cheat models) unless the directive explicitly requests them — the GDD must stay focused on planning content, not on its periphery

### Blind-spot reminders

- ⚠️ A GDD without **Fail Condition** (§7) is the most common gap. Implicit "you cannot lose" makes the prototype mechanically boring within minutes.
- ⚠️ A GDD without **5-Minute Hook** (§3) lets engineering build a system that nobody can pick up in a demo. State what the player accomplishes BEFORE minute five.
- ⚠️ A GDD without **Out-of-Scope** (§12) becomes a wish list. Explicit cuts are how a prototype stays shippable.
- ⚠️ Mechanics ≠ Story. If the directive is story-heavy, also list the **playable verbs** (`MC-XXX`) explicitly in §4 (move / collect / shoot / select / negotiate / ...). Verbs the player issues are the actual game; the story is wrapping.
- ⚠️ Coreloop (§2) is the **shortest** repeatable cycle. If it takes more than four steps to describe, decompose further. A coreloop with seven steps is a roadmap, not a loop.
- ⚠️ Progression Curve (§5) is NOT just "the player gets stronger" — when included, it must commit to **what changes between iterations** of the coreloop (faster, denser, novel verb, narrative beat). When omitted, record the reason in §12 / §Open Questions.
- ⚠️ MDA (§4) is layered: **Mechanics** are the verbs (`MC-Jump`, `MC-Shoot`, `MC-Match`); **Dynamics** are what emerges from interaction (`combo`, `risk-reward`); **Aesthetic** is the intended feeling (`fellowship`, `discovery`, `mastery`). State all three; do NOT collapse them.
- ⚠️ Content Scope (§8) needs a number AND a stable ID per entity. "A few stages" is a planning failure — write "3 stages: `LV-Forest`, `LV-Castle`, `LV-Throne`". Without `EN-` / `LV-` IDs, game-art-design has nothing to derive asset categories from.
- ⚠️ Input & Perspective (§9) MUST commit an **orientation policy** AND a **viewport target**. Omitting them lets downstream design / code default silently, and a portrait-only puzzle that ships landscape (or vice versa) is a defect that surfaces only in playtest. Single-line commitment is enough — e.g., "locked-portrait, fullscreen" — but it MUST be explicit.

### Refine-mode discipline

When refining an existing GDD (`rev-plan`), the directive defines the scope. Do NOT expand into adjacent sections, even when the refinement reveals a gap there — surface the gap as an open question or a follow-up directive, do not silently rewrite. When a refinement changes a section that owns a stable identifier (`CL-`, `MC-`, `EN-`, `LV-`, `RW-`, `GM-`, `MP-`), preserve the identifier even if the description is rewritten — downstream design tasks cite it by ID.

{{> jobs/plan/shared/pipeline-input-sufficiency}}

**Game GDD sufficiency checklist** (run before handing off to design):

- [ ] Does §8 Content Scope list `EN-XXX` entities and `LV-XXX` levels with integer counts so `game-art-design-by-{desc,figma}` can derive asset categories?
- [ ] Does §4 MDA Mechanics list `MC-XXX` verbs so `system-design` can decompose input → event flow per mechanic?
- [ ] Is §4 MDA Aesthetic expressed in palette / silhouette / lighting / motion-tone words so `game-art-tokens` can derive tokens (rather than falling back to `gameArtTier.concept`)?
- [ ] Does §9 Input & Perspective commit an orientation policy AND a viewport target so `game-art-design` can decide viewport / camera scheme?
- [ ] Are §2 Coreloop steps (`CL-XXX`) named so `system-design` can identify state-machine candidates?
- [ ] When §10 Game Modes is included, does it surface multiplayer / sync requirements so `system-design` can identify sync-policy candidates? (When omitted, is the reason in §12 / §Open Questions?)
- [ ] Conditional sections (§5, §6, §10, §11): for every conditional that is omitted, is there a one-line reason in §12 / §Open Questions?

A "no" on any item: either author the missing content now, or record the gap with a reason. Do not fabricate.
