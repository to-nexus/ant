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

### Phase-3 minimum scope reminder

In Phase 3 only **`phaser`** has a non-stub body. `godot` and `cocos-creator` carry one-line placeholders and are reserved for Phase 4+ work. When the LLM emits `gameEngine` other than `phaser`, the build degrades gracefully: the runtime falls back to the universal `domain === 'game'` overlay (`templates/jobs/code/domain/game.md`) without engine-specific guidance, and downstream code MUST flag the missing partial as an open question rather than fabricate API names.

### Decision tag handoff

`gameEngine` is part of `techTier`'s decision payload (DecisionTagRegistry, D8). The LLM emits it during the detect / decompose phase as `<techTier>frontend|typescript|react|<gameEngine></techTier>`. Code execution then consumes the engine partial verbatim — no implicit defaulting beyond Phase 3's `phaser`.
