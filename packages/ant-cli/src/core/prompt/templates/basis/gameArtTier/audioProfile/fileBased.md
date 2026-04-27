## Audio Profile: File-Based

**Activation gate**: `gameArtTier.audioProfile === 'fileBased'`.

### Promise

The `fileBased` audio profile commits to **external audio files placed under `inputs/assets/game/sfx/` and `inputs/assets/game/bgm/`** (`.mp3` / `.ogg` / `.wav`). Every SFX and the BGM track are user-provided (or, in Phase 5+, visual-job-generated) audio clips. The Web Audio OscillatorNode pathway is unused. The project ships with rich, recorded audio that procedural synthesis cannot match.

### What "fileBased" looks like in code

| Surface | Realization |
|---|---|
| SFX playback | Phaser's `this.sound.play(id)` after `BootScene.preload` registers each SFX via `this.load.audio(id, src)`. |
| `sfx` asset entry | `kind: 'external'`, `src` pointing into `inputs/assets/game/sfx/...`. The `format` field is the file extension (`mp3` / `ogg` / `wav`). |
| BGM | A separate `bgm` category in `game-art-assets.json` with one or more loop tracks; the scene plays one via `this.sound.play(bgmId, { loop: true })`. |
| Volume / mute | The HUD typically exposes a settings button to toggle sfx / bgm volume; the project must expose `this.sound.volume` and `this.sound.mute` controls. |

### `game-art-assets.json` sfx + bgm category shape

```jsonc
"sfx": [
  { "id": "match-clear", "kind": "external", "src": "inputs/assets/game/sfx/match-clear.ogg", "format": "ogg" },
  { "id": "fail", "kind": "external", "src": "inputs/assets/game/sfx/fail.ogg", "format": "ogg" }
],
"bgm": [
  { "id": "main-theme", "kind": "external", "src": "inputs/assets/game/bgm/main-theme.mp3", "format": "mp3", "loop": true }
]
```

### Phase scope contract

`fileBased` requires **`_meta.audioScope === 'external-enabled'`**. Under `audioScope === 'procedural-only'`, the marker overrides the LLM's profile choice and forces `procedural` (see `_preamble.md` Section 5). The scope marker's authority means that a `fileBased` declaration in a baseline-audio project degrades cleanly to procedural until the user upgrades the audio scope.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

`fileBased` lifts every v8 sub-genre's audio quality:

- `match3` → richer match-clear chime, multi-layered cascade SFX, rich BGM.
- `slidingPuzzle` → ambient piano BGM, satisfying snap SFX with reverb tail.
- `cardSolitaire` → crisp card flip / shuffle / deal SFX, optional jazz BGM.
- `arcadePaddle` → punchy ball-paddle hit, ball-brick crash, sweep BGM.
- `arcadeSnake` → satisfying food-eat crunch, retro-tone BGM, death-thud.

Each sub-genre benefits but none requires `fileBased` — `procedural` is the Phase 3 sweet spot.

### Code-time consequences

- `BootScene.preload` runs `this.load.audio(id, src)` for every external sfx / bgm entry. Asset count drives the loading screen duration.
- The HTML5 audio decoder needs format negotiation — the project must ship at least one of `mp3` / `ogg` per asset (browsers vary). The `artifact-dir-policy.ts` whitelist (Phase 4 expansion) admits both.
- BGM playback respects user gesture gates — autoplay policy may delay BGM start until first user interaction. The project commits the strategy (gate BGM behind first input vs. play-on-load with user-prompt).

### Concept affinity

`fileBased` is concept-agnostic at the audio-pipeline level — any concept can ship with file-based audio. Concept-specific audio (8-bit chip tunes for `pixelRetro`, synthwave BGM for `neonArcade`, lo-fi piano for `softPastel`) is a content choice, not a profile choice.

### Blind-spot reminders

- ⚠️ `fileBased` while `audioScope === 'procedural-only'` runs in degraded procedural mode (silently or with a console notice). The project's PRD should call out the upgrade path.
- ⚠️ Missing audio files at runtime cause Phaser preload errors — the project should validate asset existence in CI / pre-deploy. The ANT validator (Phase 4) checks `kind: 'external'` paths for existence.
- ⚠️ Listing oscillator-format entries in the `sfx` category while `audioProfile === 'fileBased'` is inconsistent — those should migrate to `external` or the profile should be `hybrid`.
- ⚠️ License / royalty considerations for shipped audio belong outside this tier — but the project team owes a license audit before publish.
