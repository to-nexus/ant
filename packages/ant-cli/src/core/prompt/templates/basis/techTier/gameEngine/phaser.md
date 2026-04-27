## Game Engine: Phaser (HTML5 2D, React-hosted)

**Activation gate**: `techTier × gameEngine === 'phaser'`. Active when the basis slot opts into `techTier` and the LLM emits `phaser` as the engine.

This partial fills the six questions framed by `_preamble.md` for the **Phaser 3** engine when hosted under React (the Phase 3 default — `techTier = frontend|typescript|react|phaser`). Names are Phaser's actual API names; substituting Godot / Cocos vocabulary here is forbidden (SBS gate).

### 1. Host integration (React + Phaser)

Phaser is a sub-engine inside a React host. The split is:

| Concern | Owner |
|---|---|
| DOM, routing, global state, modals, account / auth, top-level layout | React |
| Canvas content, frame loop, physics, scene tree, sprites, sounds | Phaser |
| Lifecycle bridge (mount / unmount, pause / resume) | React component using a `ref` |

Mount shape (Phase 3 minimum):

```ts
const containerRef = useRef<HTMLDivElement>(null);
const gameRef = useRef<Phaser.Game | null>(null);

useEffect(() => {
  if (!containerRef.current) return;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerRef.current,
    width: 480,
    height: 640,
    backgroundColor: '#000000',
    scene: [BootScene, MainScene, UIScene],
  });
  gameRef.current = game;
  return () => {
    game.destroy(true);
    gameRef.current = null;
  };
}, []);

return <div ref={containerRef} />;
```

Constraints:

- ❌ Do NOT mount `Phaser.Game` outside `useEffect`. SSR will run the constructor against `undefined` `document`.
- ❌ Do NOT recreate `Phaser.Game` on every render — the `ref` keeps the singleton across renders.
- ✅ Always pass `game.destroy(true)` in cleanup; `true` releases canvas, audio context, and event listeners.

### 2. Scene structure

A Phase 3 build has three scenes minimum:

| Scene | Responsibility |
|---|---|
| `BootScene` | `preload` of inline atlases / external assets; flips to `MainScene` on `complete` |
| `MainScene` | Domain state advance, sprite render, input collection. Owns `update(dt)` |
| `UIScene` | HUD overlay (score, move-count, hint). Reads Domain snapshots only — never mutates |

Each scene exposes:

```ts
class MainScene extends Phaser.Scene {
  constructor() { super({ key: 'main' }); }
  init(data: SceneInitData) { /* receive cross-scene payload */ }
  preload() { /* load assets when not already loaded by BootScene */ }
  create() { /* spawn sprites, register listeners */ }
  update(time: number, delta: number) { /* advance Domain with delta */ }
  shutdown() { /* MANDATORY — clean up emitter listeners, timers, tweens */ }
}
```

Scene transitions:

- `this.scene.start('main', payload)` swaps the active scene.
- `this.scene.launch('ui')` runs `UIScene` in parallel with `MainScene`.
- `this.scene.stop('ui')` removes the overlay; `shutdown` MUST release listeners.

⚠️ **Listener leak blind spot**: any `this.events.on(...)` or `EventEmitter.on(...)` in `create` MUST have a paired `off(...)` in `shutdown`. This is the single most common bug in Phaser scene transitions.

### 3. Graphics API policy

Baseline visual scope (`_meta.visualScope === 'baseline'`, the default) uses **procedural shapes** via `Phaser.GameObjects.Graphics`:

```ts
const g = this.add.graphics();
g.fillStyle(0xff5577, 1);            // ARGB (alpha 0..1)
g.fillRect(x, y, width, height);
g.lineStyle(2, 0xffffff, 0.8);
g.strokeCircle(cx, cy, r);
```

Allowed primitives in baseline visual scope:

- `fillStyle` / `fillRect` / `fillCircle` / `fillTriangle` / `fillRoundedRect`
- `lineStyle` / `strokeRect` / `strokeCircle` / `strokeRoundedRect`
- `Phaser.GameObjects.Text` for HUD glyphs (no custom fonts; rely on system fonts)
- `Phaser.GameObjects.Sprite` only when an `external` catalog entry exists in `game-art-assets.json` (preload via `BootScene`)

Atlas-enabled hook (active when `_meta.visualScope === 'atlas-enabled'`):

- `this.load.atlas` / `this.load.spritesheet` for sprite atlases
- `this.add.particles` with custom textures
- WebGL shader pipelines

❌ Do NOT reach for `Phaser.GameObjects.Image` with a remote URL — assets MUST come through the `inputs/assets/game/...` pool (I6).

### 4. Audio API policy

Baseline audio scope (`_meta.audioScope === 'procedural-only'`, the default) is **procedural via Web Audio**, not Phaser's `SoundManager`. The reason is `gameArtTier.audioProfile === 'procedural'` (default, D16) — `OscillatorNode` configs in `game-art-assets.json` map directly:

```ts
function playOscillator(ctx: AudioContext, cfg: OscillatorConfig) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = cfg.type;
  osc.frequency.value = cfg.frequency;
  gain.gain.value = cfg.gain;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + cfg.durationMs / 1000);
}
```

The `AudioContext` is created lazily on the first user gesture (browser autoplay policy) and stored on `MainScene.data` or a global singleton — Phaser's `SoundManager` is bypassed under baseline audio.

External-enabled hook (active when `_meta.audioScope === 'external-enabled'`):

- `this.load.audio('shoot', 'inputs/assets/game/sfx/shoot.mp3')` + `this.sound.play('shoot')`
- `audioProfile === 'fileBased'` flips the policy; baseline audio scope force-suppresses `external` sfx/bgm regardless of LLM emission.

### 5. Scene ↔ React communication

The contract is symmetric, with one direction per channel:

| Direction | Channel | Use |
|---|---|---|
| Phaser → React | `Phaser.Events.EventEmitter` on the `Phaser.Game` instance, OR `game.registry` for shared values | Score updates, "game over" notification, level transitions |
| React → Phaser | A public method exposed on the scene singleton (`game.scene.getScene('main') as MainScene`) | Pause / resume, "start over" command, configuration toggles |

Example wiring:

```ts
const game = new Phaser.Game(cfg);
game.events.on('score-changed', (next: number) => setReactScore(next));

function pause() {
  const scene = game.scene.getScene('main') as MainScene | undefined;
  scene?.pauseGame();
}
```

Constraints:

- ❌ Do NOT pass React state setters into `MainScene` directly. The scene MUST emit events; React listens.
- ❌ Do NOT have React inspect `MainScene` private fields. Use `game.registry.get('score')` or the event channel.
- ✅ Both channels MUST tear down in the React cleanup (`game.events.off`, `game.destroy(true)`).

### 6. Asset pipeline

`game-art-assets.json` (D20) drives loading. The split by `kind`:

| `kind` | Phaser entry point | Where loaded |
|---|---|---|
| `inline` (`css`) | Mapped to `Phaser.GameObjects.Graphics` calls or DOM-style elements | At sprite-spawn time, no preload |
| `inline` (`svg`) | Materialized via `this.textures.addBase64('id', dataUri)` in `BootScene.preload` | `BootScene` |
| `inline` (`oscillator`) | Stored as a config object; played via `playOscillator` | At event time, no preload |
| `external` | `this.load.image('id', src)` / `this.load.audio(...)` (Phase 4 only) | `BootScene.preload` |

`BootScene.preload` reads the catalog at module scope:

```ts
import catalog from '@/inputs/assets/game/game-art-assets.json';

class BootScene extends Phaser.Scene {
  preload() {
    for (const entry of catalog.entities ?? []) {
      if (entry.kind === 'inline' && entry.format === 'svg') {
        const dataUri = `data:image/svg+xml;base64,${btoa(entry.payload)}`;
        this.textures.addBase64(entry.id, dataUri);
      } else if (entry.kind === 'external') {
        this.load.image(entry.id, entry.src);
      }
    }
    this.load.once('complete', () => this.scene.start('main'));
  }
}
```

Constraints:

- I6 — `entry.src` MUST start with `inputs/assets/game/`. Reaching into `inputs/assets/service/` from a game-art catalog is a boundary violation.
- `_meta.audioScope === 'procedural-only'` (default) suppresses external sfx/bgm — the loader skips `kind: 'external'` audio entries until `'external-enabled'`. `_meta.visualScope === 'baseline'` (default) likewise gates atlas / multi-emitter / multi-projectile setups behind `'atlas-enabled'`.
- Catalog ids are stable inside one design pass — do NOT rename ids in code without re-running the design job, or `game-art-spec.json` cross-references break.

### Blind-spot reminders

- ⚠️ Forgetting `game.destroy(true)` on React unmount leaks the WebGL context; subsequent mounts fail to acquire the canvas.
- ⚠️ A scene without `shutdown` cleanup leaks Phaser event listeners — the next `scene.start('main')` doubles every handler.
- ⚠️ Loading audio with `this.load.audio` while `audioScope === 'procedural-only'` silently violates the procedural audio policy. Always honor the marker.
- ⚠️ Cross-scene state via `MainScene.staticField` is invisible in tests. Use `game.registry` or scene events.
