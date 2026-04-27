## Particle Profile: Heavy

**Activation gate**: `gameArtTier.particleProfile === 'heavy'`.

### Promise

The `heavy` particle profile commits to **50+ particles per major emit event, ambient continuous emitters, multi-texture mixes, and chained particle responses**. Brick break with debris + spark + dust + ember; match clear with confetti + light beam + screen-edge sparkle; explosion with shockwave ring + smoke + flame core. The scene celebrates feedback maximally.

### What "heavy" looks like in code

- Multiple `Phaser.GameObjects.Particles` instances per scene; emitters are pre-warmed in the Boot scene and spawned via emitter `.emitParticleAt(x, y, count)`.
- 50+ particles per major event, with multi-emitter coordination (debris + spark layers fire together).
- Ambient emitters (background dust, neon ambient pulse, falling leaves) run continuously at low rate.
- Particle textures may be `kind: 'external'` (small PNG / atlas frames under `inputs/assets/game/particles/`).

### `game-art-assets.json` particles category shape

```jsonc
"particles": [
  { "id": "debris-shard", "kind": "external", "src": "inputs/assets/game/particles/shard.png" },
  { "id": "explosion-spark", "kind": "external", "src": "inputs/assets/game/particles/spark.png" },
  { "id": "ambient-dust", "kind": "inline", "format": "svg", "svg": "<circle cx='2' cy='2' r='2' fill='#aaa' opacity='0.4'/>" }
]
```

The `effects` category in `game-art-spec.json` then references multiple ids per effect:
```jsonc
"effects": {
  "brick-break": { "particles": ["debris-shard", "explosion-spark"], "count": 30, "spread": "radial", "durationMs": 800 }
}
```

### Phase scope contract

`heavy` typically requires **`_meta.visualScope === 'atlas-enabled'`** when external particle atlases are used. Pure-inline `heavy` is workable for simpler shapes but quickly bumps the design-time inline-payload ceiling (D21). Mixed inline + external is the usual configuration.

### Genre cross-reference (guidance, not strict)

- `arcadePaddle` → `heavy` is the canonical match for "juicy" Breakout / Arkanoid clones. Brick break + chain-explosion + ball-trail layers are the genre's expected feedback at this tier.
- `match3` → `heavy` is unusual but legal for "Royal Match"-style juicy match-3. Cascading match clears stack debris + confetti + ambient sparkle.
- `arcadeSnake` → `heavy` is unusual. Snake's clean Tron-grid aesthetic rarely benefits; reserve for "Slither.io"-style variants where leaderboard / boss interactions justify big VFX.
- `slidingPuzzle` → `heavy` mismatches the genre. Reflective tile-puzzles want quiet feedback.
- `cardSolitaire` → `heavy` mismatches the canonical `cardClassic` tone. Reserve for arcade-card hybrids ("Solitaire with magic").
- `crowdRunner` → `heavy` is reachable for projects that commit continuous bullet trails, ambient course-edge effects, formation-explosion on heavy ops, and big terminal / boss telegraphs. Default `crowdRunner` fits `light`; `heavy` is opt-in for ambitious feedback.

### Code-time consequences

- The motion budget can hit 12–18ms per frame during peak emits — close to the 16ms frame budget. The project must commit a frame-rate floor, may need to rate-limit (one major effect at a time, queue if more arrive), and may need to lower particle counts on slower devices via runtime detection.
- `BootScene.preload` registers all particle textures (external atlas typical).
- Sound (`audioProfile`) at this tier typically rises to `fileBased` or `hybrid` — particle bursts and SFX should fire on the same beat.

### Concept affinity (guidance, not strict)

`heavy` pairs naturally with `neonArcade` (Tron explosion grids, ambient neon dust, scanline overlays driven by particles). It works for `flatMinimal` only when the project explicitly leans into "juicy" feedback (Royal Match-style); otherwise downgrade. `pixelRetro` rarely supports `heavy` — era-faithful retro lacks the hardware tradition for it (only stylized retro that amplifies the era is acceptable). `softPastel` and `cardClassic` mismatch.

### Blind-spot reminders

- ⚠️ `heavy` while `visualScope === 'baseline'` is workable but constrained. The project either downgrades to `light` or accepts inline shape budget pressure.
- ⚠️ `heavy` while `audioProfile === 'procedural'` lands lopsided — visual fireworks without audio fireworks. Step up audio together.
- ⚠️ Ambient continuous emitters in `heavy` need an explicit on/off control surface (PRD should commit "ambient particles can be disabled in settings"). On lower-end devices, ambient is the first thing to cut.
- ⚠️ `heavy` while `motionPattern === 'static'` is inconsistent — static scenes do not benefit from heavy particles.
