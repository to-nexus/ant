## 🎮 Game Domain Design Guide

**Purpose**: This injection is included **only** when the project domain is classified as `game`.
It helps you describe **game rules, state ownership, determinism, and synchronization policies** at the System Design level (NOT at implementation level).

### 1. Game State Ownership Model (You MUST Define This)
- Clearly separate **three kinds of state** and assign a single owner boundary for each:
  - **Authoritative Simulation State**: canonical game world state advanced by the Domain engine (e.g., ball/paddles, scores, phase).
  - **Predicted Local State** (optional, usually client-side): speculative state used for client prediction between authoritative updates.
  - **Presentation/UI State**: purely visual/UX state (menus, animations, highlights) that never affects rules.
- System Design MUST specify:
  - Which boundary owns the authoritative state (usually Domain or Runtime/SessionManager) and how it is persisted (if at all).
  - Whether client prediction exists; if yes, how predicted state is reconciled with authoritative snapshots conceptually.
  - That Presentation reads state but never becomes the source of truth for rules.

### 2. Domain Invariants (Game Rules)
- Create a dedicated **Domain Rules & Invariants** subsection that lists the core policies explicitly. It MUST cover at least:
  - **Field boundaries**: Ball and paddles MUST NOT move outside the playable field; boundary crossings always produce a domain event instead of silent clamping.
  - **Motion constraints**: Paddles move with bounded speed per tick; document that a maximum movement per tick exists (policy-level only, avoid hard-coded numbers unless the PRD mandates them).
  - **Scoring rules**: Scores are non‑negative integers; in a single tick/round at most one side can score once; clarify when a point is awarded and how invalid/ambiguous states are handled.
  - **Phase model**: Enumerate valid phases (e.g., READY, PLAYING, PAUSED, FINISHED) and allowed transitions (e.g., READY → PLAYING → FINISHED; no direct FINISHED → PLAYING without RESET).
  - **Difficulty scaling (if applicable)**: Whether and how ball/paddle speed or other parameters change over time or based on performance (describe trends/policies, not exact numeric curves).
- State invariants MUST be independent of rendering, networking, or input device APIs.

### 2.5 GDD ↔ Design Responsibility Split (cite GDD §X to keep MECE)

**Principle**: The GDD is the SSOT for game content (coreloop / mechanics / aesthetic / fail / content scope / input & perspective / modes / meta-progression). System Design (game-system), game-art design (`game-art-design-by-{desc,figma}`), and game-content (balancing) **cite GDD sections by stable identifier** and elaborate **only the boundary / token / value** their axis owns. A design document that re-lists mechanics, re-derives entity catalogs, or restates aesthetic vocabulary is duplicating GDD content — that is an MECE violation.

**Citation pattern**: When a design task addresses content from the GDD, cite the GDD section and the symbolic ID. Examples:

- `GDD §4 (MC-Combat) → this design only specifies the input → event flow and simulation determinism for combat`
- `GDD §8 (EN-Hero) → this game-art task only commits the asset entries for hero variants`
- `GDD §6 (RW-Score) → this game-content task only sets the reward catalog values`
- `GDD §10 (GM-CoOp) → this design only specifies the synchronization policy for cooperative play`

**Hand-off table** (mirrors the GDD overlay's hand-off table — designs MUST respect this split):

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

**Constraint**: A design task whose output enumerates `MC-`, `EN-`, `LV-`, `RW-`, `GM-`, or `MP-` identifiers without citing the GDD section that defined them is creating shadow IDs. Design MUST cite the GDD; GDD identifiers are the SSOT.

**Constraint**: When the GDD is missing a section the design needs (e.g. §10 Game Modes is omitted yet the directive asks for sync policy), do NOT silently fabricate the policy — surface the gap as a question or a Pipeline-Input-Sufficiency failure that should be back-filled in the GDD.

### 3. Simulation Determinism & Timestep Policies
- For any time‑based game (including single‑player), the System Design MUST state high‑level determinism and tick policies, even if the PRD does not mention them:
  - **Determinism**: Is the simulation intended to be deterministic across runs given the same command sequence? If not, which sources of non‑determinism are acceptable?
  - **Tick strategy**: Which conceptual strategy is used (fixed‑step, variable‑step, hybrid)? How is time passed into the Domain engine (e.g., `deltaTime`, fixed tick index, real‑time clock vs logical ticks)?
  - **Time & precision**: How floating‑point/time behavior is treated conceptually (e.g., “physics uses a fixed update rate independent of render rate”, “avoid frame‑time dependent movement formulas”).
- Do NOT include formulas or exact numeric constants; focus on policies and responsibilities:
  - Which boundary controls the tick (Runtime vs Domain) and how it schedules/feeds time to the Domain engine.
  - Which parts of the system must be deterministic (rule application, collision outcomes) versus which may be approximate (purely visual interpolation/effects).

### 4. Domain Events vs Meta-Rules
- Domain engine should emit **low-level, rule-focused events**, for example:
  - Boundary and collision events: `BallCrossedLeftBoundary`, `BallCollidedWithPaddle`, `BallCollidedWithWall`, `PaddleClampToBoundary`.
  - Timing/phase events: `RoundStarted`, `RoundFinished`, `GamePhaseChanged`.
  - Input-related domain events: `MissedInputWindow`, `InvalidCommand` (late or impossible inputs).
- Application/Runtime interprets these into **meta-rules**:
  - Score updates, round resets, match end conditions, difficulty adjustments, achievements.
- System Design should list key domain events and state which boundary reacts to each (Domain vs Runtime vs Presentation).

### 5. Multiplayer & Synchronization Policies (If PRD Includes Multiplayer)
- At **policy level**, specify multiplayer synchronization strategy:
  - **Command ordering**: how commands are ordered (server time, sequence numbers) before being applied.
  - **State reconciliation**: whether clients reconcile by patching towards snapshots or by rollback & re-simulate.
  - **Latency compensation**: whether you use input delay, client prediction, or server-side lag compensation.
  - **Conflict handling**: what happens when late/duplicate/conflicting commands arrive (drop, clamp, or reconcile).
- Name the key contracts/boundaries involved (e.g., `SyncStrategy`, `CommandChannel`, `StateProvider`) and their roles in high-level terms.

### 6. Physics & Difficulty Policies (Policy Level Only)
- Treat the **Domain engine** as a black-box module: Inputs/Commands + Time → New GameState; Presentation is a separate renderer of that state.
- Describe **physics and difficulty** as policies, not math:
  - Reflection policy: e.g., "simple elastic reflection with optional speed scaling on paddle hits".
  - Speed scaling: whether ball speed or paddle speed increases over time or based on events.
  - Spin / angle influence: whether paddle position/velocity at impact influences outgoing ball angle (conceptually).
  - Difficulty policy: e.g., "AI paddle tracks ball position with capped reaction speed and intentional error margin".
- Do NOT write equations, vector operations, or step-by-step algorithms; keep it at **concept + effect** level.
- Do NOT include rendering commands (CSS transforms, Canvas/WebGL calls) inside Domain; they belong to Presentation only.

### 7. Event Flow: Domain → Application → Presentation
- System Design MUST describe high-level event/flow contracts between layers:
  - **Simulation tick events**: who owns the main loop, who calls `update(state, commands, time)` on the Domain engine.
  - **State snapshot events**: how new authoritative states are exposed (pull API vs pushed events) to Runtime and Presentation.
  - **Render-ready events**: how Presentation knows when to re-render (e.g., on each snapshot or only when visible state changes).
  - **User input batching**: how raw inputs are collected, normalized into commands, and grouped per tick/session before reaching Domain.
- Keep these as named contracts/operations (e.g., `GameRuntime.step()`, `StateProvider.getSnapshot()`, `InputProvider.collectCommands()`), not code.

### 8. What NOT to Write (Game Domain)
- ❌ No collision/physics/acceleration formulas, algorithms, or step-by-step procedures.
- ❌ No specific coordinates/velocities/timing constants.
- ❌ No tick implementation code (`requestAnimationFrame`, `setInterval`, timers) or frame scheduling details.
- ❌ No internal state structs like `{ x, y, vx, vy }` – use conceptual names only (e.g., "position", "velocity", "direction").

### 9. Render Boundary Policy (Coordinate-System Partition)
- System Design MUST commit which UI elements are **screen-space** vs **world-space** — at policy level only, with no engine API names:
  - **Screen-space** UI is fixed to the viewport: HUD readouts (score / lives / move-count), menus, pause overlay, settings, full-screen modals (Game Over / Win), page chrome. Owner: the HTML/CSS surface (e.g., React).
  - **World-space** UI moves with the game camera: sprite-anchored speech bubbles, in-world banners, NPC nameplates. Owner: the engine canvas surface.
  - Decision rule (commit in System Design): *"if the camera pans, does this UI element pan with it?"* — yes ⇒ world-space, no ⇒ screen-space.
- For single-screen genres (no camera pan), the world-space slot is typically empty and every UI element collapses to screen-space. Document this collapse explicitly so downstream code does not invent in-world UI.
- System Design MUST also commit a **viewport-fill policy** at concept level: full-bleed (canvas fills viewport, HUD overlays as screen-space) vs windowed (canvas occupies a sub-region, HUD around it). The policy is implementation-agnostic; engine scale APIs (`FIT` / `RESIZE` / etc.) belong to code, not design.
- Responsive boundary commitment: name which UI decisions adapt with viewport breakpoints (HUD layout, typography scaling) and which stay anchored to a fixed design resolution (canvas aspect, world bounds). Conflicts between the two MUST be surfaced in System Design rather than left to code.
- ❌ Do NOT specify which engine class hosts the HUD or which CSS framework styles it — those are code-time decisions.
- ❌ Do NOT prescribe pixel coordinates for HUD slots — system design names slot identities (`scoreReadout`, `livesIndicator`); placement / sizing is a code / design-spec concern.

This guide is **game-domain specific** and MUST NOT be injected for non-game (service) projects.
