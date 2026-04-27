## Plan-Overlay — Game Domain (Game Design Document Skeleton)

**Activation gate**: job `plan` × `domain === 'game'`. Layered on top of `templates/domain/game.md` (identity, D27).

This overlay defines the **game design document (GDD) skeleton** for game projects. Use it when the planning intent (`gen-plan` / `rev-plan`) authors the design document. The plan job decides **what kind of game it is**, **why it is fun**, and **what bounds the prototype**; system-level commitments (state ownership, simulation determinism, event flow, multiplayer synchronization) belong to the design job — those words MUST NOT appear here.

### MECE game-design section map

The GDD is partitioned into 12 sections. The partition is **mutually exclusive** (each section answers one designer commitment) and **collectively exhaustive** (the union covers everything a playable prototype demands before system design starts).

| # | Section | Designer commitment | Outcome the section commits |
|---|---|---|---|
| 1 | Core Concept | One-line pitch | Who plays, what they do, why it is fun — in a single sentence |
| 2 | Genre & Coreloop | What kind of game it is | Concrete genre + repeatable action cycle (3- or 4-step) |
| 3 | 5-Minute Hook | First-impression contract | What a first-time player MUST experience in the first five minutes |
| 4 | Mechanics → Dynamics → Aesthetic | What → how → feel | Player verbs, emergent interactions, intended feeling (MDA layering) |
| 5 | Progression Curve | Pace of mastery | How difficulty / unlocks / mastery scale — within a session AND across sessions |
| 6 | Reward & Feedback | What the game gives back | Intrinsic (mastery / discovery) vs extrinsic (score / item / unlock) cadence + visibility |
| 7 | Fail Condition & Recovery | Failure as design | What counts as failure; how the player learns from it; restart cost |
| 8 | Content Scope | Ceiling on creation work | Number of stages / characters / items / enemies — explicit bound |
| 9 | Input & Perspective | Control & camera contract | Control scheme, viewpoint (2D side / 2D top / 3D first / ...), device target, **orientation policy** (locked-portrait / locked-landscape / fluid), **viewport target** (fullscreen / windowed) |
| 10 | Game Modes | Solitary or social | Single / co-op / async / competitive; if multiple, how they relate |
| 11 | Meta-Progression | What survives a session | Account-bound vs save-bound; permanent unlock vs per-run reset |
| 12 | Out-of-Scope (Non-Goals) | Explicit cuts | What this build is NOT — bounds the prototype |

If the directive overlaps multiple sections, **split** rather than merge — duplication across sections is an MECE violation. The 5-Minute Hook section, in particular, is NOT a summary of the Coreloop — it is a contract about onboarding pacing.

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Give the player a coin every 30 seconds" | "Reward must precede friction in the first five minutes; cadence and reward type are tunable" |
| **What over How** | "Use object pooling for projectiles" | "Projectile spawn must support burst patterns; implementation belongs to code" |
| **Observable over Assumed** | "Players will love the boss fight" | Describe what the player **sees / clicks / hears** during the boss fight; player-emotion claims need a referenced playtest or are deferred |
| **Universal over Specific** (outside the gate) | "Use Phaser for the canvas" | "Engine choice belongs to design / code; the GDD only commits to viewpoint and input" |
| **Constraints over Instructions** | "Make the boss hard" | "Boss MUST be defeatable on the first encounter once the player has unlocked all core verbs; difficulty numbers belong to balancing" |
| **Reminders for Blind Spots** | (none) | "⚠️ A GDD without an explicit fail condition produces a 'cannot lose' prototype that is mechanically boring" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'game'`. It is REQUIRED to use game-design vocabulary (`coreloop`, `mechanic`, `progression`, `hook`, `feedback`, `fail`, `MDA`, `playable verb`, `playtest`). It is FORBIDDEN to:

- Specify state ownership, simulation determinism, event flow, or synchronization policy — those are design's surface (`jobs/design/domain/game.md`)
- Specify exact damage / drop / spawn / cooldown numbers — those are balancing surface, owned by design or code
- Specify engine names, framework choices, or asset file formats unless the directive demands them
- Use service-domain vocabulary (`persona role`, `RBAC`, `SLA`, `non-functional requirement`, `audit log`, `retention policy`) — the matrix gate already excluded those concepts

### Blind-spot reminders

- ⚠️ A GDD without **Fail Condition** (section 7) is the most common gap. Implicit "you cannot lose" makes the prototype mechanically boring within minutes.
- ⚠️ A GDD without **5-Minute Hook** (section 3) lets engineering build a system that nobody can pick up in a demo. State what the player accomplishes BEFORE minute five.
- ⚠️ A GDD without **Out-of-Scope** (section 12) becomes a wish list. Explicit cuts are how a prototype stays shippable.
- ⚠️ Mechanics ≠ Story. If the directive is story-heavy, also list the **playable verbs** explicitly in section 4 (move / collect / shoot / select / negotiate / ...). Verbs the player issues are the actual game; the story is wrapping.
- ⚠️ Coreloop (section 2) is the **shortest** repeatable cycle. If it takes more than four steps to describe, decompose further. A coreloop with seven steps is a roadmap, not a loop.
- ⚠️ Progression Curve (section 5) is NOT just "the player gets stronger" — it must commit to **what changes between iterations** of the coreloop (faster, denser, novel verb, narrative beat).
- ⚠️ MDA (section 4) is layered: **Mechanics** are the verbs (`jump`, `shoot`, `match-three`); **Dynamics** are what emerges from interaction (`combo`, `risk-reward`); **Aesthetic** is the intended feeling (`fellowship`, `discovery`, `mastery`). State all three; do NOT collapse them.
- ⚠️ Content Scope (section 8) needs a number. "A few stages" is a planning failure — write "3 stages" and accept that design or playtest may revise it.
- ⚠️ Input & Perspective (section 9) MUST commit an **orientation policy** AND a **viewport target**. Omitting them lets downstream design / code default silently, and a portrait-only puzzle that ships landscape (or vice versa) is a defect that surfaces only in playtest. Single-line commitment is enough — e.g., "locked-portrait, fullscreen" — but it MUST be explicit.

### Refine-mode discipline

When refining an existing GDD (`rev-plan`), the directive defines the scope. Do NOT expand into adjacent sections, even when the refinement reveals a gap there — surface the gap as an open question or a follow-up directive, do not silently rewrite.

### Optional sections (game-specific extensions)

These appear only when the directive or genre warrants them. They are NOT mandatory:

- **Narrative & World-building** — only when the genre depends on story (rpg, adventure)
- **Economy** — only when in-game currency or trade is part of the coreloop
- **Multiplayer Pacing** — only when game modes include synchronous co-op or competitive (this is plan-level pacing, NOT design-level synchronization policy)
- **Accessibility Modes** — only when the directive explicitly names accessibility commitments
