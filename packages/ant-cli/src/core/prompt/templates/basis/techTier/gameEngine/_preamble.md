## Game Engine (techTier overlay)

The `techTier.gameEngine` slot names the runtime engine that hosts the game build. This preamble frames what every engine partial commits to; the engine-specific file (e.g. `phaser.md`) supplies API names and integration shape.

**Activation gate**: `techTier × gameEngine === <name>`. Active only when the project domain is `game` (D2, matrix SSOT-1) and the basis slot opts into `techTier`. UI / spec / plan jobs do not see these partials.

### What an engine partial commits to (MECE)

Every engine partial answers the same six questions in the same order so cross-engine comparisons stay tractable:

1. **Host integration** — how the engine mounts inside the chosen framework (React / Vue / Svelte / standalone) and who owns the canvas / context lifecycle.
2. **Scene structure** — the engine's notion of scene / scene-tree / state machine and which lifecycle hooks each scene exposes.
3. **Graphics API policy** — the minimum-scope graphics primitives Phase 3 commits to (procedural shapes, no atlases) and the Phase 4 hook for richer rendering.
4. **Audio API policy** — how the engine cooperates with `audioProfile` (Phase 3 = procedural OscillatorNode, Phase 4 = file-based).
5. **Scene ↔ host communication** — the documented contract for engine→host (events) and host→engine (public method / message) traffic.
6. **Asset pipeline** — how `game-art-assets.json` entries (`kind: 'inline'` / `kind: 'external'`) become loaded textures / sounds in the engine's preload phase.

### Registry scope

`SUPPORTED_GAME_ENGINES` is intentionally a single-element registry today: `['phaser']`. Phaser 3 is a 2D HTML5 engine that mounts cleanly inside React; alternative engines (godot / cocos-creator / babylon / three) are deferred to Phase 5+ where the visual job's production-asset pipeline justifies the extra integration cost. The decision pipeline (decompose → emit → parse → applyToState) is unchanged — `gameEngineCandidates` still serializes the (cardinality-1) candidate list and the LLM still emits `<techTier>...|phaser</techTier>` through the normal channel.

### Decision tag handoff

`gameEngine` is part of `techTier`'s decision payload (DecisionTagRegistry, D8). The LLM emits it during the detect / decompose phase as `<techTier>frontend|typescript|react|<gameEngine></techTier>`. Code execution then consumes the engine partial verbatim — cardinality-1 means the resulting selection is deterministic, but the explicit/infer policy still applies (basis-wizard explicit selection always wins).
