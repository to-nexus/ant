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
- Define invariants on the **authoritative simulation state**, for example:
  - The ball and paddles MUST NOT move outside the playable field (boundary crossings become domain events, not silent clamps).
  - Scores are non-negative integers, and in a single tick/round only one side can score at most once.
  - Paddles move with bounded speed per tick; acceleration limits are expressed as policies, not formulas.
  - Game phases (READY / PLAYING / PAUSED / FINISHED) follow valid transitions only (no direct FINISHED → PLAYING without RESET).
- State invariants MUST be independent of rendering or input APIs.

### 3. Simulation Determinism & Timestep Policies
- If PRD mentions replay, multiplayer, or fairness, you MUST state determinism policies:
  - Whether the simulation is intended to be **deterministic** across runs (same inputs → same state sequence).
  - Whether you use **fixed-step**, **variable-step**, or **hybrid** tick policy at a conceptual level.
  - How floating-point behavior is treated (e.g., “avoid frame-time dependent updates”, “time progresses in fixed quanta”).
- Do NOT include formulas or numeric constants; instead, describe:
  - Which boundary controls the tick (Runtime vs Domain) and how time is passed into the Domain engine.
  - Which parts of the system are required to be deterministic vs allowed to be approximate (e.g., purely cosmetic effects).

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

This guide is **game-domain specific** and MUST NOT be injected for non-game (service) projects.
