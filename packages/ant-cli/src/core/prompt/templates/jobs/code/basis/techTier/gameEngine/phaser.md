## Code-Overlay: Phaser Engine (job × techTier × gameEngine=phaser)

**Activation gate**: job `code` × `techTier.gameEngine === 'phaser'`. Layered on top of `basis/techTier/gameEngine/phaser.md` (the universal Phaser ledger). This file adds the **code-job specific** discipline — what the LLM MUST honor at code-emission time when the engine is Phaser.

### Code-time priorities

1. **Single mount point** — every workspace has at most one `Phaser.Game` instance. The owning React component holds it on a `useRef` and destroys it on unmount via `Phaser.Game.destroy(true)` — leaking the instance leaks WebGL contexts, audio nodes, and event listeners.
2. **Three-scene minimum** — `BootScene` / `MainScene` / `UIScene`. A directive that asks for "a one-scene match-3 game" still needs `BootScene` (preload) and `UIScene` (in-canvas world-space overlay — see priority 4).
3. **Domain decoupled** — Domain (rule reducer) lives in plain TS modules, NOT inside `MainScene`. `MainScene.update` calls `Domain.advance(state, command, dt)` and renders the result; tests instantiate Domain alone.
4. **UIScene = world-space overlay only** — `UIScene` (Phaser overlay scene) hosts UI whose position follows the game camera: sprite-anchored speech bubbles, in-world banners, NPC nameplates. Screen-space HUD (score, lives, move-count, menus, modals) lives in **React**, NOT in `UIScene`. The five registered genres (`match3` / `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake`) are all single-screen — `UIScene` is typically empty / minimal for these and exists as a seam for future camera-panning genres. See `jobs/code/domain/game.md` §7 for the coordinate-system partition.
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

**React HUD subscribes via Phaser events** (HUD lives in React, not in a scene):

```ts
class MainScene extends Phaser.Scene {
  create() {
    this.events.on('score-changed', (n: number) =>
      this.game.events.emit('hud-score', n));
  }
  shutdown() {
    this.events.off('score-changed');
  }
}

function HudScore({ game }: { game: Phaser.Game }) {
  const score = useSyncExternalStore(
    (cb) => { game.events.on('hud-score', cb); return () => game.events.off('hud-score', cb); },
    () => game.registry.get('score') ?? 0,
  );
  return <div className="hud-score">{score}</div>;
}
```

**Asset catalog import**:

```ts
import catalog from '@/inputs/assets/game/game-art-assets.json' with { type: 'json' };
// (TS: declare module via vite/webpack JSON loader)
```

### Required viewport wiring (Scale Manager)

Phaser's `Scale Manager` decides how the canvas pixel buffer adapts to its container. The choice is committed in `Game.config.scale`:

| `scale.mode` | Canvas behaviour | When |
|---|---|---|
| `Phaser.Scale.FIT` | Letterbox — preserves aspect ratio, fits longest side, fills with bars on the other | Fixed aspect-ratio games (board / card / classic arcade) — every player sees the same play area regardless of viewport |
| `Phaser.Scale.RESIZE` | Canvas pixel buffer matches container exactly; the scene receives `'resize'` events to re-layout world objects | Fluid layouts where the play area can grow / shrink (free-camera, infinite scroll, responsive HUD) |
| `Phaser.Scale.ENVELOP` | Inverse of `FIT` — fills the container completely, may crop the longest side | Full-bleed cinematic backdrops where edges are non-essential |
| `Phaser.Scale.NONE` | No adaptation — fixed pixel buffer regardless of container | Almost never correct for a web build |

Required wiring:

- `Game.config.scale.parent` MUST point at a sized DOM element (the React container). If `parent` is unset or its DOM has no layout box, the canvas resolves to `0 × 0`. Always pass the React `useRef`'d element as `parent`.
- `Game.config.scale.width` / `height` are the *design* resolution; Scale Manager maps it to the parent box. Do not set HTML `width` / `height` attributes on the `<canvas>` — Phaser owns those after mount.
- For `Scale.RESIZE`, register a per-scene resize handler so cameras / world bounds / sprite layout follow the container:

```ts
class MainScene extends Phaser.Scene {
  create() {
    this.scale.on('resize', this.onResize, this);
  }
  onResize(size: Phaser.Structs.Size) {
    this.cameras.main.setSize(size.width, size.height);
    // re-layout world / HUD anchors as needed
  }
  shutdown() {
    this.scale.off('resize', this.onResize, this);
  }
}
```

- `devicePixelRatio` is honored automatically by Phaser when `scale.mode !== Scale.NONE`. For HiDPI sharpness, leave the default; only override `scale.zoom` when the design specifies an integer-pixel aesthetic (e.g. `pixelRetro` concept).
- `Phaser.Game.destroy(true, false)` on React unmount: the second argument MUST be `false` so the canvas DOM element is removed by Phaser (not orphaned in React's tree).

### Side-effect mitigation (R2 / R4)

#### R2 — React reconciliation latency for per-frame HUD

A HUD readout that updates every frame (a smooth gauge bar, a per-frame combo timer) MUST NOT route through React state. Each `setState` schedules a reconciliation — at 60 fps the reconciliation cycle blows the 16 ms frame budget and causes visible jitter.

| HUD readout cadence | React rendering pattern |
|---|---|
| Per-frame (gauge bars, smooth score interpolation, per-frame combo) | `useSyncExternalStore` subscribing to a Phaser `EventEmitter`, OR a `ref` + manual DOM mutation (`ref.current.textContent = ...`) inside the Phaser frame callback |
| Discrete (score on match, lives on hit, level transition) | `useSyncExternalStore` is fine; React state is also OK because the update rate is sparse |
| Static (menus, modals, settings panels) | Plain React state — no special pattern needed |

The decision rule: *"can this value change more than once per frame?"* — yes ⇒ external store / manual DOM mutation; no ⇒ React state.

#### R4 — WebGL context lost / restored

Mobile browsers can revoke a WebGL context when the tab backgrounds, the device runs out of memory, or the OS reclaims GPU resources. Phaser does not auto-recover; without explicit handling, the scene continues running against a dead context and the canvas freezes mid-game.

Required wiring:

```ts
class BootScene extends Phaser.Scene {
  create() {
    this.game.events.on(Phaser.Core.Events.CONTEXT_LOST, this.onContextLost, this);
    this.game.events.on(Phaser.Core.Events.CONTEXT_RESTORED, this.onContextRestored, this);
  }
  onContextLost() {
    // pause loop owner; emit 'context-lost' to React HUD so it can show a recovery prompt
    this.game.events.emit('context-lost');
  }
  onContextRestored() {
    // texture cache is gone — re-run preload, then resume; emit 'context-restored' to React
    this.scene.restart();
    this.game.events.emit('context-restored');
  }
}
```

The React side listens for `context-lost` / `context-restored` to keep its state in sync with the engine's recovery cycle. Forgetting these listeners is the most common reason a backgrounded mobile game appears "broken" on return.

### Cross-overlay alignment

This file MUST stay consistent with:

- `basis/techTier/gameEngine/phaser.md` — universal Phaser ledger (API names, scene lifecycle, audio policy)
- `jobs/code/domain/game.md` §7 — render boundary & viewport (screen-space React vs world-space engine, viewport-fill is the React container's responsibility)
- `jobs/code/basis/gameArtTier/_preamble.md` — css-only asset import policy

If two of those say different things about the same surface, the **most-specific gate** wins (engine partial > domain overlay > tier preamble). When that does not resolve, surface the conflict as an open question rather than picking silently.
