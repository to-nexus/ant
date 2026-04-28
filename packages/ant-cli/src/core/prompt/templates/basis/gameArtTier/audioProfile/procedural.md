## Audio Profile: Procedural

**Activation gate**: `gameArtTier.audioProfile === 'procedural'`.

### Promise

The `procedural` audio profile commits to **Web Audio API OscillatorNode + GainNode + envelope shaping**. Every SFX in the project is synthesized at runtime from primitive waveforms — sine / square / sawtooth / triangle — modulated by quick envelopes. There are zero external audio assets; `assets/game/sfx/` and `assets/game/bgm/` may be empty (or contain user-placed legacy files that this profile ignores). The project ships entirely with Web Audio synthesis.

### What "procedural" looks like in code

| Surface | Realization |
|---|---|
| SFX playback | A small audio module wraps `AudioContext.createOscillator()` + `AudioContext.createGain()` and exposes `playSfx(id)` consuming the `game-art-assets.json` `sfx` entry. |
| `sfx` asset entry | `kind: 'inline'`, `format: 'oscillator'`, payload includes `type` (waveform), `frequency` (Hz), `durationMs`, `gain` (0–1), and optional `frequencyEnd` for pitch-bend. |
| BGM | Either omitted entirely or a short procedural loop made of stacked oscillators. Phase 3 default is "no BGM" — the playable scene is silent ambience. |
| AudioContext lifecycle | Gated by user gesture (browser autoplay policy). The first SFX trigger opens the context. |

### `game-art-assets.json` sfx category shape

```jsonc
"sfx": [
  { "id": "tile-tap", "kind": "inline", "format": "oscillator",
    "type": "sine", "frequency": 880, "durationMs": 80, "gain": 0.3 },
  { "id": "match-clear", "kind": "inline", "format": "oscillator",
    "type": "triangle", "frequency": 660, "frequencyEnd": 1320, "durationMs": 220, "gain": 0.5 },
  { "id": "fail", "kind": "inline", "format": "oscillator",
    "type": "sawtooth", "frequency": 220, "frequencyEnd": 110, "durationMs": 350, "gain": 0.4 }
]
```

The procedural format keeps the `sfx` entries text-only — the inline complexity ceiling (D21) does not bite.

### Phase scope contract

`procedural` is the default audio profile and works under both `audioScope === 'procedural-only'` and `'external-enabled'`. When `audioScope === 'procedural-only'`, ALL audio is forced procedural regardless of LLM-emitted `audioProfile` — that is the marker's job (see `_preamble.md` Section 5).

### Genre cross-reference (guidance, not strict)

`procedural` is the canonical audio profile for ALL registered sub-genres in Phase 3:

- `match3` → tile-tap, match-clear (rising pitch), cascade (descending pitch ramps).
- `slidingPuzzle` → slide-tap, snap-to-grid click, goal-reached chime.
- `cardSolitaire` → card-flip, card-place, suit-complete chime.
- `arcadePaddle` → paddle-hit, brick-break, ball-lose.
- `arcadeSnake` → tick (subtle), food-eat, death.
- `crowdRunner` → gate-pass (op-flavoured tone), unit-fire (short blip), unit-loss (low thud), terminal-arrival chime.

The procedural format gives each sub-genre a distinct sonic signature without external asset production.

### Code-time consequences

- A small audio module (~50–100 lines) wraps OscillatorNode lifecycle. The project must commit a "max simultaneous SFX" cap (≤ 4 typical) to avoid audio context overload.
- BGM is handled via either silence (Phase 3 default) or a stacked-oscillator looper that stays under 8 simultaneous oscillators total.
- `BootScene.preload` does NOT register external audio assets — `audioProfile === 'procedural'` keeps Phaser's `Audio` system unused.

### Concept affinity

`procedural` is concept-agnostic — every concept can ship with procedural audio. The waveform choice can echo concept tone (square waves for `pixelRetro`, sine for `softPastel`, sawtooth for `neonArcade`).

### Blind-spot reminders

- ⚠️ `procedural` while `audioScope === 'external-enabled'` is legal but limiting — the upgraded scope enables file-based audio; procedurally remaining is a deliberate constraint, not a default.
- ⚠️ Listing `kind: 'external'` entries in the `sfx` category while `audioProfile === 'procedural'` is a contract violation. The validator should flag.
- ⚠️ Procedural SFX with `durationMs > 600` reads as a "musical phrase" rather than feedback — those belong in BGM, not sfx.
