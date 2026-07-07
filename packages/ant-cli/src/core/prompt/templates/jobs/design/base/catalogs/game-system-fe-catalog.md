### § Overview
- System purpose and the architecture decision per dimension with rationale (reference the observed genre / coreloop from the PRD)
- Which boundary owns the authoritative simulation vs. which only renders it — state the separation up front
- PRD constraints relevant to architecture (viewport / orientation, input scheme, single-screen vs. camera-panned) — cite the PRD section, do not restate content

### § Scene Graph & Boundaries
- For each boundary: name, responsibility, what it owns (simulation engine, runtime/orchestrator, presentation/renderer, input source)
- Dependency direction between boundaries — the simulation engine MUST NOT depend on the renderer, timers, or input devices
- What crosses each boundary (commands inward, state snapshots / domain events outward)
- Scene composition at the container level (conceptual layers such as world / entities / effects / overlay) — name the layers, not engine node classes

### § Entity Model & State Ownership
- The entity catalog the simulation advances — cite PRD `EN-XXX` identifiers; do NOT re-derive the catalog
- The three-state separation and its single owner each: authoritative simulation state, optional predicted local state, presentation/UI state
- Which boundary owns each state kind and how (if at all) authoritative state is persisted
- Constraint: presentation reads state but is never the source of truth for rules; conceptual names only (position / velocity / phase), never internal field structs

### § Game State & Phase Machine
- The valid phases and allowed transitions (e.g. a coreloop's ready → active → resolved cycle) — cite the PRD coreloop (`CL-XXX`) the machine realizes
- Domain invariants that always hold (field boundaries produce events rather than silent clamping, scoring rules, motion bounds) — as policies, not numeric constants
- Which boundary owns the phase and which boundaries observe transitions
- Fail / restart transitions and their cost — cite the PRD fail condition

### § Game Loop & Timestep
- Which boundary owns the main loop / tick scheduling and how it feeds time into the simulation engine
- Timestep strategy at concept level (fixed-step / variable-step / hybrid) and which parts MUST be deterministic vs. which may be approximate (visual interpolation)
- How raw inputs are collected, normalized into commands, and grouped per tick before reaching the simulation
- Constraint: no frame-scheduling APIs, no timer names, no frame-time-dependent movement formulas — those are code-time decisions

### § Domain Events & Layer Flow
- The low-level rule-focused events the simulation emits (collisions, boundary crossings, phase changes, invalid/late input) — named contracts, not code
- How authoritative state snapshots are exposed to the runtime and presentation (pull vs. pushed) and when presentation re-renders
- Which boundary interprets domain events into meta-rules (score updates, round resets, difficulty adjustment)
- Constraint: the simulation emits rule events; meta-rule interpretation lives in the runtime/orchestrator, not the engine

### § Render Boundary & Viewport
- Commit which UI is screen-space (HUD, menus, overlays, full-screen modals — owned by the HTML/CSS surface) vs. world-space (camera-anchored, owned by the engine canvas). Decision rule: "if the camera pans, does this element pan with it?"
- For single-screen genres, state the world-space slot collapse explicitly so code does not invent in-world UI
- Viewport-fill policy at concept level (full-bleed vs. windowed) and which decisions adapt with breakpoints vs. stay anchored to a fixed design resolution
- Constraint: name slot identities (`scoreReadout`, `livesIndicator`), never pixel coordinates or the engine class that hosts the HUD

### § Multiplayer Synchronization (conditional: if PRD §10 specifies multiplayer or networked modes)
- Synchronization strategy at policy level: command ordering, state reconciliation (patch-to-snapshot vs. rollback & re-simulate), latency compensation
- Conflict handling for late / duplicate / conflicting commands (drop, clamp, or reconcile)
- Name the key contracts/boundaries involved (sync strategy, command channel, state provider) and their roles — cite the PRD game mode (`GM-XXX`)
- Constraint: policy only; no wire formats, no tick-rate numbers

### § Directory Structure & Boundary Mapping (conditional: if framework augmentation injected)
- Boundary-to-directory mapping principle (simulation / runtime / presentation / input separation) — invariant only, no file tree, no entity names
- Import direction enforcement rules (renderer and input depend inward on the simulation; the simulation depends on neither)
- Coding phase directives
