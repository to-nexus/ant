## Code-Overlay: Phaser Engine (job × techTier × gameEngine=phaser)

**Activation gate**: job `code` × `techTier.gameEngine === 'phaser'`. Layered on top of `basis/techTier/gameEngine/phaser.md` (the universal Phaser ledger). This file adds the **code-job specific** discipline — what the LLM MUST honor at code-emission time when the engine is Phaser.

### Code-time priorities

1. **Single mount point** — every workspace has at most one `Phaser.Game` instance. The owning React component holds it on a `useRef` and destroys it on unmount.
2. **Three-scene minimum** — `BootScene` / `MainScene` / `UIScene`. A directive that asks for "a one-scene match-3 game" still needs `BootScene` (preload) and `UIScene` (HUD) — single-scene builds melt loading and HUD into `MainScene` and inevitably fail the I7 (UI ↔ art) surface boundary later.
3. **Domain decoupled** — Domain (rule reducer) lives in plain TS modules, NOT inside `MainScene`. `MainScene.update` calls `Domain.advance(state, command, dt)` and renders the result; tests instantiate Domain alone.
4. **HUD in `UIScene`** — score / move-count / hint UI is a `Phaser.Scene` overlay (NOT a React absolute-positioned div over the canvas). React only owns the page chrome around the canvas.
5. **Asset catalog at module scope** — `game-art-assets.json` is imported once at `BootScene` module load. Per-frame catalog reads are forbidden.

### Code-time forbidden

- ❌ `new Phaser.Game(...)` inside `MainScene.create` — that is a recursive game; mount belongs to React only.
- ❌ `this.scene.run('main')` followed by `this.scene.start('main')` — `run` and `start` overlap and double the loop. Pick one.
- ❌ `setTimeout(() => scene.events.emit(...), N)` for game-pacing — pacing belongs to `update(dt)` accumulators, not to wall-clock timers.
- ❌ Importing `phaser` inside Domain modules — Domain is engine-agnostic. Engine types live only inside scene files.
- ❌ Calling `this.load.audio(...)` while `_meta.phaseScope === 'p2-css-only'` — Phase 3 audio is procedural OscillatorNode, not file-based.

### Required wiring patterns

**Loop owner = `MainScene.update`**:

```ts
class MainScene extends Phaser.Scene {
  private domain = createDomain(initialState);
  private acc = 0;
  update(_time: number, delta: number) {
    this.acc += delta;
    while (this.acc >= FIXED_DT_MS) {
      this.domain.advance(this.collectCommands(), FIXED_DT_MS / 1000);
      this.acc -= FIXED_DT_MS;
    }
    this.render(this.domain.snapshot());
  }
}
```

**HUD subscribes via events**:

```ts
class MainScene extends Phaser.Scene {
  create() {
    this.events.on('score-changed', (n: number) =>
      this.scene.get('ui').events.emit('hud-score', n));
  }
  shutdown() {
    this.events.off('score-changed');
  }
}
```

**Asset catalog import**:

```ts
import catalog from '@/inputs/assets/game/game-art-assets.json' with { type: 'json' };
// (TS: declare module via vite/webpack JSON loader)
```

### Cross-overlay alignment

This file MUST stay consistent with:

- `basis/techTier/gameEngine/phaser.md` — universal Phaser ledger (API names, scene lifecycle, audio policy)
- `jobs/code/domain/game.md` — game-domain code overlay (loop ownership, scene separation, state separation)
- `jobs/code/basis/gameArtTier/_preamble.md` — css-only asset import policy

If two of those say different things about the same surface, the **most-specific gate** wins (engine partial > domain overlay > tier preamble). When that does not resolve, surface the conflict as an open question rather than picking silently.
