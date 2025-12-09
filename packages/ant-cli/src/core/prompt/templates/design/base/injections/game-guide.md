## 🎮 Game Domain Design Guide

**Purpose**: This injection is included **only** when the project domain is classified as `game`.
It helps you describe **domain rules, invariants, and realtime/synchronization policies** for game or physics-based systems at the System Design level.

### 1. Domain Invariants (Game Rules)
- The ball and paddles MUST NOT move outside the playable field (crossing a boundary should be represented as a domain event, not as "teleportation").
- Scores are non-negative integers, and in a single tick/round only one side can score at most once.
- Paddles move with a bounded speed; there is an upper limit on how far a paddle can move per tick.
- Game phases (READY / PLAYING / PAUSED / FINISHED) follow valid transitions only (e.g., do not jump directly from FINISHED back to PLAYING).

### 2. Domain Events vs Meta-Rules
- Domain engines emit **low-level events only**, such as:
  - `BallCrossedLeftBoundary`, `BallCollidedWithPaddle`, `BallCollidedWithWall`.
- Application/Runtime interprets these events into **meta-rules**:
  - Score updates, round resets, match end, difficulty adjustments.
- In System Design, focus on:
  - Which events can occur, and
  - Which boundary (Runtime/Application) is responsible for reacting to each event.

### 3. Simulation Policies (Policy Level Only)
- Describe physics/simulation behavior at the **policy** level, not as formulas:
  - Examples: "simple elastic reflection", "no friction", "constant-speed paddles".
- Do NOT include equations, algorithms, or specific numeric constants in the design document.
- Difficulty policies should be expressed as input/response strategies:
  - Example: "the AI paddle tracks the ball’s vertical position with a capped reaction speed".

### 4. Realtime & Tick Strategy (Only If PRD Requires)
- If the PRD explicitly mentions realtime behavior, capture the following at a high level:
  - Tick strategy: `fixed timestep` vs `variable delta` vs `hybrid`.
  - Performance goals: e.g., "target ~60 FPS", "aim to process each tick within ~16ms".
  - Whether deterministic behavior is required (for multiplayer or replay).
- If synchronization/multiplayer is in scope:
  - Whether Commands include timestamps or sequence numbers.
  - How StateProvider and SyncStrategy combine authoritative state with client prediction (conceptual description only).

### 5. What NOT to Write (Game Domain)
- ❌ No collision/physics/acceleration formulas, algorithms, or step-by-step procedures.
- ❌ No specific coordinates/velocities/timing constants.
- ❌ No tick implementation code (`requestAnimationFrame`, `setInterval`, timers).
- ❌ No internal state structs like `{ x, y, vx, vy }` – use conceptual names only (e.g., "position", "velocity", "direction").

This guide is **game-domain specific** and MUST NOT be injected for non-game (service) projects.
