## Audio Profile: Hybrid

**Activation gate**: `gameArtTier.audioProfile === 'hybrid'`.

### Promise

The `hybrid` audio profile commits to **procedural OscillatorNode for SFX + external file-based BGM**. Short-lived feedback (tile-tap, match-clear, brick-break) stays inline as Web Audio synthesis; the longer-form atmosphere (background music, ambient loops) moves to external files. This is the bridge profile for prototype projects that have a BGM track ready but do not yet have a full SFX library.

### What "hybrid" looks like in code

| Surface | Realization |
|---|---|
| SFX | Same as `procedural` — small audio module wraps OscillatorNode, consumes `kind: 'inline'` entries with `format: 'oscillator'`. |
| BGM | Same as `fileBased` — Phaser `this.load.audio(bgmId, src)` in BootScene; `this.sound.play(bgmId, { loop: true })` in the gameplay scene. |
| Mute / volume | Two separate sliders (sfx volume / bgm volume) — the user controls each independently, since they have different sources. |

### `game-art-assets.json` shape

```jsonc
"sfx": [
  { "id": "tile-tap", "kind": "inline", "format": "oscillator", "type": "sine", "frequency": 880, "durationMs": 80, "gain": 0.3 },
  { "id": "match-clear", "kind": "inline", "format": "oscillator", "type": "triangle", "frequency": 660, "frequencyEnd": 1320, "durationMs": 220, "gain": 0.5 }
],
"bgm": [
  { "id": "ambient-loop", "kind": "external", "src": "inputs/assets/game/bgm/ambient-loop.mp3", "format": "mp3", "loop": true }
]
```

The `sfx` category stays inline; the `bgm` category is purely external.

### Phase scope contract

`hybrid` requires **`_meta.phaseScope === 'p4-external-enabled'`** because the BGM half is external. Under `phaseScope === 'p2-css-only'`, the marker overrides BGM and falls back to silence (the procedural SFX half continues to work).

### Genre cross-reference (D31-revised v8 — guidance, not strict)

`hybrid` is a strong fit for any v8 sub-genre when the project has a BGM track ready but does not yet want to author a full SFX library. Concrete pairings:

- `match3` → procedural cascade SFX + a relaxing-puzzle BGM track.
- `slidingPuzzle` → procedural snap / chime SFX + ambient meditative BGM.
- `cardSolitaire` → procedural flip / deal SFX + jazz / café BGM.
- `arcadePaddle` → procedural hit / crash SFX + retro-arcade BGM.
- `arcadeSnake` → procedural tick / eat SFX + chiptune BGM track.

### Code-time consequences

- The audio module has TWO subsystems — the SFX synthesizer (procedural) and the BGM loader (Phaser sound). Both share the same `AudioContext` (or interoperate via `this.sound.context`).
- `BootScene.preload` registers BGM only; SFX have no preload step.
- Volume controls split into two — the HUD typically exposes both as separate sliders or independent mute toggles.

### Concept affinity

`hybrid` is concept-agnostic at the pipeline level. A concept-specific BGM (synthwave for `neonArcade`, lo-fi for `softPastel`) sits at the content layer; the profile choice is independent.

### Blind-spot reminders

- ⚠️ `hybrid` while `phaseScope === 'p2-css-only'` falls back to procedural SFX + silent BGM — the project ships without atmosphere. Document the upgrade path in PRD.
- ⚠️ Listing `kind: 'external'` entries in the `sfx` category while `audioProfile === 'hybrid'` is inconsistent — those should migrate to the `bgm` category or the profile should be `fileBased`.
- ⚠️ The single `AudioContext` shared between the procedural synth and Phaser's BGM playback may need a context-suspend dance when the page loses focus — the audio module should listen for `visibilitychange` and pause both subsystems coherently.
