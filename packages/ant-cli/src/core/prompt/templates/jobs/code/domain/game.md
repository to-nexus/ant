## Code-Overlay — Game Domain (Implementation Discipline)

**Activation gate**: job `code` × `domain === 'game'`. Layered on top of `templates/domain/game.md` (workspace identity, D27).

This overlay defines the **implementation discipline** specific to game projects. Use it when a code intent (`gen-code-sys` / `gen-code-spec` / `gen-code-directive` / `rev-code`) materializes a playable build. The code job decides **how** state advances, **where** the loop lives, and **which boundary** owns each side-effect — design's policies (state ownership, determinism, event flow) are taken as inputs and turned into running code, not redebated here.

### MECE implementation section map

The implementation surface is partitioned into 6 sections. The partition is **mutually exclusive** (each section answers one boundary commitment) and **collectively exhaustive** (the union covers every code-time decision a playable build forces).

| # | Section | Implementation commitment | Outcome the section commits |
|---|---|---|---|
| 1 | Loop ownership | Who advances time | A single boundary (Engine / Runtime) hosts the frame loop; Domain consumes `dt` only |
| 2 | Scene separation | How play modes split | Scene boundaries (`BootScene` / `MainScene` / `UIScene` or equivalent) and which boundary holds cross-scene data |
| 3 | State separation | What each layer may mutate | Domain (rule-bound) ↔ Render (sprite / animation cache) ↔ HUD (player-facing readouts) — three owners, one direction of writes |
| 4 | Asset import policy | How catalog entries become runtime values | `kind: 'inline'` mapped in code, `kind: 'external'` loaded from `inputs/assets/game/...`; wiring per `audioProfile` and `entityCatalog` axes |
| 5 | Determinism boundary | What is repeatable, what is approximate | Rule application is deterministic; particle / interpolation may approximate; this boundary is named in code, not implicit |
| 6 | What NOT to write | Constraints that bound the build | Pixel-perfect coordinates, frame-dependent formulas, DOM access from Domain, `setInterval` for game logic |

If a directive fits multiple sections, **split** rather than merge — duplication across sections is an MECE violation and downstream review will inherit it.

### 1. Loop ownership

Exactly one boundary owns the frame loop. Pick the engine integration partial (techTier × gameEngine) for the concrete API name; this overlay only commits to **shape**.

- The frame loop is hosted by the engine boundary (`Engine.update(dt)`), not by Domain. Domain receives `dt` (or fixed-step ticks) as an input and returns the next state — Domain MUST NOT call `requestAnimationFrame`, schedule its own frame work, or read the wall clock.
- Choose **fixed-timestep** for rule-bound systems (collision, physics, scoring). Choose **variable-timestep** only for purely visual interpolation. State the choice in code as a named constant, not as a comment.
- Pause / resume / step is the loop owner's responsibility. Domain has no notion of "paused" — the loop simply stops calling `update`. HUD likewise reads cached state, not loop status.

### 2. Scene separation

Treat scenes as independent reducer boundaries. The engine partial supplies the API; this overlay commits to **what crosses scene boundaries**.

- Each scene owns its own `init` / `preload` / `create` / `update` lifecycle (or the engine's analog). Scene-local sprites / listeners / timers MUST be cleaned up on `shutdown` — un-cleaned listeners are the most common source of leaks across scene transitions (⚠️ blind spot).
- Cross-scene data flows through one explicit boundary (engine registry, scene events, or an injected coordinator). Reaching into `sceneA.privateField` from `sceneB` is forbidden — name the boundary or surface a contract.
- HUD-only scenes (overlay) MAY read Domain state, but MUST NOT mutate it. Mutation goes back through the loop owner via emitted commands.

### 3. State separation

Three layers, three owners, write direction is one-way:

| Layer | Owner | May mutate | May read |
|---|---|---|---|
| Domain | rule-bound module / pure reducer | itself | nothing else |
| Render | sprite / animation cache | itself + visual interpolation | Domain (snapshot) |
| HUD | player-facing readouts | itself | Domain (snapshot), Render (cosmetic only) |

- HUD MUST NOT write to Domain directly. Player input becomes a **command** that the loop owner forwards to Domain — that is the only inbound mutation channel.
- Render reads a Domain snapshot per frame; visual smoothing (lerp, easing, particle decay) lives in Render and never feeds back into Domain.
- Domain is observable: every commit produces a snapshot or an event. Tests against Domain MUST run without instantiating Render or HUD.

### 4. Asset import policy

Asset import is driven by `game-art-assets.json` (D20). The code job consumes the catalog according to each entry's `kind`:

- `kind: 'inline'` — translate the inline payload into a runtime value at module scope: `css` becomes a `style` / template literal, `svg` becomes an inline element or `Image` blob, `oscillator` becomes a Web Audio config object. NO file I/O.
- `kind: 'external'` — load from the verbatim `src` path under `inputs/assets/game/...`. The loading boundary depends on the engine partial's preload API; Domain does NOT load assets directly.
- `_meta.phaseScope === 'p2-css-only'` (Phase 3 default) forces all `sfx` / `bgm` to procedural OscillatorNode configs — external audio is gated behind `'p4-external-enabled'`. Always honor the marker.
- Cross-pool reach is forbidden (I6): `game-art-assets.json` MUST NOT reference `inputs/assets/service/`, and `ui-assets.json` MUST NOT reference `inputs/assets/game/`. The two surfaces share workspace.domain but their pools are 1:1 separated.

### 5. Determinism boundary

Make the boundary explicit in code:

- Rule application (move, collide, score, phase transition) is deterministic given the same `(state, command, dt)`. Random rolls go through a seeded RNG that Domain owns — `Math.random()` directly inside Domain is forbidden.
- Visual approximation (particle drift, screen shake, easing) MAY use `Math.random()` and floating-point time — those values never feed back into Domain.
- Replays / undo / rollback (when the design demands them) only need the deterministic half. State the boundary in a comment or a type name (`DeterministicCommand` vs `CosmeticEvent`).

### 6. What NOT to write (game code)

| Forbidden | Why |
|---|---|
| `setInterval` / `setTimeout` for game logic | Frame-dependent and untestable; route through the loop owner |
| `requestAnimationFrame` inside Domain | Domain advances on `dt`, not on the renderer's pulse |
| `document.querySelector` / direct DOM mutation inside Domain | Couples rules to render, breaks tests |
| Pixel-perfect coordinates baked into Domain | Domain coordinates are units; Render maps to pixels |
| Frame-time-dependent movement (`x += 5`) | Always integrate `dt` |
| Cross-scene private-field access | Name the boundary or emit an event |
| `Math.random()` inside deterministic Domain | Use a seeded RNG owned by Domain |
| External-asset imports while `phaseScope === 'p2-css-only'` for sfx/bgm | Phase 3 is procedural-audio only |

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Spawn an enemy every 30 frames" | "Enemy spawn cadence is dt-driven and pause-aware; numbers come from spec" |
| **What over How** | "Use Phaser's Pool class for projectiles" | "Projectile lifetimes are reusable; pooling is an engine-partial decision" |
| **Observable over Assumed** | "The player will feel rewarded by the combo" | Observable contracts: snapshot diff, event log, replay determinism |
| **Universal over Specific** (outside the gate) | "Phaser.GameObjects.Sprite.x = ..." in this file | Engine-specific API names belong to `basis/techTier/gameEngine/<engine>.md` |
| **Constraints over Instructions** | "Make it run smoothly" | "Domain MUST NOT call `requestAnimationFrame`; the engine boundary owns the loop" |
| **Reminders for Blind Spots** | (none) | "⚠️ Scene transitions leak event listeners more often than any other site" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'game'`. It is REQUIRED to use game implementation vocabulary (`game loop`, `scene`, `sprite`, `tick`, `dt`, `oscillator`, `fixed-timestep`, `snapshot`). It is FORBIDDEN to:

- Specify service-domain implementation concerns (`RBAC`, `SLA`, `audit`, `persona`, `retention`, `non-functional`) — those live in `jobs/code/domain/service.md`. The matrix gate already excluded them; surfacing them here is a category error.
- Specify engine-specific APIs (`Phaser.Scene`, `GameObjects.Graphics.fillRect`, Godot node names) — those belong to the engine partial under `basis/techTier/gameEngine/`.
- Specify exact pixel coordinates, balance numbers, or asset filenames — those live in `outputs/design/spec/...` or the asset catalogs.

### Blind-spot reminders

- ⚠️ **Scene shutdown leaks** are the single most common bug. Every `on(event, fn)` registered in a scene MUST have a paired `off(event, fn)` in `shutdown`.
- ⚠️ **Frame-dependent movement** (`x += speed`) is invisible until the device frame rate changes. Always integrate `dt`.
- ⚠️ **HUD writing back to Domain** corrupts replay determinism. HUD emits commands; commands are the only path back into Domain.
- ⚠️ **External asset references during `p2-css-only`** for sfx/bgm bypass the phase scope marker and break Phase 3's "no user-placed files required" guarantee.
- ⚠️ **`Math.random()` inside Domain** silently breaks replays / multiplayer / save-load. Funnel randomness through a seeded source.

### Refine-mode discipline

When refining existing code (`rev-code`), the directive defines the scope. Do NOT cross into adjacent boundaries (Domain → Render, Render → HUD) even when the refinement reveals a leak there — surface the leak as an open question or a follow-up directive, do not silently rewrite.
